/**
 * セッション結果を AppData に反映する純粋関数群（進捗更新・レベル解放・ストリーク・
 * 累積統計・sessions 上限）。React（useAppData.tsx）から切り出し、DOM にも React にも
 * 依存しない形で単体テストできるようにする。
 *
 * 参照元:
 *   - docs/design.md §3.2（不合格でも記録は残す）/ §3.6（弱点特訓はレベル解放に影響しない）/
 *     §3.7 / §6（データモデル）/ §8.2（合否判定・レベル解放）/ §8.4（ストリーク）
 *   - .claude/epics/typing-app/00-decisions.md §7（aggregateKeyStats は累積・無重み）
 */

import {
  LEVEL_IDS,
  type AppData,
  type KeyStat,
  type LevelId,
  type LevelProgress,
  type SessionRecord,
  type SessionSummary,
} from '../storage/schema';
import { MAX_SESSIONS } from '../storage/storage';

/**
 * `Date` からローカルタイムの `YYYY-MM-DD` 文字列を作る。
 * `toISOString()` は UTC 基準になり日本時間の日付とずれるため使わない。
 * 「今日」をこの関数の中で `new Date()` から取らず引数で渡せるようにし
 * （既定値のみ現在時刻）、ストリーク計算をテストで固定できるようにする。
 */
