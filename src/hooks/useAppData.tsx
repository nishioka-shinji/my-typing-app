/**
 * AppData の読み書きを提供する React Context。
 *
 * 状態管理ライブラリは入れず、React 標準の `useReducer` ＋ Context のみで実装する
 * （design.md §7.1）。反映ロジックの純粋部分（進捗更新・レベル解放・ストリーク等）は
 * すべて appDataUpdates.ts に切り出し済みで、ここでは「いつ load/save するか」
 * 「純粋関数の結果をどう state に反映するか」だけを扱う。
 *
 * storage 層（t02 の loadAppData/saveAppData/resetAppData）はいずれも例外を投げない契約
 * のため、ここでの try/catch は不要（design.md §6.1「練習開始を絶対に妨げない」は
 * storage 層側で既に保証されている）。
 *
 * 参照元:
 *   - docs/design.md §7.1（状態管理方針）/ §6.1（storage の防御）
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppData, LevelId, SessionRecord, SessionSummary, Settings } from '../storage/schema';
import { loadAppData, saveAppData, resetAppData, type SaveAppDataResult } from '../storage/storage';
import { applySessionSummary } from './appDataUpdates';

type AppDataAction =
  | { type: 'SET'; data: AppData }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> };

function appDataReducer(state: AppData, action: AppDataAction): AppData {
  switch (action.type) {
    case 'SET':
      return action.data;
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    default:
      return state;
  }
}

/** `recordSession` の戻り値。結果画面（t15）が解放通知やレコード表示に使う。 */
export interface RecordSessionResult {
  record: SessionRecord;
  unlockedLevelId: LevelId | null;
}

export interface AppDataContextValue {
  appData: AppData;
  /**
   * 直近の `saveAppData` の結果。t02 の契約どおり `'ok' | 'degraded' | 'failed'` の
   * いずれか（初回ロード直後は `'ok'`）。`'degraded'`（容量超過で直近 5 件まで
   * 縮退保存された＝データ損失あり）・`'failed'`（保存できなかった）を握りつぶさず、
   * 通知するかどうかの判断は呼び出し側（t14 設定画面等）に委ねる。
   */
  saveStatus: SaveAppDataResult;
  /**
   * 契約: `updateSettings` と `recordSession` を同一 tick（同一イベントハンドラ内 /
   * バッチ処理される同一レンダーサイクル内）で両方呼び出さないこと。
   * どちらも内部的には「呼び出し時点の最新 state」を起点に新しい `AppData` を計算して
   * `dispatch({ type: 'SET', data })` するため、同一 tick 内で両方呼ぶと React の
   * バッチ更新により後勝ちの `SET` が先勝ちの変更を上書きし、片方の変更がサイレントに
   * 消える。呼び出し側は必ず別のユーザー操作（別イベント）として順に呼び出すこと。
   */
  updateSettings: (patch: Partial<Settings>) => void;
  /** 契約は {@link AppDataContextValue.updateSettings} の JSDoc を参照。 */
  recordSession: (summary: SessionSummary) => RecordSessionResult;
  resetAll: () => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

/** crypto.randomUUID が使えない実行環境（古いブラウザ等）向けのフォールバック。 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [appData, dispatch] = useReducer(appDataReducer, undefined, () => loadAppData());
  const [saveStatus, setSaveStatus] = useState<SaveAppDataResult>('ok');

  // 常に最新の appData を参照するための ref。イベントハンドラ（recordSession 等）から
  // 「直前の dispatch がまだ再レンダーに反映されていない」状態でも最新値を読めるようにする。
  // レンダーのたびに同期するだけで、副作用ではないため useEffect は不要。
  const appDataRef = useRef(appData);
  appDataRef.current = appData;

  // state 更新のたびに保存する（初回マウント時の正規化済みロード結果も含む）。
  useEffect(() => {
    const result = saveAppData(appData);
    setSaveStatus(result);
    if (result !== 'ok') {
      // 'degraded'（容量超過で直近5件へ縮退保存）・'failed'（保存不可）は握りつぶさず、
      // 少なくとも開発者コンソールには残す。ユーザー向け通知は t14 設定画面等の責務。
      console.warn(`[useAppData] saveAppData returned "${result}" (data loss may have occurred).`);
    }
  }, [appData]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', patch });
  }, []);

  const recordSession = useCallback((summary: SessionSummary): RecordSessionResult => {
    const now = Date.now();
    const id = generateId();
    const result = applySessionSummary(appDataRef.current, summary, now, id);
    dispatch({ type: 'SET', data: result.data });
    return { record: result.record, unlockedLevelId: result.unlockedLevelId };
  }, []);

  const resetAll = useCallback(() => {
    const initial = resetAppData();
    dispatch({ type: 'SET', data: initial });
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({ appData, saveStatus, updateSettings, recordSession, resetAll }),
    [appData, saveStatus, updateSettings, recordSession, resetAll],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

/**
 * AppData への読み書き手段を取得する。`AppDataProvider` の外で呼ぶとエラーを投げる
 * （設計上あり得ない使い方を早期に気付けるようにするため）。
 */
export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (ctx === null) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return ctx;
}
