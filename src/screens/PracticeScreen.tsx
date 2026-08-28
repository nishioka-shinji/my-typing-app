/**
 * 練習画面（タイピング本体）。
 *
 * typingReducer・useKeyboardInput・Keyboard・DrillText・StatsBar を統合する、
 * 本アプリの中核画面。TypingState はこの画面ローカルの useReducer に閉じ込め、
 * Context には一切載せない（00-research.md §5 の再レンダリング対策 / design.md §4
 * の 16ms 入力レイテンシ要件）。
 *
 * このファイルの他タスクへの依存:
 *   - t04 typingReducer / isQuestionComplete / isSessionComplete
 *   - t05 metrics（calcAccuracy/calcKpm/calcDurationMs/summarizeSession）/ guideMode
 *   - t06 findKeyForChar（Shift の左右判定・KeyDef.id 変換。自前実装しない）
 *   - t09 useKeyboardInput（対象要素は条件付きレンダーしないこと。tabIndex={0} の
 *     コンテナをマウント時から無条件で描画する）
 *   - t11 Keyboard（missKeyId は「実際に押し間違えたキー」。タイマー管理は本画面の責務）
 *   - t12 DrillText / StatsBar（missSeq は単調非減少で渡すこと。本画面は RESET を一切
 *     dispatch しないため、mount 中は TypingState.missCount が単調増加のまま
 *     保たれ、この契約を自然に満たす。RESET が必要になった場合は DrillText を
 *     アンマウントする（= PracticeScreen ごと key を変えて作り直す）側の責務とする）
 *   - t01(sound-effects) useSoundEffects（playSound(kind) を handleChar から呼ぶだけ。
 *     AudioContext の生成・破棄は関知しない）
 *
 * 参照元: docs/design.md §3.3 §3.4 §5.3 §9 §4 §10.3 §7.3 / 00-decisions.md §6 §9 §10 /
 *   .claude/epics/sound-effects/00-decisions.md §1
 *
 * r1 レビュー（review-r1.md）指摘への対応（r2）:
 *   - minor-1: 中断ダイアログの開閉（showQuitConfirm の変化）のたびに画面側の
 *     imeActive/capsLockOn も false へリセットする。useKeyboardInput 側は
 *     enabled が false→true に戻ったタイミングでのみ内部 ref をリセットするため、
 *     画面側もリセットを合わせないと「ダイアログ中に実際の状態が変わった」場合に
 *     警告バナーが誤って残り続ける。
 *   - minor-2: StatsBar.questionIndex は computeProgressLabel でクランプした値を渡す
 *     （セッション完了直後に currentIndex が items.length に達し「21/20」と表示される
 *     不整合を防ぐ。ヘッダー側は元々クランプ済み）。
 *   - minor-3: settings.showKeyboard=false でも consecutiveMiss >= 3 の間はヘルプ強制
 *     介入（design.md §3.3）を優先し、Keyboard を強制的に表示する
 *     （guideMode の強制表示と同じ「強制介入はユーザー設定より優先する」方針で統一）。
 *   - minor-5: セッション完了直後の 1 フレームで問題文欄が空になる見た目を、
 *     プレースホルダ表示で埋める。
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  createInitialTypingState,
  isQuestionComplete,
  isSessionComplete,
  typingReducer,
} from '../engine/typingReducer';
import { calcAccuracy, calcDurationMs, calcKpm, summarizeSession } from '../engine/metrics';
import { resolveGuideMode, shouldShowGuide } from '../engine/guideMode';
import { findKeyForChar } from '../data/keyboardUs';
import { useKeyboardInput } from '../hooks/useKeyboardInput';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { Keyboard } from '../components/Keyboard';
import { DrillText } from '../components/DrillText';
import { StatsBar } from '../components/StatsBar';
import type { GuideMode, PracticeRequest, Settings, SessionSummary } from '../storage/schema';
import './PracticeScreen.css';

export interface PracticeScreenProps {
  /** これから遊ぶセッションの内容。ホーム画面が組み立てる（t13/t18 が結線） */
  request: PracticeRequest;
  settings: Settings;
  /** セッション完了時に呼ばれる。永続化・画面遷移は呼び出し側（t18）の責務 */
  onFinish: (summary: SessionSummary) => void;
  /** Escape 中断確認で「中断する」を選んだときに呼ばれる。記録は残さない */
  onQuit: () => void;
}

/** ミスフラッシュを表示し続ける時間（ms）。KeyCap 側のアニメーション(120ms)より少し長め。 */
const MISS_FLASH_MS = 150;
/** 問題クリアから NEXT_QUESTION まで待つフェード演出の時間（design.md §10.3: 150ms 以内）。 */
const QUESTION_TRANSITION_MS = 150;

