/**
 * 指標計算（正確率・KPM・WPM・合否判定）。
 *
 * DOM にも React にも依存しない純粋関数群。ゼロ除算・NaN・Infinity を一切
 * 発生させないことを最優先にする（design.md §11 の境界値要件）。
 *
 * 参照元:
 *   - docs/design.md §8.1（指標の計算）/ §8.2（合否判定）
 *   - .claude/epics/typing-app/00-decisions.md §9（durationMs の計測起点）
 */

import type { KeyStat, TypingState } from '../storage/schema';
import type { SessionSummary } from '../storage/schema';

/**
 * 正確率（0..1）。
 * 総打鍵（correctCount + missCount）が 0 のときは 0 を返す（design.md §8.1 の実装指示）。
 * ミスのみのセッション（correctCount === 0, missCount > 0）は 0 になる。
 */
export function calcAccuracy(correctCount: number, missCount: number): number {
  const total = correctCount + missCount;
  if (total <= 0) {
    return 0;
  }
  return correctCount / total;
}

/**
 * KPM（1 分あたりの正しい打鍵数）。本アプリの主指標（design.md §8.1）。
 * durationMs <= 0 のときは Infinity/NaN を避けるため 0 を返す。
 */
export function calcKpm(correctCount: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return correctCount / (durationMs / 60000);
}

/**
 * WPM（参考値。5 打鍵 = 1 語の英語圏慣例）。KPM が主指標であり WPM は補助表示
 * （design.md §8.1: Shell/Git コマンドは英単語ではないため語基準の指標は実感と乖離する）。
 * durationMs <= 0 のときは 0 を返す。
 */
export function calcWpm(correctCount: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return correctCount / 5 / (durationMs / 60000);
}

/**
 * セッションの経過時間（ミリ秒）。
 * DECISIONS §9: 計測起点は「最初の有効打鍵」であり画面表示時刻ではない。
 * startedAt / lastInputAt のどちらかが null（1 打鍵もしていない）、または
 * 差が負（不正な入力）の場合は 0 を返し、KPM/WPM 側のゼロ除算ガードと整合させる。
 */
export function calcDurationMs(
  startedAt: number | null,
  lastInputAt: number | null,
): number {
  if (startedAt === null || lastInputAt === null) {
    return 0;
  }
  const duration = lastInputAt - startedAt;
  if (duration < 0) {
    return 0;
  }
  return duration;
}

/**
 * 浮動小数点誤差の吸収用の許容誤差。
 *
 * 丸め方針: accuracy は correctCount/(correctCount+missCount) という除算で得られる値のため、
 * 本来ちょうど基準値（例 0.96）になるはずの入力でも 0.9599999999999999 のような値になり得る。
 * kpm も同様に除算経由の値である。浮動小数点の相対誤差は倍精度で ~1e-15 程度であり、
 * kpm が数百のオーダーでも絶対誤差は 1e-12 程度に収まるため、1e-9 の絶対許容誤差を
 * 両方の比較に共通で使えば「本来ちょうど基準値」のケースを正しく合格判定でき、
 * かつ実質的な未達（誤差の範囲を超える差）を誤って合格にする心配もない。
 */
const EPSILON = 1e-9;

/**
 * 合否判定（design.md §8.2）。
 * 正確率・KPM の両方が基準以上のときのみ合格。境界値（ちょうど基準値）は合格とする。
 * 浮動小数点誤差は EPSILON で吸収する（上記コメント参照）。
 */
export function judgePassed(
  accuracy: number,
  kpm: number,
  passAccuracy: number,
  passKpm: number,
): boolean {
  return accuracy + EPSILON >= passAccuracy && kpm + EPSILON >= passKpm;
}

/**
 * TypingState から SessionSummary を組み立てる。
 * keyStats は呼び出し元の state を汚染しないようディープコピーして返す。
 *
 * 契約: 返り値の `passed` はあくまで「指標上の合否」（正確率・KPM が基準を
 * 満たすか）であり、「レベル解放の可否」ではない。`state.levelId === 'weakness'`
 * （弱点特訓）のセッションでも `passed` は同じルールで算出されるが、
 * design.md §3.6 のとおり弱点特訓はレベル解放判定に一切影響しないため、
 * `levelId === 'weakness'` を理由に `passed` を無視するかどうかの判断は
 * 呼び出し側（t10 の `applySessionSummary`）の責務とする。
 */
export function summarizeSession(
  state: TypingState,
  level: { passAccuracy: number; passKpm: number },
): SessionSummary {
  const durationMs = calcDurationMs(state.startedAt, state.lastInputAt);
  const accuracy = calcAccuracy(state.correctCount, state.missCount);
  const kpm = calcKpm(state.correctCount, durationMs);
  const wpm = calcWpm(state.correctCount, durationMs);
  const passed = judgePassed(accuracy, kpm, level.passAccuracy, level.passKpm);

  return {
    levelId: state.levelId,
    durationMs,
    accuracy,
    kpm,
    wpm,
    correctCount: state.correctCount,
    missCount: state.missCount,
    passed,
    keyStats: cloneKeyStats(state.keyStats),
  };
}

function cloneKeyStats(keyStats: Record<string, KeyStat>): Record<string, KeyStat> {
  const result: Record<string, KeyStat> = {};
  for (const [key, stat] of Object.entries(keyStats)) {
    result[key] = { ...stat };
  }
  return result;
}

/** 結果画面のミス棒グラフ用の 1 件分 */
export interface MissKeyEntry {
  key: string;
  misses: number;
}

/**
 * ミス回数の多い順に上位 n 件を返す。同数はキーの昇順で安定させる
 * （Object.entries の順序に依存しないよう明示的にタイブレークする）。
 */
export function topMissKeys(keyStats: Record<string, KeyStat>, n: number): MissKeyEntry[] {
  const entries: MissKeyEntry[] = Object.entries(keyStats).map(([key, stat]) => ({
    key,
    misses: stat.misses,
  }));

  entries.sort((a, b) => {
    if (b.misses !== a.misses) {
      return b.misses - a.misses;
    }
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });

  return entries.slice(0, n);
}
