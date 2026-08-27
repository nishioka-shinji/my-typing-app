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
 * - nextChar / missKeyId / alertKeyId はいずれも「表示すべき状態そのもの」であり、
 *   タイマー管理（ミスフラッシュを何 ms 後に消すか等）は呼び出し側の責務。
 * - showFingerGuide は resolveGuideMode(settings, level.defaultGuideMode) と
 *   shouldShowGuide(...) を解決した最終的な boolean を渡すこと（t05 の責務）。
 *   Keyboard 内部では設定を読みに行かない。
 */
export interface KeyboardProps {
  /** 次に入力すべき 1 文字。null なら次キーハイライト対象なし（問題未開始・完了時など） */
  nextChar: string | null;
  /**
   * ミスの視覚フィードバック対象キーの id（keyboardUs.ts の KeyDef.id）。
   *
   * **意味の定義（レビュー r1 の question 対応で確定）: 「ユーザーが実際に押してしまった
   * （誤った）キー」の id を渡すこと。「本来打つべきだったキー」ではない。**
   * 呼び出し側（t16）は、ユーザーが打った文字 `actualChar` から
   * `findKeyForChar(actualChar)?.key.id ?? null` で変換して渡す想定。
   *
   * 理由: `state` は 1 キーにつき単一値しか持てないため、`missKeyId` に
   * 「打つべきだったキー」（＝ `nextChar` と同じキーになりやすい）を渡すと、
   * ミス表示中は次キーハイライト（青）が消えて赤枠だけになってしまう。
   * ミス直後はまさにユーザーが正しいキーを探して打ち直そうとしている瞬間なので、
   * 次キーハイライトが消えるのは最悪のタイミングになる。「押した誤キー」を渡す
   * 運用であれば、通常 `nextChar` とは別のキーになるため両方のハイライトが共存できる
   * （`nextChar` と同じキーを誤って別の面（大文字/記号）で押した等、稀に一致する
   * ケースでは miss 表示が next より優先される。resolveKeyStates 参照）。
   *
   * `KeyDef.id`（例 'semicolon'、'digit1'）であって文字そのものではない点に注意。
   * 英字キーは偶然 id と文字が一致する（'a' キーの id は 'a'）が、記号・数字キーは
   * 一致しない（';' の id は 'semicolon'、'1' の id は 'digit1'）ため、文字を
   * そのまま渡すと記号・数字だけ静かに反応しなくなる。
   *
   * フラッシュ演出（120ms）を出す対象。呼び出し側が一定時間後（120ms より少し長め、
   * 例 150ms 程度）に null へ戻すこと。
   */
  missKeyId: string | null;
  /**
   * `missKeyId` が変化していなくても、同じキーへの新しいミスが発生したことを
   * Keyboard に伝えるための単調増加カウンタ。
   *
   * 背景（レビュー r1 major-2 対応）: 同一キーを連続でミスすると `missKeyId` が
   * 同じ値のまま渡され続けるため、`KeyCap` は `React.memo` により再レンダリングされず
   * CSS アニメーションも再生されない。`missSeq` に「ミスのたびに必ず変化する値」
   * （例えば `TypingState.missCount` をそのまま渡せばよい）を渡すことで、
   * Keyboard 側が該当キーの React `key` を変えて強制的に作り直し、同じキーへの
   * 2 回目以降のミスでも確実にフラッシュ演出を再生する。
   *
   * `missKeyId` が null のときは参照されない。
   */
  missSeq: number;
  /**
   * 運指ガイド（色＋指名テキストの凡例）を表示するか。
   * resolveGuideMode の解決結果を元に、呼び出し側で shouldShowGuide 相当の
   * 最終判定を済ませた boolean を渡すこと（design.md §3.5）。
   */
  showFingerGuide: boolean;
  /**
   * 次キーハイライト機能そのものの ON/OFF（Settings.highlightNextKey, design.md §3.8）。
   * これが false でも alertKeyId の点滅は表示される
   * （3 連続ミスのヘルプ強制介入はハイライト設定より優先する）。
   */
  highlightNextKey: boolean;
  /**
   * 3 連続ミス以上（`consecutiveMiss >= 3`。ちょうど 3 ではない。
   * `src/engine/guideMode.ts` の `shouldShowGuide` と同じ閾値条件に揃えること）
   * によるヘルプ強制介入で強調点滅させるキーの id。null なら点滅なし（design.md §3.3）。
   * 通常は「次に打つべき文字」に対応するキー id を渡す想定（点滅対象は
   * 「次に押すべきキー」であるべきなので、`missKeyId` とは異なり `nextChar` 側の
   * キーを指すのが自然）。タイマー管理は不要で、`consecutiveMiss` が 0 に戻れば
   * （＝正打鍵で）呼び出し側が null に戻すだけでよい。
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
 *
 * missKeyId が next（または shift）と同じキー id になった場合、miss が優先され
 * そのキーは 'miss' として描画される（Keyboard.test.ts で固定した仕様）。
 */
export function resolveKeyStates(
  nextChar: string | null,
  missKeyId: string | null,
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

  if (missKeyId !== null) {
    states.set(missKeyId, 'miss');
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
  missKeyId,
  missSeq,
  showFingerGuide,
  highlightNextKey,
  alertKeyId,
}: KeyboardProps) {
  // KEYBOARD_ROWS 自体は t06 が確定した mutable な配列だが、ここでは参照するだけで
  // 一切書き換えない（マップ処理のみ）。keyStates は毎レンダー再計算するが、
  // 軽量な Map 構築（最大 56 件）なので useMemo は使わず単純化している
  // （依存配列の保守コストの方が高い規模）。
  const keyStates = resolveKeyStates(nextChar, missKeyId, highlightNextKey, alertKeyId);

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
              {row.map((def) => {
                // 同じキーへの連続ミスでも赤フラッシュを必ず再生するため、
                // ミス対象キーだけは missSeq を React の key に含めて強制的に
                // 作り直す（React.memo をバイパスして DOM ノードごと再生成し、
                // CSS アニメーションを最初から再生させる）。他のキーは id を
                // key にしたままにして、memo による再描画スキップを維持する
                // （レビュー指摘 major-2 対応）。
                const reactKey = def.id === missKeyId ? `${def.id}:miss:${missSeq}` : def.id;
                return (
                  <KeyCap
                    key={reactKey}
                    def={def}
                    state={keyStates.get(def.id) ?? 'idle'}
                    showFingerColor={showFingerGuide}
                  />
                );
              })}
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