/**
 * 「次に打つべき文字」に対応するキー id を、3 連続ミス以上のときだけ返す。
 *
 * design.md §3.3 のヘルプ強制介入（同じ文字で 3 回連続ミス → 該当キーを点滅）を
 * 実現する純粋関数。alertKeyId は missKeyId（押した誤キー）とは異なり、常に
 * 「次に押すべきキー」側を指す（t11 レビュー確定契約）。
 *
 * jsdom 非導入のためレンダリングテストは書けないが、この関数自体は
 * PracticeScreen.test.ts で「2 回では出ない / 3 回で出る / 0 に戻ると消える」を
 * 直接検証できる。
 */
export function resolveAlertKeyId(nextChar: string | null, consecutiveMiss: number): string | null {
  if (consecutiveMiss < 3 || nextChar === null) {
    return null;
  }
  return findKeyForChar(nextChar)?.key.id ?? null;
}

/**
 * 運指ガイドの実効表示（Keyboard.showFingerGuide に渡す値）を解決する。
 *
 * t05 の resolveGuideMode（'auto' の解決）と shouldShowGuide（3 連続ミスの強制表示を
 * 含む表示判定）を合成するだけの薄いラッパーだが、「どちらの引数にどの値を渡すか」の
 * 配線を固定するために PracticeScreen 側のロジックとして単体テストする。
 *
 * hasRecentMiss は「現在同じ文字で詰まっている最中か」＝ consecutiveMiss > 0 とする
 * （正打鍵で 0 に戻るため、'onMiss' モードの表示はミス直後から次の正打鍵まで続く。
 * missKeyId の 150ms フラッシュに連動させると点滅のたびにガイドが明滅してしまうため
 * 採用しない）。
 */
export function resolveShowFingerGuide(
  guideModeSetting: Settings['guideMode'],
  levelDefaultGuideMode: GuideMode,
  consecutiveMiss: number,
): boolean {
  const resolvedMode = resolveGuideMode({ guideMode: guideModeSetting }, levelDefaultGuideMode);
  const hasRecentMiss = consecutiveMiss > 0;
  return shouldShowGuide(resolvedMode, hasRecentMiss, consecutiveMiss);
}

/** 進捗表示（例: 8/20）用に 0-indexed の currentIndex を人間向けの 1-indexed に変換する。 */
export interface ProgressLabel {
  current: number;
  total: number;
}

/**
 * 表示用の問題番号を計算する。currentIndex が items.length に達した（セッション完了・
 * 問題間のフェード遷移中）場合でも "21/20" のような表示にならないよう、total 内に
 * クランプする。total が 0（items が空）のときは current も 0 にする。
 */
export function computeProgressLabel(currentIndex: number, total: number): ProgressLabel {
  const safeTotal = Math.max(total, 0);
  if (safeTotal === 0) {
    return { current: 0, total: 0 };
  }
  const clampedIndex = Math.min(Math.max(currentIndex, 0), safeTotal - 1);
  return { current: clampedIndex + 1, total: safeTotal };
}

/**
 * 画面内キーボードを表示するかどうかを解決する（r1 レビュー minor-3 対応）。
 *
 * design.md §3.3 の「同じ文字で 3 回連続ミス → 該当キーを強調点滅させ、運指ガイドを
 * 自動表示（ヘルプ強制介入）」は、Keyboard コンポーネント自体が描画されていないと
 * 一切ユーザーに届かない（alertKeyId の点滅も showFingerGuide の凡例も Keyboard の
 * 内部でしか描画されないため）。ヘルプ強制介入は「詰まっているユーザーを助ける」機能の
 * 根幹であり、guideMode の強制表示（shouldShowGuide の consecutiveMiss >= 3 分岐）と
 * 同じ「ユーザー設定より優先する」方針を settings.showKeyboard にも適用する。
 * consecutiveMiss が 0 に戻れば（正打鍵・問題送り）自動的に設定どおりの表示へ戻る。
 */
export function resolveKeyboardVisible(showKeyboardSetting: boolean, consecutiveMiss: number): boolean {
  return showKeyboardSetting || consecutiveMiss >= 3;
}

