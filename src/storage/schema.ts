/**
 * 全モジュールが依存する共有型定義と初期値。
 *
 * このファイルは t01 完了時点で凍結される（.claude/epics/typing-app/01-tasks.json
 * common_notes 参照）。後続タスクは型を変更してはならない。型の不足に気付いた場合は
 * 自分で追記せず STATUS: BLOCKED として報告すること。
 *
 * 参照元:
 *   - docs/design.md §6（データモデル）/ §7.2（ディレクトリ構成）/ §10.1（カラートークン）
 *   - .claude/epics/typing-app/00-decisions.md §6（guideMode 'auto'）/ §9（startedAt）/
 *     §10（lastKeyAt）
 *   - docs/decisions.md §13（効果音は常時再生・トグルなし。旧 sound トグル設定は廃止）
 */

// ---------- カリキュラム定義（静的データ） ----------

export type LevelId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 全レベル id の配列（進捗の初期化やループに使う） */
export const LEVEL_IDS: readonly LevelId[] = [1, 2, 3, 4, 5, 6, 7, 8];

export type GuideMode = 'always' | 'onMiss' | 'never';

export interface LevelDef {
  id: LevelId;
  name: string;
  description: string;
  /** 問題生成に使う文字集合。ランダム生成レベル（randomChars）で使用 */
  charset?: string[];
  /** 固定問題リスト。Lv7/Lv8 のようにコマンドを出すレベルで使用 */
  items?: DrillItem[];
  /** 生成方式 */
  generator: 'randomChars' | 'words' | 'fixedList';
  questionCount: number;
  /** 合格基準の正確率。0..1 (例: 0.96) */
  passAccuracy: number;
  /** 合格基準の KPM (例: 100) */
  passKpm: number;
  defaultGuideMode: GuideMode;
}

export interface DrillItem {
  text: string;
  /** Lv7/Lv8 で表示する意味の説明（日本語 1 行） */
  hint?: string;
}

// ---------- 実行時の状態（タイピングエンジン） ----------

export interface KeyStat {
  /** 正解 + ミスの合計試行回数 */
  attempts: number;
  misses: number;
  /** レイテンシの総和（平均算出用）。各問題の 1 文字目は含めない (DECISIONS §10) */
  totalLatencyMs: number;
}

export interface TypingState {
  /** 弱点特訓セッションは 'weakness' */
  levelId: LevelId | 'weakness';
  items: DrillItem[];
  /** 何問目か (0-indexed) */
  currentIndex: number;
  /** 現在の問題内での文字位置 */
  cursor: number;
  /**
   * セッション内の最初の有効打鍵(KEY_PRESS)時刻。初期値 null、初回 KEY_PRESS で確定する
   * (DECISIONS §9)。1 打鍵もしていないセッションでは null のまま。
   */
  startedAt: number | null;
  /**
   * 直前の確定打鍵時刻（latency 計算用）。問題切替時に null へリセットし、各問題の
   * 1 文字目は totalLatencyMs に加算しない (DECISIONS §10)。
   */
  lastKeyAt: number | null;
  /** セッション最終確定打鍵時刻。durationMs の終端に使う */
  lastInputAt: number | null;
  correctCount: number;
  missCount: number;
  /** 同一文字での連続ミス回数。3 でヘルプ強制介入 */
  consecutiveMiss: number;
  /** キーは「期待文字」（打つべきキー）。弱点分析はキー単位の習熟度を見るため */
  keyStats: Record<string, KeyStat>;
}

export type TypingAction =
  | { type: 'KEY_PRESS'; key: string; at: number }
  | { type: 'NEXT_QUESTION' }
  | { type: 'RESET' };

// ---------- 保存データ ----------

export interface SessionRecord {
  /** uuid */
  id: string;
  /** 弱点特訓は 'weakness' */
  levelId: LevelId | 'weakness';
  playedAt: number;
  durationMs: number;
  /** 0..1 */
  accuracy: number;
  kpm: number;
  correctCount: number;
  missCount: number;
  passed: boolean;
  keyStats: Record<string, KeyStat>;
}

