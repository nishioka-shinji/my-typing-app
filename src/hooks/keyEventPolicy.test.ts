import { describe, expect, it } from 'vitest';
import { classifyKeyEvent, type KeyEventLike } from './keyEventPolicy';

/**
 * KeyEventLike のデフォルト値を持つテスト用イベントを作るヘルパ。
 * 個々のテストでは差分だけ上書きして意図を明確にする。
 */
function makeEvent(overrides: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

describe('classifyKeyEvent', () => {
  it('通常の英字は char になる', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'a' }));
    expect(result).toEqual({ action: 'char', char: 'a', preventDefault: true });
  });

  it('記号（Shift 併用文字）も char になる', () => {
    // event.key には Shift 適用後の文字が入る想定（design.md §9）。
    const result = classifyKeyEvent(makeEvent({ key: '!' }));
    expect(result).toEqual({ action: 'char', char: '!', preventDefault: true });
  });

  it('大文字も char になる', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'A' }));
    expect(result).toEqual({ action: 'char', char: 'A', preventDefault: true });
  });

  it('スペースは char になり preventDefault が true（スクロール抑止）', () => {
    const result = classifyKeyEvent(makeEvent({ key: ' ' }));
    expect(result).toEqual({ action: 'char', char: ' ', preventDefault: true });
  });

  it('event.repeat === true は ignore になる（reason: repeat）', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'a', repeat: true }));
    expect(result.action).toBe('ignore');
    expect(result.reason).toBe('repeat');
  });

  it('isComposing === true は ignore になり reason が ime', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'a', isComposing: true }));
    expect(result).toEqual({ action: 'ignore', reason: 'ime', preventDefault: false });
  });

  it('isComposing は repeat より優先して判定される', () => {
    // 判定順 1 位が isComposing であることの回帰テスト。
    const result = classifyKeyEvent(
      makeEvent({ key: 'a', isComposing: true, repeat: true }),
    );
    expect(result.reason).toBe('ime');
  });

  it('Ctrl+A は ignore になる（t04 レビュアー申し送りの回帰テスト: 最重要）', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'a', ctrlKey: true }));
    expect(result).toEqual({ action: 'ignore', reason: 'shortcut', preventDefault: false });
  });

  it('Cmd(Meta)+R は ignore になる', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'r', metaKey: true }));
    expect(result).toEqual({ action: 'ignore', reason: 'shortcut', preventDefault: false });
  });

  it.each(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Backspace', 'Enter'])(
    '修飾キー/制御キー単独 (%s) は ignore になり、preventDefault は false',
    (key) => {
      const result = classifyKeyEvent(makeEvent({ key }));
      expect(result.action).toBe('ignore');
      expect(result.reason).toBe('modifier');
      expect(result.preventDefault).toBe(false);
    },
  );

  it('Backspace は完全に無視される（進めない方式では消すものがない）', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'Backspace' }));
    expect(result.action).toBe('ignore');
  });

  it('Escape は escape になる', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'Escape' }));
    expect(result).toEqual({ action: 'escape', preventDefault: false });
  });

  it('Tab は ignore だが preventDefault は true（フォーカス移動を防ぐ）', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'Tab' }));
    expect(result.action).toBe('ignore');
    expect(result.reason).toBe('modifier');
    expect(result.preventDefault).toBe(true);
  });

  it('スラッシュは char かつ preventDefault が true（クイック検索抑止）', () => {
    const result = classifyKeyEvent(makeEvent({ key: '/' }));
    expect(result).toEqual({ action: 'char', char: '/', preventDefault: true });
  });

  it('シングルクオートは char かつ preventDefault が true（クイック検索抑止）', () => {
    const result = classifyKeyEvent(makeEvent({ key: "'" }));
    expect(result).toEqual({ action: 'char', char: "'", preventDefault: true });
  });

  it('スペースが repeat 中でも preventDefault は true のまま', () => {
    const result = classifyKeyEvent(makeEvent({ key: ' ', repeat: true }));
    expect(result.action).toBe('ignore');
    expect(result.preventDefault).toBe(true);
  });

  it('通常文字の repeat 中は preventDefault が false（Tab/Space/// 以外）', () => {
    const result = classifyKeyEvent(makeEvent({ key: 'a', repeat: true }));
    expect(result.preventDefault).toBe(false);
  });
});
