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
 *
 * 参照元: docs/design.md §3.3 §3.4 §5.3 §9 §4 §10.3 §7.3 / 00-decisions.md §6 §9 §10
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
      if (expected !== undefined && char !== expected) {
        const keyId = findKeyForChar(char)?.key.id ?? null;
        setMissKeyId(keyId);
        if (missTimerRef.current !== null) {
          window.clearTimeout(missTimerRef.current);
        }
        missTimerRef.current = window.setTimeout(() => {
          setMissKeyId(null);
          missTimerRef.current = null;
        }, MISS_FLASH_MS);
      }
    },
    [state.items, state.currentIndex, state.cursor],
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
        {current && (
          <DrillText text={current.text} cursor={state.cursor} hint={current.hint} missSeq={state.missCount} />
        )}
      </div>

      <StatsBar
        accuracy={accuracy}
        kpm={kpm}
        missCount={state.missCount}
        questionIndex={state.currentIndex}
        questionTotal={state.items.length}
      />

      {settings.showKeyboard && (
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