export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` をローカルタイムの真夜中を表す `Date` に変換する（比較専用）。 */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * 2 つの `YYYY-MM-DD` の間の暦日数の差を返す（`to` - `from`）。
 *
 * 文字列同士の比較や単純な `86400000ms` 単位の割り算は、月末（うるう年含む）・
 * 年末をまたぐケースや、DST（サマータイム）で 1 日が 23h/25h になる地域で壊れる。
 * ここでは `parseLocalDate` で得たローカル真夜中の `Date` 同士の差を
 * `Math.round` で丸めることで、DST による ±1h のずれを吸収しつつ「暦日で何日差か」
 * を正しく求める（23h/24 ≈ 0.96 → 1、25h/24 ≈ 1.04 → 1 に丸まる）。
 */
function diffInLocalDays(fromDateStr: string, toDateStr: string): number {
  const from = parseLocalDate(fromDateStr);
  const to = parseLocalDate(toDateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

/**
 * ストリーク（連続練習日数）を更新する（design.md §8.4）。
 *
 * - `lastPlayedDate` が空文字（未プレイ）→ 1（初回プレイ）
 * - 同日 → 据え置き
 * - 前日（暦日差 1） → +1
 * - それ以前（暦日差 2 以上、または負＝端末時計が巻き戻った等の異常値） → 1 にリセット
 *
 * 日付は `YYYY-MM-DD` の文字列比較ではなく `Date` オブジェクトの日数差で判定する
 * （月末・年末・うるう年・DST をまたぐと文字列比較は壊れるため）。
 */
export function computeStreak(lastPlayedDate: string, todayDate: string, currentStreak: number): number {
  if (lastPlayedDate === '') {
    return 1;
  }
  if (lastPlayedDate === todayDate) {
    return currentStreak;
  }
  const diffDays = diffInLocalDays(lastPlayedDate, todayDate);
  if (diffDays === 1) {
    return currentStreak + 1;
  }
  return 1;
}

function cloneKeyStats(keyStats: Record<string, KeyStat>): Record<string, KeyStat> {
  const result: Record<string, KeyStat> = {};
  for (const [key, stat] of Object.entries(keyStats)) {
    result[key] = { ...stat };
  }
  return result;
}

/**
 * `aggregateKeyStats`（全期間累積・無重み: DECISIONS §7）へ今回の `keyStats` を加算する。
 * 弱点分析（t08 の weakness.ts）はこの値を使わず `sessions` を都度再集計するため、
 * ここでは単純合算のみでよい。
 */
function mergeKeyStats(
  base: Record<string, KeyStat>,
  addition: Record<string, KeyStat>,
): Record<string, KeyStat> {
  const result = cloneKeyStats(base);
  for (const [key, stat] of Object.entries(addition)) {
    const existing = result[key];
    result[key] = existing
      ? {
          attempts: existing.attempts + stat.attempts,
          misses: existing.misses + stat.misses,
          totalLatencyMs: existing.totalLatencyMs + stat.totalLatencyMs,
        }
      : { ...stat };
  }
  return result;
}

/** `applySessionSummary` の戻り値 */
export interface ApplySessionSummaryResult {
  /** 反映後の新しい AppData（入力 `data` は変更しない） */
  data: AppData;
  /** 今回のセッションから作られた SessionRecord */
  record: SessionRecord;
  /** 合格して新たに解放されたレベル。無ければ null（design.md §8.2） */
  unlockedLevelId: LevelId | null;
}

/**
 * セッション結果（`SessionSummary`）を `AppData` に反映する。入力 `data` は一切変更せず、
 * 新しいオブジェクトを返す（イミュータブル）。
 *
 * 反映内容:
 *   - `sessions` の先頭に新しい `SessionRecord` を追加し、`MAX_SESSIONS`（20）件に丸める
 *     （新しい順。t02 レビュー確定事項どおり必ず unshift、逆にすると新しい記録が消える）。
 *   - `aggregateKeyStats` へ今回の `keyStats` を加算（全期間累積・無重み: DECISIONS §7）。
 *   - `totals.totalKeystrokes` / `totals.totalTimeMs` を加算。
 *   - `totals.streakDays` / `totals.lastPlayedDate` を更新（design.md §8.4）。
 *   - `levelId === 'weakness'`（弱点特訓）のときは `progress` を一切変更しない
 *     （design.md §3.6: 弱点特訓はレベル解放判定に影響しない。最重要の回帰防止ポイント）。
 *   - レベルセッションでは `playCount+1`、`bestKpm` / `bestAccuracy` を最大値で更新
 *     （不合格でも記録・統計だけは残す: design.md §3.2）。
 *   - 合格 (`summary.passed`) したら `cleared = true` にし、次レベルが存在してまだ
 *     `unlocked` でなければ `unlocked = true` にする。既に解放済みなら何もしない
 *     （一度解放したレベルは以後ロックし直さない: design.md §8.2）。
 *   - Lv8（最終レベル）合格時は次レベルが存在しないため `unlockedLevelId` は `null` のまま
 *     （クラッシュしない）。
 *
 * `now` と `id` は呼び出し側（useAppData.tsx）から注入する（テスト容易性のため、
 * この関数の中で `Date.now()` / `crypto.randomUUID()` を直接呼ばない）。
 */
export function applySessionSummary(
  data: AppData,
  summary: SessionSummary,
  now: number,
  id: string,
): ApplySessionSummaryResult {
  const record: SessionRecord = {
    id,
    levelId: summary.levelId,
    playedAt: now,
    durationMs: summary.durationMs,
    accuracy: summary.accuracy,
    kpm: summary.kpm,
    correctCount: summary.correctCount,
    missCount: summary.missCount,
    passed: summary.passed,
    keyStats: cloneKeyStats(summary.keyStats),
  };

  // 新しい記録を先頭に unshift してから丸める（index 0 = 最新であることを t10 側でも保証する）。
  const sessions = [record, ...data.sessions].slice(0, MAX_SESSIONS);
  const aggregateKeyStats = mergeKeyStats(data.aggregateKeyStats, summary.keyStats);

  const todayDate = formatLocalDate(new Date(now));
  const streakDays = computeStreak(data.totals.lastPlayedDate, todayDate, data.totals.streakDays);
  const totals: AppData['totals'] = {
    totalKeystrokes: data.totals.totalKeystrokes + summary.correctCount + summary.missCount,
    totalTimeMs: data.totals.totalTimeMs + summary.durationMs,
    streakDays,
    lastPlayedDate: todayDate,
  };

  let progress = data.progress;
  let unlockedLevelId: LevelId | null = null;

  // 弱点特訓 ('weakness') は progress を一切変更しない（design.md §3.6）。
  if (summary.levelId !== 'weakness') {
    const levelId = summary.levelId;
    const current = data.progress[levelId];
    const updatedCurrent: LevelProgress = {
      unlocked: current.unlocked,
      // cleared は一度立ったら下ろさない（不合格の再挑戦で消えない）。
      cleared: current.cleared || summary.passed,
      bestKpm: Math.max(current.bestKpm, summary.kpm),
      bestAccuracy: Math.max(current.bestAccuracy, summary.accuracy),
      playCount: current.playCount + 1,
    };

    progress = { ...data.progress, [levelId]: updatedCurrent };

    if (summary.passed) {
      const nextLevelId = (levelId + 1) as LevelId;
      // Lv8 合格時は次レベルが存在しないため何もしない（クラッシュしない）。
      if (LEVEL_IDS.includes(nextLevelId)) {
        const nextCurrent = progress[nextLevelId];
        if (!nextCurrent.unlocked) {
          unlockedLevelId = nextLevelId;
          progress = { ...progress, [nextLevelId]: { ...nextCurrent, unlocked: true } };
        }
        // 既に unlocked === true の場合は何もしない（再ロックしない・unlockedLevelId も null のまま）。
      }
    }
  }

  const newData: AppData = {
    ...data,
    progress,
    sessions,
    aggregateKeyStats,
    totals,
  };

  return { data: newData, record, unlockedLevelId };
}
