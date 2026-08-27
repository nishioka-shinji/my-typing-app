import type { SessionResult } from '../storage/schema';
import { topMissKeys, type MissKeyEntry } from '../engine/metrics';
import './ResultScreen.css';

/**
 * ResultScreen の props。t16（練習画面）がセッション終了時に組み立てた
 * `SessionResult`（schema.ts。t10 の `applySessionSummary` の戻り値相当）を
 * そのまま渡す想定。このコンポーネント自身は storage / Context を一切
 * 参照しない（props 駆動。t18 が結線する契約なのでシグネチャは変更しないこと）。
 *
 * - `onNextLevel`: 呼び出し側が「次のレベルへ」導線を出すべきと判断したときだけ
 *   関数を渡し、出すべきでないとき（不合格・Lv8 合格で次が無い・弱点特訓）は
 *   `null` を渡す想定。**非 null を渡せば（弱点特訓を除き）必ずボタンが表示される**
 *   （レビュー r1 major-1 対応。以前は `unlockedLevelId === null` のときボタンが
 *   握り潰されていたが、`unlockedLevelId` は「今回新規に解放されたか」を示す値であって
 *   「次のレベルが存在するか」ではないため、これをボタン表示のガードに使うのは誤りだった）。
 *   本コンポーネント側では `shouldShowNextLevelButton` で
 *   `result.record.levelId === 'weakness'` のみを独立に再チェックする
 *   （呼び出し側の渡し忘れに対する多重防御。design.md §3.6 の「弱点特訓はレベル解放
 *   判定に影響しない」の回帰を画面側でも防ぐ）。
 */
export interface ResultScreenProps {
  result: SessionResult;
  onRetry: () => void;
  onNextLevel: (() => void) | null;
  onHome: () => void;
}

/** ミスキー棒グラフに表示する最大件数（design.md §5.4 は 3〜5 件） */
const TOP_MISS_KEY_COUNT = 5;

/**
 * 合否判定の境界値表示用の許容誤差。
 * `src/engine/metrics.ts` の `judgePassed` と同じ理由（除算経由の値の浮動小数点誤差を
 * 吸収する）で、達成マーク（✓/✗）の表示判定にも同じ桁の許容誤差を使う。
 * `judgePassed` の結果（`result.record.passed`）は合否バッジに使い、この定数は
 * 「正確率・KPM のどちらが基準未達か」という内訳表示にのみ使う（用途が異なるため
 * metrics.ts から import せず、意図的にここでも同じ値を持つ）。
 */
const EPSILON = 1e-9;

/**
 * 経過時間を "2m 18s" 形式に整形する（design.md §5.4）。
 * 1 時間以上は "1h 2m 3s" のように時間の桁を追加する。
 * 負値や NaN 等の異常値は 0 として扱い、マイナス表示や NaN 表示を絶対に出さない。
 */
