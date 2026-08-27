/**
 * 問題生成器（generator）。
 *
 * DOM にも React にも依存しない純粋関数群。乱数は必ず `rng: () => number` として
 * 引数から注入できるようにし、既定値のみ `Math.random` を使う。生成ロジック内部で
 * `Math.random()` を直接呼び出す箇所は無い（決定的なテストを可能にするため）。
 *
 * 参照元:
 *   - docs/design.md §8.3（問題生成）/ §3.6（弱点分析・特訓メニュー）/ §11（テスト方針）
 *
 * 結合境界（t08/t13/t16 との契約。詳細は report-r1.md にも記載）:
 *   - 「どのキーが弱点か」の算出は t08（weakness.ts）の責務。本ファイルはその結果である
 *     `weakKeys: string[]` を受け取るだけで、weakness.ts には一切依存しない。
 *   - 画面からの呼び出し（練習開始時に generateItems / generateWeaknessItems を叩く処理）は
 *     t13/t16 の責務。本ファイルは PracticeRequest の組み立てや画面遷移には関与しない。
 */

import type { DrillItem, LevelDef } from '../storage/schema';
import { WORDS } from '../data/words';

/** 決定的なテストのために外部注入する乱数生成関数。戻り値は [0, 1) を想定する（Math.random と同じ契約）。 */
export type Rng = () => number;

const MIN_CHUNK_LENGTH = 1;
const MAX_CHUNK_LENGTH = 5; // design.md §8.3: randomChars は 1〜5 文字の塊

/** 1〜5 の範囲でランダムな塊の長さを返す。 */
function randomChunkLength(rng: Rng): number {
  const range = MAX_CHUNK_LENGTH - MIN_CHUNK_LENGTH + 1;
  return MIN_CHUNK_LENGTH + Math.floor(rng() * range);
}

/**
 * `pool` から重み付きランダムに 1 文字選ぶ。`forbidden` と一致する候補は、他に選べる
 * 候補が残っている限り除外する（＝同一文字の 3 連続回避）。charset が 1 文字しかない等、
 * 除外すると候補が空になってしまう場合は制約を諦めて `forbidden` を許容する
 * （3 連続回避より「無限ループ・クラッシュしないこと」を優先する）。
 */
function pickChar(pool: string[], weights: number[], forbidden: string | null, rng: Rng): string {
  if (pool.length === 0) {
    return '';
  }

  const allowedIndices: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] !== forbidden) {
      allowedIndices.push(i);
    }
  }
  const indices = allowedIndices.length > 0 ? allowedIndices : pool.map((_, i) => i);

  const total = indices.reduce((sum, i) => sum + weights[i], 0);
  if (total <= 0) {
    const fallbackIndex = indices[Math.floor(rng() * indices.length)];
    return pool[fallbackIndex];
  }

  let r = rng() * total;
  for (const i of indices) {
    if (r < weights[i]) {
      return pool[i];
    }
    r -= weights[i];
  }
  // 浮動小数点誤差で全候補を通り抜けた場合のフォールバック。
  return pool[indices[indices.length - 1]];
}

/** Fisher-Yates シャッフル。rng を注入できる純粋関数（元配列は変更しない）。 */
export function shuffle<T>(input: readonly T[], rng: Rng): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateRandomCharsText(charset: string[], weights: number[], rng: Rng): string {
  if (charset.length === 0) {
    // charset が空の場合は選びようがないため空文字を返す（無限ループ・クラッシュ回避）。
    return '';
  }

  const length = randomChunkLength(rng);
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    const last = chars[chars.length - 1];
    const secondLast = chars[chars.length - 2];
    const forbidden = last !== undefined && last === secondLast ? last : null;
    chars.push(pickChar(charset, weights, forbidden, rng));
  }
  return chars.join('');
}

/**
 * `randomChars` 方式で `questionCount` 件生成する。全キー等しい重み（＝一様ランダム）。
 * 弱点特訓用の重み付き版は {@link generateWeaknessItems} を参照。
 */
export function generateRandomCharsItems(
  charset: string[],
  questionCount: number,
  rng: Rng = Math.random,
): DrillItem[] {
  if (questionCount <= 0) {
    return [];
  }
  const weights = charset.map(() => 1);
  const items: DrillItem[] = [];
  for (let i = 0; i < questionCount; i++) {
    items.push({ text: generateRandomCharsText(charset, weights, rng) });
  }
  return items;
}

