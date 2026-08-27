import { memo, type CSSProperties } from 'react';
import { FINGER_COLOR_VARS, FINGER_LABELS, type KeyDef } from '../data/keyboardUs';
import './KeyCap.css';

/**
 * KeyCap の見た目状態。
 * - idle: 通常表示
 * - next: 次に押すべきキー（design.md §3.4 最重要機能）
 * - shift: 次キーが Shift 必須のときに同時ハイライトする Shift キー（反対の手）
 * - miss: 直前にミスしたキー（120ms 赤フラッシュ, design.md §10.3）
 * - alert: 3 連続ミスによる強制点滅（design.md §3.3 ヘルプ強制介入）
 */
export type KeyCapState = 'idle' | 'next' | 'shift' | 'miss' | 'alert';

export interface KeyCapProps {
  /** 描画対象のキー定義。KEYBOARD_ROWS 由来の安定参照を渡すこと（React.memo の比較対象） */
  def: KeyDef;
  /** このキーの現在の表示状態 */
  state: KeyCapState;
  /** 運指カラー（縁取り色）と指名テキストのツールチップ/aria-label を出すか（design.md §3.5 / §4） */
  showFingerColor: boolean;
}

/**
 * 1 キー分の見た目。React.memo でラップし、def（安定参照）/ state（プリミティブ）/
 * showFingerColor（プリミティブ）のいずれも変化しない限り再レンダリングしない。
 * Keyboard 側は 56 キー分の要素を毎回生成するが、実際に打鍵のたびに変化するのは
 * 「直前の次キー」「新しい次キー」「(必要なら) Shift キー」「ミスキー」「alert キー」の
 * 数個だけなので、それ以外の KeyCap は memo の浅い比較で再描画をスキップする
 * （design.md §4: 打鍵ごとの再レンダリング範囲を該当キーに限定する要件への対応）。
 */
function KeyCapImpl({ def, state, showFingerColor }: KeyCapProps) {
  const fingerLabel = FINGER_LABELS[def.finger];
  const accessibleLabel = `${def.label} キー（担当: ${fingerLabel}）`;

  const style: CSSProperties | undefined = showFingerColor
    ? ({ '--keycap-finger-color': `var(${FINGER_COLOR_VARS[def.finger]})` } as CSSProperties)
    : undefined;

  const classNames = [
    'keycap',
    `keycap--${state}`,
    def.special ? 'keycap--special' : '',
    showFingerColor ? 'keycap--finger' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      style={{ ...style, flexGrow: def.width ?? 1, flexBasis: 0 }}
      data-key-id={def.id}
      // 色だけに依存しないアクセシビリティ要件 (design.md §4): 指名テキストを
      // aria-label とネイティブツールチップ (title) の両方で提供する。
      aria-label={accessibleLabel}
      title={showFingerColor ? accessibleLabel : def.label}
    >
      <span className="keycap__label">{def.label}</span>
    </div>
  );
}

export const KeyCap = memo(KeyCapImpl);