export function formatDuration(durationMs: number): string {
  const safeMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const totalSeconds = Math.round(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * 正確率を "96.2%" 形式に整形する。
 * `calcAccuracy`（t05）は必ず 0..1 を返す契約だが、表示直前の最終防御として
 * ここでも 0..1 にクランプする（レビュー r1 nit-4 対応: 万一 0..1 外の値が
 * 渡っても "-50.0%" のような非現実的な表示を出さない）。
 */
export function formatAccuracy(accuracy: number): string {
  const safe = Number.isFinite(accuracy) ? accuracy : 0;
  const clamped = Math.max(0, Math.min(1, safe));
  return `${(clamped * 100).toFixed(1)}%`;
}

/** KPM を整数表示に丸める */
export function formatKpm(kpm: number): string {
  const safe = Number.isFinite(kpm) ? kpm : 0;
  return `${Math.round(safe)}`;
}

/**
 * ミス回数を整数表示に整形する（レビュー r1 minor-3 対応）。
 * `TypingState.missCount` / `KeyStat.misses` は reducer のインクリメント由来の
 * 非負整数であり現状 NaN にはならないが、他の数値表示（正確率・KPM・時間）と
 * 防御の一貫性を持たせるため、ここでも `Number.isFinite` ガード＋丸めを通す。
 */
export function formatMissCount(misses: number): string {
  const safe = Number.isFinite(misses) && misses > 0 ? misses : 0;
  return `${Math.round(safe)}`;
}

/** 正確率が基準を達成しているか（表示用。EPSILON で境界値の浮動小数点誤差を吸収） */
export function isAccuracyAchieved(accuracy: number, passAccuracy: number): boolean {
  return accuracy + EPSILON >= passAccuracy;
}

/** KPM が基準を達成しているか（表示用。EPSILON で境界値の浮動小数点誤差を吸収） */
export function isKpmAchieved(kpm: number, passKpm: number): boolean {
  return kpm + EPSILON >= passKpm;
}

/**
 * 「次のレベルへ」ボタンを表示すべきかどうかの判定（design.md §3.6 の回帰テスト対象。
 * 合格 / 不合格 / Lv8 合格（次が無い）/ 弱点特訓 の 4 ケースを単体テストで固定する）。
 *
 * - `onNextLevel` が null（呼び出し側が「次のレベルへ渡すべきでない」と判断して
 *   渡さない）なら常に false。呼び出し側の意思決定を尊重する。
 * - 弱点特訓（`levelId === 'weakness'`）は合否に関わらず常に false
 *   （design.md §3.6: 弱点特訓はレベル解放判定に影響しないため「次のレベルへ」という
 *   概念自体が存在しない。onNextLevel が非 null で渡されていても無視する多重防御）。
 * - 上記 2 条件を満たさない限り true。
 *
 * レビュー r1 major-1 対応: 以前は `result.unlockedLevelId === null` も false 条件に
 * 含めていたが、`unlockedLevelId` は「このセッションで**新規に**解放されたレベル」
 * （`src/hooks/appDataUpdates.ts` 参照）であり「次のレベルが存在するか」ではない。
 * そのため「クリア済みレベルを復習で再合格した」ケース（`passed: true` かつ
 * 次レベルは既に unlocked 済みなので `unlockedLevelId` は null）で、呼び出し側が
 * 遷移可能と判断して非 null の `onNextLevel` を渡していてもボタンが握り潰されて
 * しまっていた。`unlockedLevelId` は「解放されました」メッセージの表示条件
 * （`getUnlockMessage`）にのみ使い、ボタン表示の可否には使わない
 * （「関数を渡した＝出す」という呼び出し側の意思決定に画面側は従う）。
 */
export function shouldShowNextLevelButton(
  result: SessionResult,
  onNextLevel: (() => void) | null,
): boolean {
  if (onNextLevel === null) {
    return false;
  }
  if (result.record.levelId === 'weakness') {
    return false;
  }
  return true;
}

/**
 * レベル解放メッセージ（"Lv4 が解放されました"）。表示しないときは null。
 * `shouldShowNextLevelButton` と同じ理由で弱点特訓では常に null。
 */
export function getUnlockMessage(result: SessionResult): string | null {
  if (result.record.levelId === 'weakness') {
    return null;
  }
  if (result.unlockedLevelId === null) {
    return null;
  }
  return `Lv${result.unlockedLevelId} が解放されました`;
}

/**
 * ミス棒グラフに表示するキーを算出する。
 *
 * `src/engine/weakness.ts` の `getTopWeakKeys` ではなく `src/engine/metrics.ts` の
 * `topMissKeys` を使う。理由: `getTopWeakKeys` は相対順位のみで判定するため
 * ノーミスでも必ず 5 件返してしまい、「ミスの多かったキー」という見出しと
 * 実際のミス回数（design.md §5.4 の "6回" "4回" "1回" という表示）が矛盾する
 * （ミス 0 件のキーを苦手として見せてしまう）。`topMissKeys` は生のミス回数を
 * そのまま返すため、0 件のキーを `misses > 0` でここで除外すればよく、
 * 表示内容（回数）とデータソースが一致する。
 */
export function getDisplayMissKeys(
  keyStats: SessionResult['record']['keyStats'],
  n: number = TOP_MISS_KEY_COUNT,
): MissKeyEntry[] {
  return topMissKeys(keyStats, n).filter((entry) => entry.misses > 0);
}

/**
 * ミス棒グラフの横幅（%）。ゼロ除算を避け、常に 0〜100 の範囲に収める。
 * `maxMisses` が 0 以下（＝表示対象キーが無い）のときは 0 を返す。
 */
export function missBarWidthPercent(misses: number, maxMisses: number): number {
  if (!Number.isFinite(misses) || !Number.isFinite(maxMisses) || maxMisses <= 0) {
    return 0;
  }
  const percent = (misses / maxMisses) * 100;
  return Math.max(0, Math.min(100, percent));
}

/**
 * セッション結果画面（design.md §5.4）。
 *
 * props のみで完結し、storage / Context / typingReducer に一切依存しない。
 * 手動確認は t01 が置いた `src/App.tsx` を一時的に書き換えて行う
 * （合格・不合格・ミス 0・Lv8 合格の 4 パターン。確認後は必ず revert する）。
 */
export function ResultScreen({ result, onRetry, onNextLevel, onHome }: ResultScreenProps) {
  const { record, passAccuracy, passKpm } = result;
  const isWeakness = record.levelId === 'weakness';
  const accuracyAchieved = isAccuracyAchieved(record.accuracy, passAccuracy);
  const kpmAchieved = isKpmAchieved(record.kpm, passKpm);
  const unlockMessage = getUnlockMessage(result);
  const showNextLevel = shouldShowNextLevelButton(result, onNextLevel);
  const missKeys = getDisplayMissKeys(record.keyStats, TOP_MISS_KEY_COUNT);
  const maxMisses = missKeys.length > 0 ? missKeys[0].misses : 0;

  return (
    <div className="resultscreen">
      <div className="resultscreen__panel">
        <p className="resultscreen__eyebrow">SESSION COMPLETE</p>
        <p className="resultscreen__level-title">{result.levelTitle}</p>

        <div
          className={`resultscreen__badge resultscreen__badge--${record.passed ? 'passed' : 'failed'}`}
          role="status"
        >
          {/*
            "PASSED"/"FAILED" をタイプライター風に表示する（design.md §10.3）。
            演出は `.resultscreen__badge-text::after` の CSS アニメーション
            （テキストを覆う帯を右端から幅 100%→0% に縮めるマスク方式。詳細は
            ResultScreen.css のコメント参照。レビュー r1 minor-2 対応）のみで完結し、
            ボタン等の操作性には一切影響しない（overlay や pointer-events の変更を
            していないため、演出中でも下のボタンは押せる）。
          */}
          <span className="resultscreen__badge-text">
            <span aria-hidden="true">{record.passed ? '✓' : '✗'}</span> {record.passed ? 'PASSED' : 'FAILED'}
          </span>
        </div>

        {record.passed && unlockMessage && (
          <p className="resultscreen__unlock-message">{unlockMessage}</p>
        )}

        {!record.passed && (
          <p className="resultscreen__retry-note">
            不合格でも記録は残ります。弱点分析に反映されるので、次に活かしましょう。
          </p>
        )}

        <dl className="resultscreen__metrics">
          <div className="resultscreen__metric-row">
            <dt>正確率</dt>
            <dd>
              <span className="resultscreen__metric-value">{formatAccuracy(record.accuracy)}</span>
              <span className="resultscreen__metric-baseline">(基準 {formatAccuracy(passAccuracy)})</span>
              <span className={`resultscreen__mark resultscreen__mark--${accuracyAchieved ? 'ok' : 'ng'}`}>
                <span aria-hidden="true">{accuracyAchieved ? '✓' : '✗'}</span>
                <span className="resultscreen__visually-hidden">{accuracyAchieved ? '達成' : '未達'}</span>
              </span>
            </dd>
          </div>
          <div className="resultscreen__metric-row">
            <dt>KPM</dt>
            <dd>
              <span className="resultscreen__metric-value">{formatKpm(record.kpm)}</span>
              <span className="resultscreen__metric-baseline">(基準 {formatKpm(passKpm)})</span>
              <span className={`resultscreen__mark resultscreen__mark--${kpmAchieved ? 'ok' : 'ng'}`}>
                <span aria-hidden="true">{kpmAchieved ? '✓' : '✗'}</span>
                <span className="resultscreen__visually-hidden">{kpmAchieved ? '達成' : '未達'}</span>
              </span>
            </dd>
          </div>
        </dl>

        <p className="resultscreen__summary-line">
          <span>時間 {formatDuration(record.durationMs)}</span>
          <span className="resultscreen__summary-sep">ミス {formatMissCount(record.missCount)} 回</span>
        </p>

        <div className="resultscreen__miss-keys">
          <p className="resultscreen__miss-keys-title">ミスの多かったキー</p>
          {missKeys.length === 0 ? (
            <p className="resultscreen__miss-keys-empty">ミスなし</p>
          ) : (
            <ul className="resultscreen__miss-key-list">
              {missKeys.map((entry) => (
                <li className="resultscreen__miss-key-item" key={entry.key}>
                  <span className="resultscreen__miss-key-label">{entry.key}</span>
                  <span className="resultscreen__miss-key-bar-track">
                    <span
                      className="resultscreen__miss-key-bar-fill"
                      style={{ width: `${missBarWidthPercent(entry.misses, maxMisses)}%` }}
                    />
                  </span>
                  <span className="resultscreen__miss-key-count">{formatMissCount(entry.misses)}回</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isWeakness && (
          <p className="resultscreen__weakness-note">
            弱点特訓の結果はレベル解放には影響しません。
          </p>
        )}

        <div className="resultscreen__actions">
          <button type="button" className="resultscreen__button resultscreen__button--primary" onClick={onRetry}>
            もう一度
          </button>
          {showNextLevel && onNextLevel && (
            <button type="button" className="resultscreen__button" onClick={onNextLevel}>
              次のレベルへ
            </button>
          )}
          <button type="button" className="resultscreen__button" onClick={onHome}>
            ホーム
          </button>
        </div>
      </div>
    </div>
  );
}
