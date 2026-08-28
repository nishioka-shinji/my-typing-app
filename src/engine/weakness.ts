/**
 * 弱点分析（キー別弱点スコア算出）と特訓メニュー仕様の算出。
 *
 * DOM にも React にも依存しない純粋関数群。ゼロ除算・NaN・Infinity を一切
 * 発生させないことを最優先にする（design.md §11 / 00-research.md §5）。
 *
 * ★ DECISIONS §7（設計書 §6 の `AppData.aggregateKeyStats` との重要な相違）:
 * `aggregateKeyStats` は全期間累積・無重みで時系列情報を持たないため、減衰重み付けを
 * 適用できない。そのため弱点分析は `AppData.sessions`（直近 20 件、新しい順）を
 * 都度走査し、重み付きで再集計する。`aggregateKeyStats` はこのファイルから一切
 * 参照しない（統計画面のキー別ヒートマップ表示専用: t17 が使う）。
 *
 * t02 レビュアーの申し送りにより、storage 層は `sessions[0]` が最新である前提で
 * 実装されている（`src/storage/storage.ts` の `saveAppData` は sessions を並べ替えず
 * 先頭から `MAX_SESSIONS` 件に丸めるのみ）。本ファイルはその前提に依存せず、
 * 常に `playedAt` の新しい順へ明示的にソートしてから重みを割り当てる（呼び出し元の
 * 並び順が保証されていないケースでも安全なため）。
 *
 * t07（generator.ts）との結合境界:
 * 問題生成（`randomChars` の出現重み調整・20 問生成）は t07 の責務であり、
 * このファイルは import しない。本ファイルの責務は「どのキーが弱点か」
 * 「特訓メニューの仕様（対象キー・問題数・出現重み倍率）を算出するところまで」。
 * {@link getWeaknessTrainingPlan} が t07 の生成器（または t13 ホーム画面 / t16
 * 練習画面）が受け取るべき最小限のデータ（`keys` / `questionCount` /
 * `weightMultiplier`）を返す唯一の窓口となる。
 *
 * 参照元:
 *   - docs/design.md §3.6（弱点スコア式・特訓メニュー仕様）/ §8.3（弱点特訓モードの重み 3 倍）/ §11
 *   - .claude/epics/typing-app/00-decisions.md §7（減衰重みとデータモデルの整合）
 *   - .claude/epics/typing-app/00-research.md §5（norm のゼロ除算リスク）
 */

import type { SessionRecord } from '../storage/schema';

/** 直近何件を「新しい」グループ（重み 1.0）として扱うか（design.md §3.6 / DECISIONS §7） */
const RECENT_SESSION_COUNT = 5;
/** 直近グループの重み */
const RECENT_WEIGHT = 1.0;
/** 直近グループより古いセッションの重み */
const OLDER_WEIGHT = 0.5;

/** 弱点判定に必要な最低（重み付き）試行回数。未満のキーは信頼性が低いため対象外 */
const MIN_ATTEMPTS = 5;

/** weakScore の重み配分（design.md §3.6）。missRate 側を重視する */
const MISS_RATE_WEIGHT = 0.65;
const LATENCY_WEIGHT = 0.35;

/** 特訓メニューの仕様（design.md §3.6） */
export const WEAKNESS_TOP_KEY_COUNT = 5;
export const WEAKNESS_TRAINING_QUESTION_COUNT = 20;
/** design.md §8.3: 弱点キーを含む問題の出現重みを 3 倍にして randomChars を回す */
export const WEAKNESS_KEY_WEIGHT_MULTIPLIER = 3;

/**
 * 重み付き再集計後のキー別統計。各値はすでに重み（1.0 / 0.5）を掛けて合算した後の値であり、
 * `SessionRecord.keyStats` の生の値とは異なる（例: attempts は整数にならないことがある）。
 */
export interface WeightedKeyStat {
  attempts: number;
  misses: number;
  totalLatencyMs: number;
}

/**
 * `sessions` を `playedAt` の新しい順に並べ、キーごとに重み付きで
 * { attempts, misses, totalLatencyMs } を合算する。
 *
 * 重み: 新しい順に 1〜5 件目 = 1.0、6 件目以降 = 0.5（design.md §3.6 / DECISIONS §7）。
 * `AppData.sessions` は最大 20 件（`MAX_SESSIONS`）に丸められる前提のため本来 21 件目以降は
 * 来ないが、防御的に「6 件目以降はすべて 0.5」というルールをそのまま延長する（21 件目以降だけ
 * 別扱いにして無視したり、逆に重みを増したりしない）。古いデータを黙って捨てるより、
 * 「直近 5 件だけ優遇し、それ以外は一律 0.5」という単純なルールを保つほうが
 * 「古い苦手を引きずらせない」という設計意図と整合し、実装・テストも単純になる。
 */
export function aggregateWeightedKeyStats(sessions: SessionRecord[]): Record<string, WeightedKeyStat> {
  const sortedByRecency = [...sessions].sort((a, b) => b.playedAt - a.playedAt);

  const result: Record<string, WeightedKeyStat> = {};

  sortedByRecency.forEach((session, index) => {
    const weight = index < RECENT_SESSION_COUNT ? RECENT_WEIGHT : OLDER_WEIGHT;

    for (const [key, stat] of Object.entries(session.keyStats)) {
      const acc = result[key] ?? { attempts: 0, misses: 0, totalLatencyMs: 0 };
      acc.attempts += stat.attempts * weight;
      acc.misses += stat.misses * weight;
      acc.totalLatencyMs += stat.totalLatencyMs * weight;
      result[key] = acc;
    }
  });

  return result;
}

