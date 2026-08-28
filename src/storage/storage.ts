/**
 * localStorage への AppData の読み書きを担う永続化層。
 *
 * design.md §6.1（読み込み時の防御）/ §4（データ耐性・保存容量）に基づき、
 * 以下のいずれの異常系でも例外を外へ投げず、練習開始を妨げない（§4「練習開始を
 * 絶対に妨げない」）ことを最優先にする。この方針は読み込み（loadAppData）だけでなく
 * 書き込み（saveAppData/resetAppData）にも適用する。
 *
 *   - 保存データが存在しない
 *   - JSON.parse に失敗する（壊れた文字列）
 *   - schemaVersion が想定外、またはオブジェクト形状が不正
 *   - localStorage 自体が存在しない、またはアクセスすると例外を投げる
 *   - setItem が QuotaExceededError 等で失敗する（容量超過）
 *   - 呼び出し元から渡された AppData 自体が想定外の形（sessions が配列でない等）
 *
 * schema.ts は t01 で凍結済みのため、型・初期値・キー定数はすべて import して使い、
 * このファイルからは一切変更しない。
 */
import {
  type AppData,
  BACKUP_STORAGE_KEY,
  createInitialAppData,
  DEFAULT_SETTINGS,
  type GuideMode,
  type KeyStat,
  LEVEL_IDS,
  type LevelId,
  type LevelProgress,
  SCHEMA_VERSION,
  type SessionRecord,
  type Settings,
  STORAGE_KEY,
} from './schema';

/**
 * localStorage 互換インターフェース。テストからインメモリのフェイクを注入できるように、
 * 直接 `window.localStorage` を参照せずこのインターフェース経由にする。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * sessions の最大保持件数（新しい順にこの件数まで）。DECISIONS §7。
 * t10 が「保存後は必ずこの件数以下」という前提を置けるよう export している。
 */
export const MAX_SESSIONS = 20;

/** 容量超過時、最低限これだけは残す（design.md §4 の縮退保存） */
const MIN_SESSIONS_ON_QUOTA_ERROR = 5;

/**
 * saveAppData の結果。
 * - 'ok': 渡された sessions（最大 {@link MAX_SESSIONS} 件への丸めのみ）をそのまま保存できた
 * - 'degraded': 容量超過等で失敗したため sessions を直近 {@link MIN_SESSIONS_ON_QUOTA_ERROR}
 *   件まで削って再試行し、それで保存できた（＝一部セッション記録が失われた）
 * - 'failed': 縮退保存を試みても最終的に保存できなかった
 */
export type SaveAppDataResult = 'ok' | 'degraded' | 'failed';

/**
 * 既定のストレージ実装。`localStorage` への参照は呼び出し時まで遅延させ、
 * 存在しない・アクセスが例外を投げる環境でも import 時点ではクラッシュしないようにする。
 * 例外はここで握りつぶさず呼び出し元（loadAppData/saveAppData）の try/catch に委ねる。
 */
const defaultStorage: StorageLike = {
  getItem: (key) => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: (key) => globalThis.localStorage.removeItem(key),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** schemaVersion が現行バージョンと一致するオブジェクトかどうか */
function hasCurrentSchemaVersion(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value.schemaVersion === SCHEMA_VERSION;
}

/**
 * 壊れた/非対応の旧データを退避する。バックアップ自体の書き込みが失敗しても
 * （例: 容量超過）初期化処理は継続する。
 */
function backupCorruptData(storage: StorageLike, raw: string): void {
  try {
    storage.setItem(BACKUP_STORAGE_KEY, raw);
  } catch {
    // バックアップに失敗しても、初期値での起動を優先する (design.md §6.1 手順4)。
  }
}

const VALID_GUIDE_MODES: readonly (GuideMode | 'auto')[] = ['auto', 'always', 'onMiss', 'never'];
const VALID_QUESTION_COUNTS: readonly Settings['questionCount'][] = [10, 20, 30];

/**
 * candidate から Settings を再構築する。既知キーだけを型チェックしたうえで拾い、
 * 未知キー・型不正な値・範囲外の値は既定値（DEFAULT_SETTINGS）へ差し替える。
 * これにより手動編集や将来バージョンの書き込みで壊れた値（例: questionCount:9999,
 * guideMode:'bogus', 未知キー evil）が後続タスクへそのまま流れることを防ぐ。
 */
function normalizeSettings(candidate: unknown): Settings {
  if (!isPlainObject(candidate)) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    guideMode: VALID_GUIDE_MODES.includes(candidate.guideMode as GuideMode | 'auto')
      ? (candidate.guideMode as GuideMode | 'auto')
      : DEFAULT_SETTINGS.guideMode,
    showKeyboard:
      typeof candidate.showKeyboard === 'boolean' ? candidate.showKeyboard : DEFAULT_SETTINGS.showKeyboard,
    highlightNextKey:
      typeof candidate.highlightNextKey === 'boolean'
        ? candidate.highlightNextKey
        : DEFAULT_SETTINGS.highlightNextKey,
    questionCount: VALID_QUESTION_COUNTS.includes(candidate.questionCount as Settings['questionCount'])
      ? (candidate.questionCount as Settings['questionCount'])
      : DEFAULT_SETTINGS.questionCount,
    levelLockEnabled:
      typeof candidate.levelLockEnabled === 'boolean'
        ? candidate.levelLockEnabled
        : DEFAULT_SETTINGS.levelLockEnabled,
    showStats: typeof candidate.showStats === 'boolean' ? candidate.showStats : DEFAULT_SETTINGS.showStats,
  };
}

