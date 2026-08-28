import { describe, expect, it } from 'vitest';
import { resolveKeyStates } from './Keyboard';

/**
 * jsdom が未導入のため React コンポーネントのレンダリングテストは書けない
 * (t01 で非導入と確認済み)。代わりに、Keyboard から切り出した純粋関数
 * resolveKeyStates（キー id → 表示状態の決定ロジック）を単体テストする。
 * 見た目そのものの確認（配色・アニメーション・レイアウト）は npm run dev による
 * 手動確認で行う（report 参照）。
 *
 * 引数は resolveKeyStates(nextChar, missKeyId, highlightNextKey, alertKeyId) の順。
 * missKeyId の意味（「押した誤キー」であって「打つべきだったキー」ではない）は
 * Keyboard.tsx の KeyboardProps.missKeyId の JSDoc を参照（レビュー r1 対応）。
 */
describe('resolveKeyStates', () => {
  it('highlightNextKey が true かつ通常文字なら対象キーが next になる', () => {
    const states = resolveKeyStates('a', null, true, null);
    expect(states.get('a')).toBe('next');
    expect(states.get('shiftLeft')).toBeUndefined();
    expect(states.get('shiftRight')).toBeUndefined();
  });

  it('Shift 必須文字（|）は backslash キーと左 Shift の両方をハイライトする（design.md §3.4 の例）', () => {
    const states = resolveKeyStates('|', null, true, null);
    expect(states.get('backslash')).toBe('next');
    expect(states.get('shiftLeft')).toBe('shift');
    expect(states.get('shiftRight')).toBeUndefined();
  });

  it('Shift 必須文字（!）は反対の手（左手キーなので右 Shift）をハイライトする', () => {
    const states = resolveKeyStates('!', null, true, null);
    expect(states.get('digit1')).toBe('next');
    expect(states.get('shiftRight')).toBe('shift');
    expect(states.get('shiftLeft')).toBeUndefined();
  });

  it('highlightNextKey が false のときは何もハイライトしない', () => {
    const states = resolveKeyStates('|', null, false, null);
    expect(states.size).toBe(0);
  });

  it('nextChar が null のときは何もハイライトしない', () => {
    const states = resolveKeyStates(null, null, true, null);
    expect(states.size).toBe(0);
  });

  it('US 配列で解決できない文字（空文字・制御文字・非 ASCII）は無視される', () => {
    expect(resolveKeyStates('', null, true, null).size).toBe(0);
    expect(resolveKeyStates('\n', null, true, null).size).toBe(0);
    expect(resolveKeyStates('あ', null, true, null).size).toBe(0);
  });

  it('missKeyId が指定されるとそのキーが miss になる', () => {
    const states = resolveKeyStates('a', 'semicolon', true, null);
    expect(states.get('semicolon')).toBe('miss');
    expect(states.get('a')).toBe('next');
  });

  it('missKeyId が next キーと同じ id のときは miss が next を上書きする（仕様として固定）', () => {
    // 例: nextChar が '|'（backslash キー）で、ユーザーが誤って同じ backslash の
    // 別面（Shift なし面の '\'）を押してしまった等、next と missKeyId が
    // 同一キーを指すケース。この場合は miss を優先して表示する。
    const states = resolveKeyStates('|', 'backslash', true, null);
    expect(states.get('backslash')).toBe('miss');
  });

  it('alertKeyId が指定されるとそのキーが alert になり、miss より優先される', () => {
    const states = resolveKeyStates('a', 'semicolon', true, 'semicolon');
    expect(states.get('semicolon')).toBe('alert');
  });

  it('alert と next が異なるキーなら両立する', () => {
    const states = resolveKeyStates('a', null, true, 'semicolon');
    expect(states.get('a')).toBe('next');
    expect(states.get('semicolon')).toBe('alert');
  });

  it('スペースは thumb キー（id: space）に next として解決される', () => {
    const states = resolveKeyStates(' ', null, true, null);
    expect(states.get('space')).toBe('next');
  });
});