export function PracticeScreen({ request, settings, onFinish, onQuit }: PracticeScreenProps) {
  const [state, dispatch] = useReducer(
    typingReducer,
    request,
    (req) => createInitialTypingState(req.levelId, req.items),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const missTimerRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const [missKeyId, setMissKeyId] = useState<string | null>(null);
  const [imeActive, setImeActive] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // 正解打鍵・ミス打鍵の効果音。soundEnabled === false の間は AudioContext を
  // 一切生成しない（フック内部の契約。00-decisions.md §1・§4・§5）。playSound は
  // 参照が安定した useCallback（依存配列 []）のため、handleChar の依存配列に
  // 加えても handleChar 自体の再生成頻度は変わらない（t01 レビュー申し送り）。
  const playSound = useSoundEffects(settings.soundEnabled);

  // マウント時にコンテナへフォーカスする。ペイント前に完了させ、フォーカス喪失
  // オーバーレイが 1 フレームだけ見えてしまう点滅を避けるため useLayoutEffect を使う。
  useLayoutEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (showQuitConfirm) {
      cancelButtonRef.current?.focus();
    }
  }, [showQuitConfirm]);

  // r1 レビュー minor-1 対応: 中断ダイアログの開閉のたびに画面側の警告バナー state を
  // false にリセットする。useKeyboardInput は enabled が false→true に戻った時にだけ
  // 内部の capsLockOnRef/imeActiveRef を false にリセットする「変化検出」方式のため、
  // ダイアログを開いている間（enabled=false・購読なし）に実際の CapsLock/IME 状態が
  // 変わっても hook 側は気付けない。画面側の state だけリセットせずに残すと、
  // 「ダイアログを閉じたのに古い警告が消えない」不整合が起こる（例: CapsLock ON で
  // 警告表示 → ダイアログを開閉している間に OFF にする → 再購読後は
  // hook 側 ref（false）と実際の状態（false）が一致するため onCapsLockChange が
  // 呼ばれず、画面側の古い true が残り続ける）。ダイアログの開閉どちらのタイミングでも
  // 一旦 false に戻しておけば、以後の最初の keydown で実際の状態に基づいて
  // 正しく再検出される。
  useEffect(() => {
    setCapsLockOn(false);
    setImeActive(false);
  }, [showQuitConfirm]);

  // アンマウント時にミスフラッシュのタイマーを必ず解除する（t11 レビュー確定契約:
  // タイマー管理は呼び出し側=本画面の責務）。
  useEffect(() => {
    return () => {
      if (missTimerRef.current !== null) {
        window.clearTimeout(missTimerRef.current);
      }
    };
  }, []);

  const handleChar = useCallback(
    (char: string, at: number) => {
      const current = state.items[state.currentIndex];
      const expected = current?.text[state.cursor];
      dispatch({ type: 'KEY_PRESS', key: char, at });

      // ミス判定は typingReducer と同じ式（key !== expected）をここでも評価する。
      // reducer は「押されたキー」を state に残さない（keyStats は期待文字でキーング
      // している）ため、「どのキーを実際に押し間違えたか」は dispatch 元にしか
      // 存在しない（t11 レビュー r2「t16 実装者への確定契約」2 節）。
      // 注意（r1 レビュー nit-1）: この比較式は typingReducer.ts の isCorrect 判定式
      // （現状は厳密な === 比較）と意図的に重複させている。reducer 側の比較規則
      // （大文字小文字の扱い等）を将来変更する場合は、ここも同時に直さないと
      // 「カーソルは進む/進まないが赤フラッシュだけ挙動がずれる」不整合が起きる。
      if (expected !== undefined && char !== expected) {
        playSound('miss');
        const keyId = findKeyForChar(char)?.key.id ?? null;
        setMissKeyId(keyId);
        if (missTimerRef.current !== null) {
          window.clearTimeout(missTimerRef.current);
        }
        missTimerRef.current = window.setTimeout(() => {
          setMissKeyId(null);
          missTimerRef.current = null;
        }, MISS_FLASH_MS);
      } else if (expected !== undefined && char === expected) {
        playSound('correct');
      }
    },
    [state.items, state.currentIndex, state.cursor, playSound],
  );

  const handleEscape = useCallback(() => {
    setShowQuitConfirm(true);
  }, []);

  useKeyboardInput({
    targetRef: containerRef,
    enabled: !showQuitConfirm,
    onChar: handleChar,
    onEscape: handleEscape,
    onImeDetected: setImeActive,
    onCapsLockChange: setCapsLockOn,
  });

  // 問題クリア → 短いフェード演出のあと NEXT_QUESTION をディスパッチする
  // (design.md §10.3: 150ms 以内)。questionComplete と currentIndex だけを依存にし、
  // 打鍵のたびに（cursor が進むだけで完了していないケース）このエフェクトを
  // 再実行しないようにする。
  const questionComplete = isQuestionComplete(state);
  useEffect(() => {
    if (!questionComplete) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      dispatch({ type: 'NEXT_QUESTION' });
    }, QUESTION_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [questionComplete, state.currentIndex]);

  // 全問題を打ち切ったら SessionSummary を組み立てて onFinish を呼ぶ。
  // 進捗の永続化・画面遷移は行わない（out_of_scope: t10/t18 の責務）。
  const sessionComplete = isSessionComplete(state);
  useEffect(() => {
    if (!sessionComplete || finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    const summary = summarizeSession(state, {
      passAccuracy: request.passAccuracy,
      passKpm: request.passKpm,
    });
    onFinish(summary);
  }, [sessionComplete, state, onFinish, request.passAccuracy, request.passKpm]);

  function cancelQuit() {
    setShowQuitConfirm(false);
    containerRef.current?.focus();
  }

  function confirmQuit() {
    onQuit();
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelQuit();
    }
  }

  const current = state.items[state.currentIndex];
  const nextChar: string | null = current ? (current.text[state.cursor] ?? null) : null;
  const alertKeyId = resolveAlertKeyId(nextChar, state.consecutiveMiss);
  const showFingerGuide = resolveShowFingerGuide(
    settings.guideMode,
    request.guideMode,
    state.consecutiveMiss,
  );

  const durationMs = calcDurationMs(state.startedAt, state.lastInputAt);
  const accuracy = calcAccuracy(state.correctCount, state.missCount);
  const kpm = calcKpm(state.correctCount, durationMs);
  const progress = computeProgressLabel(state.currentIndex, state.items.length);
  // StatsBar は questionIndex（0-indexed）に +1 して表示する契約（StatsBar.tsx）。
  // state.currentIndex をそのまま渡すと、最終問題クリア直後に currentIndex が
  // items.length に達し「21/20」のような超過表示になる（r1 レビュー minor-2）。
  // ヘッダーの progress.current と揃うよう、同じクランプ済みの値から 0-indexed に
  // 戻して渡す。
  const clampedQuestionIndex = progress.total > 0 ? progress.current - 1 : 0;

  const keyboardVisible = resolveKeyboardVisible(settings.showKeyboard, state.consecutiveMiss);

  return (
    <div
      className="practice"
      ref={containerRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <header className="practice__header">
        <span className="practice__level-name">{request.title}</span>
        <span className="practice__progress">
          {progress.current} / {progress.total}
        </span>
        <span className="practice__escape-hint">ESC で中断</span>
      </header>

      {imeActive && (
        <p className="practice__banner practice__banner--ime" role="alert">
          英数入力に切り替えてください
        </p>
      )}
      {capsLockOn && (
        <p className="practice__banner practice__banner--capslock" role="alert">
          CapsLock が ON です
        </p>
      )}

      <div className="practice__drill">
        {current ? (
          <DrillText text={current.text} cursor={state.cursor} hint={current.hint} missSeq={state.missCount} />
        ) : (
          // r1 レビュー minor-5 対応: 最終問題クリア後、NEXT_QUESTION により currentIndex が
          // items.length に達すると current が undefined になり DrillText がアンムマウント
          // される。onFinish が呼ばれ t18 が画面遷移するまでの間、枠だけが空になって
          // 見えてしまうのを避けるためプレースホルダを表示する。
          <p className="practice__drill-complete">完了しました</p>
        )}
      </div>

      <StatsBar
        accuracy={accuracy}
        kpm={kpm}
        missCount={state.missCount}
        questionIndex={clampedQuestionIndex}
        questionTotal={progress.total}
      />

      {keyboardVisible && (
        <Keyboard
          nextChar={nextChar}
          missKeyId={missKeyId}
          missSeq={state.missCount}
          showFingerGuide={showFingerGuide}
          highlightNextKey={settings.highlightNextKey}
          alertKeyId={alertKeyId}
        />
      )}

      {!focused && !showQuitConfirm && (
        <div className="practice__overlay" onClick={() => containerRef.current?.focus()}>
          <div className="practice__overlay-box">クリックして再開</div>
        </div>
      )}

      {showQuitConfirm && (
        <div className="practice__overlay" onKeyDown={handleDialogKeyDown}>
          <div className="practice__dialog" role="alertdialog" aria-modal="true" aria-label="セッション中断確認">
            <p className="practice__dialog-message">
              セッションを中断しますか？
              <br />
              記録は残りません。
            </p>
            <div className="practice__dialog-actions">
              <button
                type="button"
                ref={cancelButtonRef}
                className="practice__dialog-btn"
                onClick={cancelQuit}
              >
                続ける
              </button>
              <button
                type="button"
                className="practice__dialog-btn practice__dialog-btn--danger"
                onClick={confirmQuit}
              >
                中断する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