/** candidate から totals を再構築する。フィールド単位で型が合わなければ初期値で補う。 */
function normalizeTotals(candidate: unknown, fallback: AppData['totals']): AppData['totals'] {
  if (!isPlainObject(candidate)) {
    return { ...fallback };
  }
  return {
    totalKeystrokes:
      typeof candidate.totalKeystrokes === 'number' ? candidate.totalKeystrokes : fallback.totalKeystrokes,
    totalTimeMs: typeof candidate.totalTimeMs === 'number' ? candidate.totalTimeMs : fallback.totalTimeMs,
    streakDays: typeof candidate.streakDays === 'number' ? candidate.streakDays : fallback.streakDays,
    lastPlayedDate:
      typeof candidate.lastPlayedDate === 'string' ? candidate.lastPlayedDate : fallback.lastPlayedDate,
  };
}

/** candidate から LevelProgress を再構築する。フィールド単位で型が合わなければ初期値で補う。 */
function normalizeLevelProgress(candidate: unknown, fallback: LevelProgress): LevelProgress {
  if (!isPlainObject(candidate)) {
    return { ...fallback };
  }
  return {
    unlocked: typeof candidate.unlocked === 'boolean' ? candidate.unlocked : fallback.unlocked,
    cleared: typeof candidate.cleared === 'boolean' ? candidate.cleared : fallback.cleared,
    bestKpm: typeof candidate.bestKpm === 'number' ? candidate.bestKpm : fallback.bestKpm,
    bestAccuracy: typeof candidate.bestAccuracy === 'number' ? candidate.bestAccuracy : fallback.bestAccuracy,
    playCount: typeof candidate.playCount === 'number' ? candidate.playCount : fallback.playCount,
  };
}

function isValidKeyStat(value: unknown): value is KeyStat {
  return (
    isPlainObject(value) &&
    typeof value.attempts === 'number' &&
    typeof value.misses === 'number' &&
    typeof value.totalLatencyMs === 'number'
  );
}

/**
 * Record<string, KeyStat> を再構築する。値が KeyStat の形をしていないエントリは
 * 落とす（例: `{a: 5, b: 'oops'}` の `b` を除外）。後続タスク（弱点分析・統計画面）が
 * `KeyStat.attempts` 等へ無条件でアクセスしてクラッシュしないようにするための最小限の防御。
 */
