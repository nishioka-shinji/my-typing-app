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
 *   - .claude/epics/typing-app/tasks/t09/review-r1.md（r1 レビュー: altKey 未フィルタの major 指摘）
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

/**
 * classifyKeyEvent の判定結果。action で判別可能なユニオン（r1 レビュー nit 対応）にして
 * いるため、呼び出し側は `result.action === 'char'` 等で絞り込めば `char`/`reason` を
 * 型アサーション無しで安全に読める。
 */
export type KeyEventClassification =
  | { action: 'char'; char: string; preventDefault: boolean }
  | { action: 'ignore'; reason: KeyEventIgnoreReason; preventDefault: boolean }
  | { action: 'escape'; preventDefault: boolean };

/**
 * repeat 中の分岐で「それでも既定動作は抑止したい」キー。
 * Space（スクロール）と `/` `'`（Firefox のクイック検索）が該当する。
 * Tab はこの集合に含めず、key.length > 1 の分岐内で個別に判定する
 * （'Tab' は 1 文字ではないため）。
 * 通常の char 判定（下記 classifyKeyEvent 末尾）では、このリストに関わらず
 * 全 char を preventDefault 対象にする（design.md §9: 「char と判定した全キー」）ため、
 * このリストが効くのは repeat 分岐だけ（r1 レビュー nit 対応で命名をそれに合わせた）。
 */
const PREVENT_DEFAULT_ON_REPEAT = new Set([' ', '/', "'"]);

/**
 * keydown イベントを分類する。
 *
 * 判定順（design.md §9 / t09 steps）:
 *   1. isComposing なら ignore（reason: 'ime'）。IME 変換中の確定前入力を打鍵として扱わない。
 *   2. repeat なら ignore（reason: 'repeat'）。押しっぱなし連打を防ぐ。
 *   3. ctrlKey・metaKey・altKey のいずれかが立っていれば ignore（reason: 'shortcut'）。
 *      ブラウザ/OS のショートカットを妨げない（t04 レビュアー申し送り: Ctrl+A 等を
 *      正打鍵として reducer に渡さないための一次フィルタはここが担う）。
 *      altKey も同列に扱う（r1 レビュー major 指摘の回帰防止）: macOS では
 *      Option+a が event.key === 'å'（1 文字）になり、altKey を見ないと通常の
 *      char として reducer に渡ってしまう。Windows/Linux でも Alt+D 等のブラウザ
 *      ショートカットを打鍵として奪ってしまう。Windows の AltGr は ctrlKey も
 *      同時に立つため、この分岐に統合しても挙動は変わらない。US 配列の全レベル
 *      charset は Alt を必要としないため、入力の取りこぼしは発生しない。
 *   4. key === 'Escape' なら escape。
 *   5. key === 'Process'（IME 変換を開始した最初の keydown。Chrome/Edge の挙動として
 *      isComposing がまだ false のまま届く）は ignore（reason: 'ime'）として扱う。
 *      これにより IME ON にして最初の 1 文字目から警告を出せる（r1 レビュー minor 指摘の
 *      任意対応。実装コストが小さいため対応した）。
 *   6. key.length > 1（Shift/Control/Alt/Meta/CapsLock/Backspace/Tab/Enter 等）は ignore
 *      （reason: 'modifier'）。Backspace が「進めない方式」で無効なのもこの分岐による。
 *   7. それ以外は char。event.key をそのまま渡す（Shift 適用後の文字が入るため、
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
      preventDefault: PREVENT_DEFAULT_ON_REPEAT.has(event.key),
    };
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    // ショートカットの既定動作は必ず生かす（preventDefault しない）。
    return { action: 'ignore', reason: 'shortcut', preventDefault: false };
  }

  if (event.key === 'Escape') {
    return { action: 'escape', preventDefault: false };
  }

  if (event.key === 'Process') {
    return { action: 'ignore', reason: 'ime', preventDefault: false };
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
