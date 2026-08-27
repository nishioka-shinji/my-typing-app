import { useMemo } from 'react';
import {
  FINGER_COLOR_VARS,
  FINGER_LABELS,
  KEYBOARD_ROWS,
  findKeyForChar,
  type Finger,
} from '../data/keyboardUs';
import { KeyCap, type KeyCapState } from './KeyCap';
import './Keyboard.css';

/**
 * Keyboard の props。t16（練習画面）から状態を props として受け取る想定で、
 * このコンポーネント自身は Context / storage / typingReducer に一切依存しない。
 *
 * t16 統合時の契約:
 * - nextChar / missKey / alertKeyId はいずれも「表示すべき状態そのもの」であり、
 *   タイマー管理（ミスフラッシュを何 ms 後に消すか等）は呼び出し側の責務。
 * - showFingerGuide は resolveGuideMode(settings, level.defaultGuideMode) と
 *   shouldShowGuide(...) を解決した最終的な boolean を渡すこと（t05 の責務）。
 *   Keyboard 内部では設定を読みに行かない。
 */
export interface KeyboardProps {
  /** 次に入力すべき 1 文字。null なら次キーハイライト対象なし（問題未開始・完了時など） */
  nextChar: string | null;
  /**
   * 直前にミスしたキーの id（keyboardUs.ts の KeyDef.id、例 'backslash'）。
   * 赤フラッシュ演出（120ms）を出す対象。呼び出し側が一定時間後に null へ戻すこと。
   */
  missKey: string | null;
  /**
   * 運指ガイド（色分け＋指名テキストの凡例）を表示するか。
   * resolveGuideMode の解決結果を元に、呼び出し側で shouldShowGuide 相当の
   * 最終判定を済ませた boolean を渡すこと（design.md §3.5）。
   */
  showFingerGuide: boolean;
  /** 次キーハイライト機能そのものの ON/OFF（Settings.highlightNextKey, design.md §3.8） */
  highlightNextKey: boolean;
  /**
   * 3 連続ミス（consecutiveMiss === 3）によるヘルプ強制介入で強調点滅させる
   * キーの id。null なら点滅なし（design.md §3.3）。
   */
  alertKeyId: string | null;
}

/**
 * 各キー id に対する表示状態を算出する純粋関数。Keyboard コンポーネントから
 * ロジックを切り出すことで、jsdom 非導入下でもハイライト決定ロジックだけは
 * 単体テストできるようにしている（Keyboard.test.ts 参照）。
 *
 * 優先順位（重なった場合にどれを見せるか）:
 *   1. alert（3 連続ミスのヘルプ強制介入。最優先で常に見せる必要がある）
 *   2. miss（直前ミスの一過性フラッシュ）
 *   3. next / shift（次キーハイライト。findKeyForChar の判定をそのまま使い、
 *      Shift の左右は t06 の「対象キーと反対の手」ロジックに従う。自前実装しない）
 *   4. idle（デフォルト）
 */
export function resolveKeyStates(
  nextChar: string | null,
  missKey: string | null,
  highlightNextKey: boolean,
  alertKeyId: string | null,
): ReadonlyMap<string, KeyCapState> {
  const states = new Map<string, KeyCapState>();

  if (highlightNextKey && nextChar !== null) {
    const match = findKeyForChar(nextChar);
    if (match) {
      states.set(match.key.id, 'next');
      if (match.needsShift && match.shiftKeyId !== null) {
        states.set(match.shiftKeyId, 'shift');
      }
    }
  }

  if (missKey !== null) {
    states.set(missKey, 'miss');
  }

  if (alertKeyId !== null) {
    states.set(alertKeyId, 'alert');
  }

  return states;
}

const FINGER_ORDER: readonly Finger[] = [
  'lPinky',
  'lRing',
  'lMiddle',
  'lIndex',
  'thumb',
  'rIndex',
  'rMiddle',
  'rRing',
  'rPinky',
];

/**
 * 画面下部に常時描画する US 配列の画面内キーボード（design.md §3.4）。
 * props のみで完結し、単体で（Context も storage も無しで）表示確認できる。
 */
export function Keyboard({
  nextChar,
  missKey,
  showFingerGuide,
  highlightNextKey,
  alertKeyId,
}: KeyboardProps) {
  // KEYBOARD_ROWS 自体は t06 が確定した mutable な配列だが、ここでは参照するだけで
  // 一切書き換えない（マップ処理のみ）。
  const keyStates = useMemo(
    () => resolveKeyStates(nextChar, missKey, highlightNextKey, alertKeyId),
    [nextChar, missKey, highlightNextKey, alertKeyId],
  );

  return (
    <div className="keyboard">
      <div className="keyboard__rows" role="group" aria-label="画面内キーボード">
        {KEYBOARD_ROWS.map((row, rowIndex) => {
          const isSpaceRow = rowIndex === KEYBOARD_ROWS.length - 1;
          return (
            <div
              className={`keyboard__row${isSpaceRow ? ' keyboard__row--space' : ''}`}
              key={rowIndex}
            >
              {row.map((def) => (
                <KeyCap
                  key={def.id}
                  def={def}
                  state={keyStates.get(def.id) ?? 'idle'}
                  showFingerColor={showFingerGuide}
                />
              ))}
            </div>
          );
        })}
      </div>

      {showFingerGuide && (
        <ul className="keyboard__legend" aria-label="運指ガイドの凡例（色と指名の対応表）">
          {FINGER_ORDER.map((finger) => (
            <li className="keyboard__legend-item" key={finger}>
              <span
                className="keyboard__legend-swatch"
                style={{ backgroundColor: `var(${FINGER_COLOR_VARS[finger]})` }}
                aria-hidden="true"
              />
              <span className="keyboard__legend-label">{FINGER_LABELS[finger]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