function normalizeKeyStatsMap(candidate: unknown): Record<string, KeyStat> {
  if (!isPlainObject(candidate)) {
    return {};
  }
  const result: Record<string, KeyStat> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (isValidKeyStat(value)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * SessionRecord として最低限必要な形（keyStats を含む）を満たしているか判定する。
 * 満たさない要素は「壊れた 1 件」としてセッション一覧から丸ごと除外する
 * （部分的に埋めるより、集計処理から見て安全なため）。
 */
function isValidSessionRecord(value: unknown): value is SessionRecord {
  if (!isPlainObject(value)) {
    return false;
  }
  const levelIdOk = value.levelId === 'weakness' || LEVEL_IDS.includes(value.levelId as LevelId);
  return (
    typeof value.id === 'string' &&
    levelIdOk &&
    typeof value.playedAt === 'number' &&
    typeof value.durationMs === 'number' &&
    typeof value.accuracy === 'number' &&
    typeof value.kpm === 'number' &&
    typeof value.correctCount === 'number' &&
    typeof value.missCount === 'number' &&
    typeof value.passed === 'boolean' &&
    isPlainObject(value.keyStats)
  );
}

/**
 * schemaVersion が一致するオブジェクトを AppData 形状へ正規化する。
 * 欠損・型不正なフィールドは初期値/DEFAULT_SETTINGS で補い、progress は
 * Lv1〜Lv8 すべてのキーが存在する状態にする（浅いマージではなくフィールド単位の型検証）。
 */
function normalizeAppData(parsed: Record<string, unknown>): AppData {
  const initial = createInitialAppData();

  const progressSource = isPlainObject(parsed.progress) ? parsed.progress : {};
  const progress = LEVEL_IDS.reduce<Record<LevelId, LevelProgress>>((acc, levelId) => {
    acc[levelId] = normalizeLevelProgress(progressSource[levelId], initial.progress[levelId]);
    return acc;
  }, {} as Record<LevelId, LevelProgress>);

  const settings = normalizeSettings(parsed.settings);
  const totals = normalizeTotals(parsed.totals, initial.totals);

  const sessions: SessionRecord[] = Array.isArray(parsed.sessions)
    ? parsed.sessions
        .filter(isValidSessionRecord)
        .map((session) => ({ ...session, keyStats: normalizeKeyStatsMap(session.keyStats) }))
        .slice(0, MAX_SESSIONS)
    : [];

  const aggregateKeyStats = normalizeKeyStatsMap(parsed.aggregateKeyStats);

  return {
    schemaVersion: SCHEMA_VERSION,
    progress,
    sessions,
    aggregateKeyStats,
    totals,
    settings,
  };
}

/**
 * AppData を localStorage（相当）から読み込む。design.md §6.1 の 4 段階の防御を実装する。
 *
 * 1. getItem 自体が例外を投げる、または保存データが無い → 初期値
 * 2. JSON.parse が失敗する → 初期値
 * 3. schemaVersion が現行と異なる、またはルート形状がオブジェクトでない
 *    → 旧データを BACKUP_STORAGE_KEY へ退避してから初期値
 * 4. schemaVersion は一致するが一部フィールドが欠損/型不正 → 該当フィールドのみ
 *    初期値で補って正規化（バックアップはしない）
 *
 * どの段階でも例外を外へ投げない。
 */
export function loadAppData(storage: StorageLike = defaultStorage): AppData {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return createInitialAppData();
  }

  if (raw === null) {
    return createInitialAppData();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createInitialAppData();
  }

  if (!hasCurrentSchemaVersion(parsed)) {
    backupCorruptData(storage, raw);
    return createInitialAppData();
  }

  try {
    return normalizeAppData(parsed);
  } catch {
    // 正規化中に想定外の例外が出ても、旧データを退避したうえで初期値にフォールバックする。
    backupCorruptData(storage, raw);
    return createInitialAppData();
  }
}

function trySetItem(storage: StorageLike, data: AppData): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * AppData を保存する。sessions は保存時に新しい順で最大 {@link MAX_SESSIONS} 件へ丸める。
 * setItem が容量超過等で失敗した場合は sessions を直近 {@link MIN_SESSIONS_ON_QUOTA_ERROR}
 * 件まで削って 1 度だけ再試行する。
 *
 * `data` 自体が想定外の形（例: sessions が配列でない）でも例外は外へ投げない。
 * 関数全体を try/catch で包み、どのような入力・ストレージ実装の組み合わせでも
 * 呼び出し元にクラッシュを伝播させない（design.md §4「練習開始を絶対に妨げない」は
 * 保存側にも適用する）。
 *
 * @returns
 *   - 'ok': 完全に保存できた（sessions は元の内容のまま、MAX_SESSIONS 件への丸めのみ）
 *   - 'degraded': 容量超過等で失敗したため sessions を削って縮退保存した
 *     （＝一部のセッション記録が失われている。t10 はこの結果をユーザーに通知するか判断すること）
 *   - 'failed': 縮退保存を試みても最終的に保存できなかった
 */
export function saveAppData(data: AppData, storage: StorageLike = defaultStorage): SaveAppDataResult {
  try {
    const sourceSessions = Array.isArray(data?.sessions) ? data.sessions : [];
    const trimmed: AppData = { ...data, sessions: sourceSessions.slice(0, MAX_SESSIONS) };

    if (trySetItem(storage, trimmed)) {
      return 'ok';
    }

    if (trimmed.sessions.length > MIN_SESSIONS_ON_QUOTA_ERROR) {
      const shrunk: AppData = {
        ...trimmed,
        sessions: trimmed.sessions.slice(0, MIN_SESSIONS_ON_QUOTA_ERROR),
      };
      if (trySetItem(storage, shrunk)) {
        return 'degraded';
      }
    }

    return 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * 全データを初期値へリセットして保存する（設定画面の「データを全消去」から使う想定）。
 * `my-typing-app:v1:backup`（旧データの退避先）も削除し、リセット後に旧データが
 * DevTools 等から読み取れる状態を残さない。保存・削除のいずれが失敗しても
 * （容量超過・removeItem が例外を投げる環境等）例外は投げず、呼び出し元には常に初期値を返す。
 */
export function resetAppData(storage: StorageLike = defaultStorage): AppData {
  const initial = createInitialAppData();
  saveAppData(initial, storage);
  try {
    storage.removeItem(BACKUP_STORAGE_KEY);
  } catch {
    // 削除に失敗しても、初期値での起動を優先する。
  }
  return initial;
}
