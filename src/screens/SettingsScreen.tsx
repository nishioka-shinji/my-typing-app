/**
 * 設定画面。
 *
 * design.md §3.8 の設定項目 8 種（運指ガイド表示・画面内キーボード・次キーハイライト・
 * 効果音・1 セッションの問題数・レベルロック・統計グラフ表示・全データリセット）を
 * 編集できる UI を提供する。
 *
 * この画面自身は storage も画面遷移も一切扱わない props 駆動コンポーネント。
 * 永続化は親（t18 が useAppData（t10）と結線する）に委ねる。
 *
 * 判定ロジック（guideMode の 4 択マッピング・問題数のバリデーション・保存状態の警告判定・
 * リセット確認フローの状態遷移）はレンダリングなしに単体テストできるよう、このファイル内で
 * 純粋関数として export する（jsdom 未導入のためレンダリングテストは書けない: t01 制約）。
 * 検証は SettingsScreen.test.ts を参照。
 *
 * 参照元:
 *   - docs/design.md §3.8（設定項目一覧）/ §4（アクセシビリティ）
 *   - .claude/epics/typing-app/00-decisions.md §6（guideMode 'auto'）/ §13（soundEnabled 未実装）
 *   - .claude/epics/typing-app/CROSS-CUTTING.md §1（--text-dim はコントラスト基準未満）/
 *     §4（saveStatus の通知は t14 の責務）
 */
import { useId, useReducer } from 'react';
import type { Settings } from '../storage/schema';
import type { SaveAppDataResult } from '../storage/storage';
import './SettingsScreen.css';

// ---------- 純粋関数・定数（テスト対象。SettingsScreen.test.ts 参照） ----------

/**
 * 運指ガイド表示の選択肢（4 択）。value は Settings.guideMode の値と 1:1 対応する
 * (DECISIONS §6)。'auto' は「ユーザー未選択＝レベル連動」の sentinel 値。
 */
export const GUIDE_MODE_OPTIONS: ReadonlyArray<{ value: Settings['guideMode']; label: string }> = [
  { value: 'auto', label: 'レベル連動（自動）' },
  { value: 'always', label: '常時' },
  { value: 'onMiss', label: 'ミス時のみ' },
  { value: 'never', label: '非表示' },
];

/** 1 セッションの問題数の選択肢 (design.md §3.8)。 */
export const QUESTION_COUNT_OPTIONS: ReadonlyArray<Settings['questionCount']> = [10, 20, 30];

/** value が問題数として許可された値 (10/20/30) かどうかを判定する型ガード。 */
export function isValidQuestionCount(value: number): value is Settings['questionCount'] {
  return (QUESTION_COUNT_OPTIONS as readonly number[]).includes(value);
}

export type SaveStatusLevel = 'ok' | 'warning' | 'error';

export interface SaveStatusInfo {
  level: SaveStatusLevel;
  label: string;
  message: string;
}

/**
 * saveStatus（t10 useAppData.saveStatus、t02 saveAppData の戻り値）から表示用の警告
 * レベルと文言を導く。
 * - 'degraded': 容量超過で直近 5 件のセッションのみに縮退保存された＝データ損失あり。
 * - 'failed': 保存できなかった。
 * ホーム画面（t13）はこれを扱わない前提のため、通知するのはこの設定画面の責務
 * （CROSS-CUTTING.md §4）。
 */
export function getSaveStatusInfo(status: SaveAppDataResult): SaveStatusInfo {
  if (status === 'ok') {
    return { level: 'ok', label: '正常', message: '設定・練習記録は正常に保存されています。' };
  }
  if (status === 'degraded') {
    return {
      level: 'warning',
      label: '警告',
      message:
        '保存容量の上限を超えたため、練習記録が直近 5 件のみに削減されました。それより前の記録は失われています。',
    };
  }
  // 'failed'
  return {
    level: 'error',
    label: 'エラー',
    message:
      '設定・練習記録を保存できませんでした。このまま操作を続けると、変更内容やタブを閉じた際の記録が失われるおそれがあります。',
  };
}

/** 全データリセットの確認フロー状態。未確認 → 確認待ち → (実行 or キャンセルで未確認へ)。 */
export type ResetFlowState = 'idle' | 'confirming';

type ResetFlowAction = { type: 'REQUEST' } | { type: 'CONFIRM' } | { type: 'CANCEL' };

/**
 * リセット確認フローの状態遷移。実際の削除処理（onResetAll の呼び出し）はこの reducer の
 * 責務ではなく、CONFIRM を受け取った呼び出し側（SettingsScreen 本体）が別途行う。
 */
export function resetFlowReducer(state: ResetFlowState, action: ResetFlowAction): ResetFlowState {
  switch (action.type) {
    case 'REQUEST':
      return 'confirming';
    case 'CONFIRM':
      return 'idle';
    case 'CANCEL':
      return 'idle';
    default:
      return state;
  }
}

// ---------- コンポーネント ----------