export interface LevelProgress {
  unlocked: boolean;
  cleared: boolean;
  bestKpm: number;
  bestAccuracy: number;
  playCount: number;
}

export interface Settings {
  /** 'auto' は「ユーザー未選択」を意味する sentinel 値 (DECISIONS §6) */
  guideMode: GuideMode | 'auto';
  showKeyboard: boolean;
  highlightNextKey: boolean;
  questionCount: 10 | 20 | 30;
  levelLockEnabled: boolean;
  showStats: boolean;
}

export interface AppData {
  /** 現在 1 */
  schemaVersion: number;
  progress: Record<LevelId, LevelProgress>;
  /** 直近 20 件のみ保持（新しい順） */
  sessions: SessionRecord[];
  /** 全期間の累積キー統計（無重み）。統計画面のヒートマップ専用で弱点分析には使わない (DECISIONS §7) */
  aggregateKeyStats: Record<string, KeyStat>;
  totals: {
    totalKeystrokes: number;
    totalTimeMs: number;
    streakDays: number;
    /** 'YYYY-MM-DD' 形式のローカル日付。未プレイなら空文字 */
    lastPlayedDate: string;
  };
  settings: Settings;
}

// ---------- UI 契約型 ----------

export type ScreenName = 'home' | 'practice' | 'result' | 'stats' | 'settings';

/** ホーム画面から練習画面へ渡す、これから始めるセッションの内容 */
export interface PracticeRequest {
  kind: 'level' | 'weakness';
  levelId: LevelId | 'weakness';
  title: string;
  items: DrillItem[];
  passAccuracy: number;
  passKpm: number;
  guideMode: GuideMode;
}

/** TypingState から算出したセッション集計結果（永続化前） */
export interface SessionSummary {
  levelId: LevelId | 'weakness';
  durationMs: number;
  accuracy: number;
  kpm: number;
  wpm: number;
  correctCount: number;
  missCount: number;
  passed: boolean;
  keyStats: Record<string, KeyStat>;
}

/** 結果画面に渡す、永続化後のセッション結果 */
export interface SessionResult {
  record: SessionRecord;
  passAccuracy: number;
  passKpm: number;
  wpm: number;
  /** 合格して新たに解放されたレベル。無ければ null */
  unlockedLevelId: LevelId | null;
  levelTitle: string;
}

// ---------- 定数・初期値 ----------

export const SCHEMA_VERSION = 1;

export const STORAGE_KEY = 'my-typing-app:v1';
export const BACKUP_STORAGE_KEY = 'my-typing-app:v1:backup';

/** design.md §3.8 の初期値 */
export const DEFAULT_SETTINGS: Settings = {
  guideMode: 'auto',
  showKeyboard: true,
  highlightNextKey: true,
  questionCount: 20,
  levelLockEnabled: true,
  showStats: true,
};

function createInitialLevelProgress(unlocked: boolean): LevelProgress {
  return {
    unlocked,
    cleared: false,
    bestKpm: 0,
    bestAccuracy: 0,
    playCount: 0,
  };
}

/**
 * AppData の初期値を新しいインスタンスとして返す。呼び出しごとに独立したオブジェクト
 * （progress/settings を含む）を生成し、参照を共有しない。
 */
export function createInitialAppData(): AppData {
  const progress = LEVEL_IDS.reduce<Record<LevelId, LevelProgress>>(
    (acc, levelId) => {
      acc[levelId] = createInitialLevelProgress(levelId === 1);
      return acc;
    },
    {} as Record<LevelId, LevelProgress>,
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    progress,
    sessions: [],
    aggregateKeyStats: {},
    totals: {
      totalKeystrokes: 0,
      totalTimeMs: 0,
      streakDays: 0,
      lastPlayedDate: '',
    },
    settings: { ...DEFAULT_SETTINGS },
  };
}
