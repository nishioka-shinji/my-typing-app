/**
 * keydown イベントの判定ロジック。
 *
 * DOM の `KeyboardEvent` を直接扱わず、必要なプロパティだけを持つ `KeyEventLike` を
 * 受け取る純粋関数として実装する（DOM に依存しないため Vitest の `environment: 'node'`
 * のまま単体テストできる）。実際の keydown 購読・副作用（コールバック呼び出し・
 * preventDefault の実行）は useKeyboardInput.ts（同ディレクトリ）が担当する。
 *
 * 判定順は docs/design.md §9 の表と、このタスク定義の steps に明記された優先順位に
 * 厳密に従う。順序を変えると t04 レビュアー申し送りの「Ctrl+A がミス扱いされてしまう」
 * 事故や、IME 変換中の入力がタイプ扱いされる事故につながるため変更しないこと。
 *
 * 参照元:
 *   - docs/design.md §9（キー入力ハンドリングの注意点）/ §3.3（Backspace 無効・修飾キー単独はミスにしない）
 *   - .claude/epics/typing-app/01-tasks.json t09 steps
 */

/** keydown イベントから判定に必要な最小限のプロパティだけを取り出したインターフェース。 */
export interface KeyEventLike {
  key: string;
  isComposing: boolean;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type KeyEventAction = 'ignore' | 'char' | 'escape';

/** action === 'ignore' の理由。IME 警告表示など呼び出し側の分岐に使う。 */
export type KeyEventIgnoreReason = 'ime' | 'repeat' | 'shortcut' | 'modifier';

export interface KeyEventClassification {
  action: KeyEventAction;
  /** action === 'char' のときのみ、入力として扱う 1 文字を持つ */
  char?: string;
  /** true ならブラウザ既定動作（フォーカス移動・スクロール・クイック検索等）を抑止すべき */
  preventDefault: boolean;
  /** action === 'ignore' の理由 */
  reason?: KeyEventIgnoreReason;
}

/**
 * repeat 中・修飾キー単独の分岐で「それでも既定動作は抑止したい」キー。
 * Space（スクロール）と `/` `'`（Firefox のクイック検索）が該当する。
 * Tab はこの集合に含めず、key.length > 1 の分岐内で個別に判定する
 * （'Tab' は 1 文字ではないため）。
 * 通常の char 判定（下記 classifyKeyEvent 末尾）では、このリストに関わらず
 * 全 char を preventDefault 対象にする（design.md §9: 「char と判定した全キー」）。
 */
const PREVENT_DEFAULT_WHEN_IGNORED = new Set([' ', '/', "'"]);

/**
 * keydown イベントを分類する。
 *
 * 判定順（design.md §9 / t09 steps）:
 *   1. isComposing なら ignore（reason: 'ime'）。IME 変換中の確定前入力を打鍵として扱わない。
 *   2. repeat なら ignore（reason: 'repeat'）。押しっぱなし連打を防ぐ。
 *   3. ctrlKey または metaKey が立っていれば ignore（reason: 'shortcut'）。
 *      ブラウザ/OS のショートカットを妨げない（t04 レビュアー申し送り: Ctrl+A 等を
 *      正打鍵として reducer に渡さないための一次フィルタはここが担う）。
 *   4. key === 'Escape' なら escape。
 *   5. key.length > 1（Shift/Control/Alt/Meta/CapsLock/Backspace/Tab/Enter 等）は ignore
 *      （reason: 'modifier'）。Backspace が「進めない方式」で無効なのもこの分岐による。
 *   6. それ以外は char。event.key をそのまま渡す（Shift 適用後の文字が入るため、
 *      記号や大文字もこの分岐で正しく拾える。findKeyForChar への受け渡しも同様の方針）。
 */
export function classifyKeyEvent(event: KeyEventLike): KeyEventClassification {
  if (event.isComposing) {
    return { action: 'ignore', reason: 'ime', preventDefault: false };
  }

  if (event.repeat) {
    return {
      action: 'ignore',
      reason: 'repeat',
      preventDefault: PREVENT_DEFAULT_WHEN_IGNORED.has(event.key),
    };
  }

  if (event.ctrlKey || event.metaKey) {
    // ショートカットの既定動作は必ず生かす（preventDefault しない）。
    return { action: 'ignore', reason: 'shortcut', preventDefault: false };
  }

  if (event.key === 'Escape') {
    return { action: 'escape', preventDefault: false };
  }

  if (event.key.length > 1) {
    return {
      action: 'ignore',
      reason: 'modifier',
      // Tab はフォーカス移動を防ぐため既定動作を抑止する。それ以外
      // (Shift/Control/Alt/Meta/CapsLock/Backspace/Enter 等) は既定動作のままでよい。
      preventDefault: event.key === 'Tab',
    };
  }

  return { action: 'char', char: event.key, preventDefault: true };
}
