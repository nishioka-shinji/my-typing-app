/**
 * localStorage への AppData の読み書きを担う永続化層。
 *
 * design.md §6.1（読み込み時の防御）/ §4（データ耐性・保存容量）に基づき、
 * 以下のいずれの異常系でも例外を外へ投げず、練習開始を妨げない（§4「練習開始を
 * 絶対に妨げない」）ことを最優先にする。
 *
 *   - 保存データが存在しない
 *   - JSON.parse に失敗する（壊れた文字列）
 *   - schemaVersion が想定外、またはオブジェクト形状が不正
 *   - localStorage 自体が存在しない、またはアクセスすると例外を投げる
 *   - setItem が QuotaExceededError 等で失敗する（容量超過）
 *
 * schema.ts は t01 で凍結済みのため、型・初期値・キー定数はすべて import して使い、
 * このファイルからは一切変更しない。
 */
import {
  type AppData,
  BACKUP_STORAGE_KEY,
  createInitialAppData,
  DEFAULT_SETTINGS,
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

/** sessions の最大保持件数（新しい順に this 件まで）。DECISIONS §7 */
const MAX_SESSIONS = 20;

/** 容量超過時、最低限これだけは残す（design.md §4 の縮退保存） */
const MIN_SESSIONS_ON_QUOTA_ERROR = 5;

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

/**
 * schemaVersion が一致するオブジェクトを AppData 形状へ正規化する。
 * 欠損・型不正なフィールドは初期値/DEFAULT_SETTINGS で補い、progress は
 * Lv1〜Lv8 すべてのキーが存在する状態にする（浅いマージ）。
 */
function normalizeAppData(parsed: Record<string, unknown>): AppData {
  const initial = createInitialAppData();

  const progressSource = isPlainObject(parsed.progress) ? parsed.progress : {};
  const progress = LEVEL_IDS.reduce<Record<LevelId, LevelProgress>>((acc, levelId) => {
    const candidate = progressSource[levelId];
    acc[levelId] = isPlainObject(candidate)
      ? ({ ...initial.progress[levelId], ...candidate } as LevelProgress)
      : initial.progress[levelId];
    return acc;
  }, {} as Record<LevelId, LevelProgress>);

  const settings: Settings = isPlainObject(parsed.settings)
    ? ({ ...DEFAULT_SETTINGS, ...parsed.settings } as Settings)
    : { ...DEFAULT_SETTINGS };

  const totals = isPlainObject(parsed.totals)
    ? { ...initial.totals, ...parsed.totals }
    : { ...initial.totals };

  const sessions: SessionRecord[] = Array.isArray(parsed.sessions)
    ? (parsed.sessions.filter(isPlainObject) as unknown as SessionRecord[]).slice(0, MAX_SESSIONS)
    : [];

  const aggregateKeyStats: Record<string, KeyStat> = isPlainObject(parsed.aggregateKeyStats)
    ? (parsed.aggregateKeyStats as Record<string, KeyStat>)
    : {};

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
 * AppData を保存する。sessions は保存時に新しい順で最大 20 件へ丸める。
 * setItem が容量超過等で失敗した場合は sessions を直近 {@link MIN_SESSIONS_ON_QUOTA_ERROR}
 * 件まで削って再試行する。それでも失敗したら例外を投げず false を返して諦める。
 *
 * @returns 保存に成功したら true、（縮退保存を含め）最終的に失敗したら false
 */
export function saveAppData(data: AppData, storage: StorageLike = defaultStorage): boolean {
  const trimmed: AppData = { ...data, sessions: data.sessions.slice(0, MAX_SESSIONS) };

  if (trySetItem(storage, trimmed)) {
    return true;
  }

  if (trimmed.sessions.length > MIN_SESSIONS_ON_QUOTA_ERROR) {
    const shrunk: AppData = {
      ...trimmed,
      sessions: trimmed.sessions.slice(0, MIN_SESSIONS_ON_QUOTA_ERROR),
    };
    if (trySetItem(storage, shrunk)) {
      return true;
    }
  }

  return false;
}

/**
 * 全データを初期値へリセットして保存する（設定画面の「データを全消去」から使う想定）。
 * 保存自体が失敗しても（容量超過等）例外は投げず、呼び出し元には常に初期値を返す。
 */
export function resetAppData(storage: StorageLike = defaultStorage): AppData {
  const initial = createInitialAppData();
  saveAppData(initial, storage);
  return initial;
}