/** キー 1 件分の弱点スコア */
export interface WeakKeyScore {
  key: string;
  /** 重み付き missRate（0..1 が基本域だが、正規化前の生値のため範囲外にはならない） */
  missRate: number;
  /** 重み付き平均レイテンシ（ミリ秒） */
  latencyMs: number;
  /** 0.65*norm(missRate) + 0.35*norm(latencyMs) */
  weakScore: number;
  /** 判定に使った重み付き試行回数の合計（フィルタ・デバッグ用。生の回数ではない） */
  attempts: number;
}

/**
 * 配列を対象集合内で min-max 正規化する（0..1）。
 * - 空配列は空配列を返す。
 * - `max === min`（有効キーが 1 個、または全キー同値）のときは全要素 0 を返し、
 *   0 除算・NaN・Infinity を発生させない（00-research.md §5 の指摘）。
 */
function normalize(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 0);
  }
  return values.map((value) => (value - min) / (max - min));
}

/**
 * `sessions` からキー別の弱点スコアを算出する。
 *
 * - `aggregateWeightedKeyStats` で重み付き再集計してから、重み付き `attempts` 合計が
 *   {@link MIN_ATTEMPTS} 未満のキーを除外する（design.md §3.6 / DECISIONS §7）。
 * - `missRate(k) = misses/attempts`、`latencyMs(k) = totalLatencyMs/attempts`
 *   （いずれも重み付き集計値ベース）。
 * - `norm()` は対象キー集合（フィルタ後）内での min-max 正規化。
 * - `sessions` が空、または有効キーが 0 個のときは空配列を返す（例外を投げない）。
 */
export function computeWeakScores(sessions: SessionRecord[]): WeakKeyScore[] {
  const weighted = aggregateWeightedKeyStats(sessions);

  const candidates = Object.entries(weighted)
    .filter(([, stat]) => stat.attempts >= MIN_ATTEMPTS)
    .map(([key, stat]) => ({
      key,
      missRate: stat.misses / stat.attempts,
      latencyMs: stat.totalLatencyMs / stat.attempts,
      attempts: stat.attempts,
    }));

  if (candidates.length === 0) {
    return [];
  }

  const missRateNorm = normalize(candidates.map((c) => c.missRate));
  const latencyNorm = normalize(candidates.map((c) => c.latencyMs));

  return candidates.map((candidate, i) => ({
    ...candidate,
    weakScore: MISS_RATE_WEIGHT * missRateNorm[i] + LATENCY_WEIGHT * latencyNorm[i],
  }));
}

/**
 * 弱点スコア上位 `n` 件のキーを返す（design.md §3.6: 既定 5 件）。
 * weakScore 降順、同値はキーの昇順で安定的にタイブレークする
 * （`Object.entries` の順序に依存しないよう明示的にソートする）。
 * 有効キーが `n` 個未満ならある分だけ返す。`sessions` が空なら空配列を返す。
 */
export function getTopWeakKeys(sessions: SessionRecord[], n: number = WEAKNESS_TOP_KEY_COUNT): string[] {
  const scores = computeWeakScores(sessions);

  const sorted = [...scores].sort((a, b) => {
    if (b.weakScore !== a.weakScore) {
      return b.weakScore - a.weakScore;
    }
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });

  return sorted.slice(0, n).map((s) => s.key);
}

/**
 * 特訓メニューの仕様（t07 の生成器、または t13/t16 が受け取る契約）。
 * 問題そのものは含めない（生成は t07 の責務）。
 */
export interface WeaknessTrainingPlan {
  /** 弱点スコア上位キー（弱点が無ければ空配列） */
  keys: string[];
  /** 生成すべき問題数（design.md §3.6: 20 問固定） */
  questionCount: number;
  /** 弱点キーを含む問題の出現重み倍率（design.md §8.3: 3 倍固定） */
  weightMultiplier: number;
}

/**
 * 弱点特訓メニューの仕様を算出する。
 *
 * これが t07（generator.ts）/ t13（ホーム画面）/ t16（練習画面）との唯一の結合点。
 * 呼び出し側は `keys` を「弱点キー一覧」として `randomChars` 系の生成器に渡し、
 * `weightMultiplier` 倍の出現重みで問題を組み立て、`questionCount` 問生成する
 * （設計書 §8.3 の「弱点キーの出現重みを 3 倍にして randomChars を回す」はここでは行わず、
 * 生成器側の責務とする）。`keys` が空配列（データ不足で弱点キーが 1 つも無い）の場合の
 * 挙動（例えばランダム生成にフォールバックする等）も呼び出し側で判断する。
 */
export function getWeaknessTrainingPlan(sessions: SessionRecord[]): WeaknessTrainingPlan {
  return {
    keys: getTopWeakKeys(sessions, WEAKNESS_TOP_KEY_COUNT),
    questionCount: WEAKNESS_TRAINING_QUESTION_COUNT,
    weightMultiplier: WEAKNESS_KEY_WEIGHT_MULTIPLIER,
  };
}