export interface SettingsScreenProps {
  /** 現在の設定値（永続化済み、useAppData 経由で親から渡される）。 */
  settings: Settings;
  /** 設定の部分更新を親に伝える（親は useAppData.updateSettings をそのまま渡す想定）。 */
  onChange: (patch: Partial<Settings>) => void;
  /** 確認 UI で「削除する」が選ばれたときに呼ばれる（親は useAppData.resetAll を渡す想定）。 */
  onResetAll: () => void;
  /** ホーム画面等へ戻る。画面遷移自体はこの画面の外（呼び出し側）の責務。 */
  onBack: () => void;
  /**
   * 直近の保存結果 (t10 useAppData.saveStatus)。'degraded'/'failed' はデータ損失の
   * おそれがあるため、データ管理セクションで警告として表示する
   * （CROSS-CUTTING.md §4: ホーム画面 (t13) はこれを扱わない前提のため、ここが責務）。
   */
  saveStatus: SaveAppDataResult;
}

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * ON/OFF トグル。色だけに依存しないアクセシビリティ要件 (design.md §4) のため、
 * チェック状態に加えて「ON」「OFF」のテキストを併記する。
 */
function ToggleField({ label, checked, onChange }: ToggleFieldProps) {
  return (
    <label className="settingsscreen__field settingsscreen__field--toggle">
      <input
        type="checkbox"
        className="settingsscreen__checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settingsscreen__label">{label}</span>
      <span className={`settingsscreen__state settingsscreen__state--${checked ? 'on' : 'off'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </label>
  );
}

export function SettingsScreen({ settings, onChange, onResetAll, onBack, saveStatus }: SettingsScreenProps) {
  const [resetFlow, dispatchResetFlow] = useReducer(resetFlowReducer, 'idle' as ResetFlowState);
  const confirmTitleId = useId();

  const saveStatusInfo = getSaveStatusInfo(saveStatus);

  const handleConfirmReset = () => {
    // 先に確認 UI を閉じてから実行する（onResetAll 側で例外が起きても確認 UI が
    // 残り続けて操作不能になることを避けるため、状態遷移を先に確定させる）。
    dispatchResetFlow({ type: 'CONFIRM' });
    onResetAll();
  };

  return (
    <div className="settingsscreen">
      <header className="settingsscreen__header">
        <h1 className="settingsscreen__title">設定</h1>
        <button type="button" className="settingsscreen__back" onClick={onBack}>
          ← ホームへ戻る
        </button>
      </header>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">運指ガイド表示</h2>
        <label className="settingsscreen__field">
          <span className="settingsscreen__label">表示タイミング</span>
          <select
            className="settingsscreen__select"
            value={settings.guideMode}
            onChange={(e) => onChange({ guideMode: e.target.value as Settings['guideMode'] })}
          >
            {GUIDE_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <p className="settingsscreen__hint">
          「レベル連動（自動）」はレベルごとの既定表示に従います。それ以外を選ぶと、レベルが変わっても選んだ表示が優先されます。
        </p>
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">画面内キーボード</h2>
        <ToggleField
          label="画面内キーボードを表示する"
          checked={settings.showKeyboard}
          onChange={(checked) => onChange({ showKeyboard: checked })}
        />
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">次キーハイライト</h2>
        <ToggleField
          label="次に押すキーをハイライトする"
          checked={settings.highlightNextKey}
          onChange={(checked) => onChange({ highlightNextKey: checked })}
        />
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">効果音（未実装：トグルのみ）</h2>
        <ToggleField
          label="効果音を鳴らす（未実装：このトグルを ON にしても音は再生されません）"
          checked={settings.soundEnabled}
          onChange={(checked) => onChange({ soundEnabled: checked })}
        />
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">1 セッションの問題数</h2>
        <label className="settingsscreen__field">
          <span className="settingsscreen__label">問題数</span>
          <select
            className="settingsscreen__select"
            value={settings.questionCount}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (isValidQuestionCount(next)) {
                onChange({ questionCount: next });
              }
            }}
          >
            {QUESTION_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count} 問
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">レベルロック</h2>
        <ToggleField
          label="合格するまで次のレベルをロックする"
          checked={settings.levelLockEnabled}
          onChange={(checked) => onChange({ levelLockEnabled: checked })}
        />
      </section>

      <section className="settingsscreen__section">
        <h2 className="settingsscreen__section-title">統計グラフ表示</h2>
        <ToggleField
          label="統計グラフを表示する"
          checked={settings.showStats}
          onChange={(checked) => onChange({ showStats: checked })}
        />
      </section>

      <section className="settingsscreen__section settingsscreen__section--danger">
        <h2 className="settingsscreen__section-title">データ管理</h2>

        <p
          className={`settingsscreen__savestatus settingsscreen__savestatus--${saveStatusInfo.level}`}
          role={saveStatusInfo.level === 'ok' ? 'status' : 'alert'}
        >
          <span className="settingsscreen__savestatus-label">保存状態: {saveStatusInfo.label}</span>
          {saveStatusInfo.message}
        </p>

        {resetFlow === 'idle' ? (
          <button
            type="button"
            className="settingsscreen__reset-button"
            onClick={() => dispatchResetFlow({ type: 'REQUEST' })}
          >
            全データをリセット
          </button>
        ) : (
          <div className="settingsscreen__confirm" role="alertdialog" aria-labelledby={confirmTitleId}>
            <p className="settingsscreen__confirm-title" id={confirmTitleId}>
              本当に全データを削除しますか？
            </p>
            <p className="settingsscreen__confirm-body">
              進捗・練習記録・設定がすべて削除されます。<strong>この操作は取り消せません。</strong>
            </p>
            <div className="settingsscreen__confirm-actions">
              <button
                type="button"
                className="settingsscreen__confirm-cancel"
                autoFocus
                onClick={() => dispatchResetFlow({ type: 'CANCEL' })}
              >
                キャンセル
              </button>
              <button type="button" className="settingsscreen__confirm-ok" onClick={handleConfirmReset}>
                削除する（元に戻せません）
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