function isWordWithinCharset(word: string, charsetSet: Set<string>): boolean {
  for (const ch of word) {
    if (!charsetSet.has(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * `words` 方式で `questionCount` 件生成する。`WORDS` のうち `charset` に収まる単語だけを
 * 抽出してシャッフルする。抽出後の単語数が `questionCount` に満たない場合は、プールを
 * 使い切るたびに再シャッフルして重複を許しながら埋める（無限ループにはならない）。
 * 収まる単語が 1 つも無い場合は空文字の問題で埋める（クラッシュ・無限ループ回避）。
 */
export function generateWordsItems(
  charset: string[],
  questionCount: number,
  rng: Rng = Math.random,
): DrillItem[] {
  if (questionCount <= 0) {
    return [];
  }

  const charsetSet = new Set(charset);
  const eligible = WORDS.filter((word) => isWordWithinCharset(word, charsetSet));

  if (eligible.length === 0) {
    return Array.from({ length: questionCount }, () => ({ text: '' }));
  }

  const result: DrillItem[] = [];
  let pool = shuffle(eligible, rng);
  let cursor = 0;
  while (result.length < questionCount) {
    if (cursor >= pool.length) {
      // プールを使い切ったら重複を許して再シャッフルで埋める。
      pool = shuffle(eligible, rng);
      cursor = 0;
    }
    result.push({ text: pool[cursor] });
    cursor++;
  }
  return result;
}

/**
 * `fixedList` 方式で `questionCount` 件生成する。`items` をシャッフルして先頭から
 * 取り出す。プールが `questionCount` より少なければ全件を返す（水増しはしない）。
 * `hint` はシャッフルで参照を保持するだけなのでそのまま残る。
 */
export function generateFixedListItems(
  items: DrillItem[],
  questionCount: number,
  rng: Rng = Math.random,
): DrillItem[] {
  if (items.length === 0 || questionCount <= 0) {
    return [];
  }
  const shuffled = shuffle(items, rng);
  return shuffled.slice(0, Math.min(questionCount, shuffled.length));
}

export interface GenerateItemsOptions {
  /** 省略時は level.questionCount を使う（設定画面の 10/20/30 切り替えを反映する場合に上書きする）。 */
  questionCount?: number;
  /** 省略時は Math.random。テストではシード付きの決定的な rng を渡す。 */
  rng?: Rng;
}

/**
 * レベル定義から問題を生成する。`level.generator` によって 3 方式に分岐する
 * （design.md §8.3）。charset/items が未設定のレベル定義に対しては空配列扱いで
 * フォールバックし、例外は投げない。
 */
export function generateItems(level: LevelDef, options: GenerateItemsOptions = {}): DrillItem[] {
  const rng = options.rng ?? Math.random;
  const questionCount = options.questionCount ?? level.questionCount;

  switch (level.generator) {
    case 'randomChars':
      return generateRandomCharsItems(level.charset ?? [], questionCount, rng);
    case 'words':
      return generateWordsItems(level.charset ?? [], questionCount, rng);
    case 'fixedList':
      return generateFixedListItems(level.items ?? [], questionCount, rng);
    default: {
      // level.generator は型上 3 値に閉じているため到達しないが、将来の型追加漏れを
      // コンパイルエラーで検知できるよう網羅性チェックを残す。
      const exhaustiveCheck: never = level.generator;
      throw new Error(`Unknown generator: ${String(exhaustiveCheck)}`);
    }
  }
}

// ---------- 弱点特訓 ----------

/** design.md §3.6: 弱点キーを 40% 以上の頻度で含む問題にする。 */
const WEAKNESS_MIN_RATIO = 0.4;
/** design.md §8.3: 弱点キーを含む問題の出現重みを 3 倍にする。 */
const WEAKNESS_WEIGHT_MULTIPLIER = 3;
/** design.md §3.6: 弱点特訓は 20 問自動生成する。questionCount 省略時のデフォルト値。 */
const DEFAULT_WEAKNESS_QUESTION_COUNT = 20;

export interface GenerateWeaknessOptions {
  /** 省略時は 20（design.md §3.6）。 */
  questionCount?: number;
  /** 省略時は Math.random。テストではシード付きの決定的な rng を渡す。 */
  rng?: Rng;
}

/**
 * 弱点特訓用の問題を生成する。
 *
 * 弱点キーの算出（weakScore の計算・上位 5 キーの抽出など）は t08 の責務であり、
 * このファイルはその結果である `weakKeys` を受け取るだけの純粋関数として実装する
 * （t08 の weakness.ts には一切依存しない）。
 *
 * design.md の 2 箇所の記述をどう統合したか:
 *   - §8.3「弱点キーを含む問題の出現重みを 3 倍にして randomChars を回す」
 *     → 生成プール（charset と weakKeys の和集合）の中で、weakKeys に含まれる文字の
 *       重みを 3、それ以外を 1 として重み付きランダム抽選する（randomChars の
 *       文字選択ロジックをそのまま再利用し、重みだけ差し替える形で実装）。
 *   - §3.6「そのキーを 40% 以上の頻度で含む問題を 20 問自動生成」
 *     → 重み付きランダムだけでは「各問題が 40% 以上」を確率的にしか満たせない
 *       （運悪く弱点キーが 1 つも出ない問題が発生しうる）ため、1 文字ずつ生成しながら
 *       「残り必要数（= ceil(length*0.4) − これまでに出た弱点キー数）」と
 *       「残りマス数」を動的に追跡し、両者が一致した時点（＝ここから先を全部弱点キーに
 *       しないと 40% に届かない）で以降を弱点キーのみの抽選に切り替える。まだ余裕がある
 *       間は §8.3 の「重み 3 倍」のランダム抽選のみで進める。
 *       事前に「このマス目は弱点キー確定」と固定で予約する方式（マス目を先に決め打ちする
 *       実装）も検討したが、weakKeys が 1 種類しか無いケースで「直前 2 文字がすでに
 *       その弱点キーで埋まっている（重み 3 倍の通常抽選がたまたま連続で引いた）ところに
 *       予約済みマスが重なり、3 連続回避のための代替文字が無い」という組み合わせで
 *       3 連続を許してしまう不具合があったため、動的追跡方式に変更した
 *       （残り必要数は「これまでに実際に出た弱点キー数」で減算されるため、既に重み 3 倍の
 *       抽選で規定数を満たしていれば強制モードに入らず、3 連続回避の代替候補が
 *       常に確保される）。
 *   - `weakKeys` が空配列の場合は §3.6 の前提（弱点キー上位 5 件）が存在しないケース
 *     なので、通常の randomChars（charset を等重みで抽選）にフォールバックする。
 *   - `weakKeys` に charset 外の文字が含まれる場合も落ちないよう、生成プールは
 *     `charset` と `weakKeys` の和集合とする。
 */
export function generateWeaknessItems(
  weakKeys: string[],
  charset: string[],
  options: GenerateWeaknessOptions = {},
): DrillItem[] {
  const rng = options.rng ?? Math.random;
  const questionCount = options.questionCount ?? DEFAULT_WEAKNESS_QUESTION_COUNT;

  if (questionCount <= 0) {
    return [];
  }

  if (weakKeys.length === 0) {
    return generateRandomCharsItems(charset, questionCount, rng);
  }

  const weakSet = new Set(weakKeys);
  const dedupedWeakKeys = [...weakSet];
  const pool = [...new Set([...charset, ...dedupedWeakKeys])];
  const weights = pool.map((c) => (weakSet.has(c) ? WEAKNESS_WEIGHT_MULTIPLIER : 1));

  const items: DrillItem[] = [];
  for (let i = 0; i < questionCount; i++) {
    items.push({ text: generateWeaknessText(pool, weights, dedupedWeakKeys, rng) });
  }
  return items;
}

function generateWeaknessText(
  pool: string[],
  weights: number[],
  weakKeys: string[],
  rng: Rng,
): string {
  if (pool.length === 0) {
    return '';
  }

  const weakSet = new Set(weakKeys);
  const weakWeights = weakKeys.map(() => 1);
  const length = randomChunkLength(rng);
  const requiredWeakCount = Math.min(length, Math.ceil(length * WEAKNESS_MIN_RATIO));

  const chars: string[] = [];
  let weakPlaced = 0;
  for (let i = 0; i < length; i++) {
    const last = chars[chars.length - 1];
    const secondLast = chars[chars.length - 2];
    const forbidden = last !== undefined && last === secondLast ? last : null;

    // 残りマス数ぶんしか余裕が無い（=ここから全部弱点キーにしないと 40% に届かない）
    // 場合だけ弱点キーのみに絞る。まだ余裕がある間は重み 3 倍の通常抽選に任せる。
    const remainingPositions = length - i;
    const remainingNeeded = Math.max(0, requiredWeakCount - weakPlaced);
    const mustBeWeak = weakKeys.length > 0 && remainingNeeded >= remainingPositions;

    const picked = mustBeWeak
      ? pickChar(weakKeys, weakWeights, forbidden, rng)
      : pickChar(pool, weights, forbidden, rng);

    chars.push(picked);
    if (weakSet.has(picked)) {
      weakPlaced++;
    }
  }
  return chars.join('');
}
