import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS,
  FINGER_LABELS,
  findKeyForChar,
  KEYBOARD_ROWS,
  type Finger,
} from './keyboardUs';

/**
 * Lv1〜Lv8 (design.md §3.1) で出題されうる全文字。
 * levels.ts はまだ存在しないため、設計書の文字集合をここにハードコードして検証する。
 *
 * - 英字 26 文字（大文字・小文字とも Lv6 の Shift 練習や Lv7/Lv8 のコマンドで出現しうる）
 * - 数字 10 文字
 * - Lv5 (数字と基本記号): - = / . , ; に加え DECISIONS §5 で追加された [ ] \ '
 * - Lv6 (Shift & シェル記号): ~ ! @ # $ % ^ & * ( ) _ + { } | : " < > ?
 * - スペース
 */
const LOWERCASE_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');
const LV5_SYMBOLS = ['-', '=', '/', '.', ',', ';', '[', ']', '\\', "'"];
const LV6_SYMBOLS = [
  '~',
  '!',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '(',
  ')',
  '_',
  '+',
  '{',
  '}',
  '|',
  ':',
  '"',
  '<',
  '>',
  '?',
];

const ALL_CURRICULUM_CHARS = [
  ...LOWERCASE_LETTERS,
  ...UPPERCASE_LETTERS,
  ...DIGITS,
  ...LV5_SYMBOLS,
  ...LV6_SYMBOLS,
  ' ',
];

describe('KEYBOARD_ROWS', () => {
  it('全キーに担当指 (finger) が割り当てられている', () => {
    for (const key of ALL_KEYS) {
      expect(key.finger, `key ${key.id} に finger が無い`).toBeTruthy();
    }
  });

  it('5 行構成（数字段・上段・ホーム段・下段・スペース段）になっている', () => {
    expect(KEYBOARD_ROWS).toHaveLength(5);
  });

  it('全 Finger に日本語ラベルが定義されている（design.md §4: 色だけに依存しない）', () => {
    const fingersUsed = new Set(ALL_KEYS.map((k) => k.finger));
    for (const finger of fingersUsed) {
      expect(FINGER_LABELS[finger]).toBeTruthy();
      expect(typeof FINGER_LABELS[finger]).toBe('string');
    }
  });

  it('design.md §3.5 の運指表と一致する（代表キーのサンプリング）', () => {
    const byId = new Map(ALL_KEYS.map((k) => [k.id, k]));
    const expected: Array<[string, Finger]> = [
      ['q', 'lPinky'],
      ['b', 'lIndex'],
      ['m', 'rIndex'],
      ['comma', 'rMiddle'],
      ['slash', 'rPinky'],
      // 追加のサンプリング（表の全行を最低 1 件ずつカバー）
      ['backquote', 'lPinky'],
      ['w', 'lRing'],
      ['e', 'lMiddle'],
      ['tab', 'lPinky'],
      ['capsLock', 'lPinky'],
      ['shiftLeft', 'lPinky'],
      ['digit0', 'rPinky'],
      ['minus', 'rPinky'],
      ['equal', 'rPinky'],
      ['p', 'rPinky'],
      ['bracketLeft', 'rPinky'],
      ['bracketRight', 'rPinky'],
      ['backslash', 'rPinky'],
      ['semicolon', 'rPinky'],
      ['quote', 'rPinky'],
      ['enter', 'rPinky'],
      ['shiftRight', 'rPinky'],
      ['i', 'rMiddle'],
      ['o', 'rRing'],
      ['l', 'rRing'],
      ['period', 'rRing'],
      ['space', 'thumb'],
    ];
    for (const [id, finger] of expected) {
      expect(byId.get(id)?.finger, `key ${id}`).toBe(finger);
    }
  });

  it('unshifted 文字に重複が無い', () => {
    const chars = ALL_KEYS.map((k) => k.unshifted).filter((c): c is string => c !== undefined);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('shifted 文字に重複が無い', () => {
    const chars = ALL_KEYS.map((k) => k.shifted).filter((c): c is string => c !== undefined);
    expect(new Set(chars).size).toBe(chars.length);
  });
});

describe('findKeyForChar', () => {
  it('printable ASCII (0x20〜0x7e) すべてが解決できる', () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const char = String.fromCharCode(code);
      const match = findKeyForChar(char);
      expect(match, `char ${JSON.stringify(char)} (0x${code.toString(16)}) が解決できない`).not.toBeNull();
    }
  });

  it('Lv1〜Lv8 の全出題文字が解決できる', () => {
    for (const char of ALL_CURRICULUM_CHARS) {
      expect(findKeyForChar(char), `char ${JSON.stringify(char)}`).not.toBeNull();
    }
  });

  it('スペースは thumb キー（space）に needsShift: false で解決される', () => {
    const match = findKeyForChar(' ');
    expect(match?.key.id).toBe('space');
    expect(match?.key.finger).toBe('thumb');
    expect(match?.needsShift).toBe(false);
    expect(match?.shiftKeyId).toBeNull();
  });

  it('US 配列に存在しない文字は null を返す', () => {
    expect(findKeyForChar('あ')).toBeNull();
    expect(findKeyForChar('€')).toBeNull();
  });

  describe('Shift の要否', () => {
    it.each([
      ['a', false],
      ['A', true],
      [';', false],
      [':', true],
      ['\\', false],
      ['|', true],
    ] as const)('%s の needsShift は %s', (char, expected) => {
      expect(findKeyForChar(char)?.needsShift).toBe(expected);
    });
  });

  describe('反対の手の Shift ルール (design.md §3.4)', () => {
    it.each(['|', '"', '?', ')'])(
      '右手担当キーの shifted 文字 %s は左 Shift (shiftLeft) をハイライトする',
      (char) => {
        const match = findKeyForChar(char);
        expect(match?.needsShift).toBe(true);
        expect(match?.key.finger.startsWith('r')).toBe(true);
        expect(match?.shiftKeyId).toBe('shiftLeft');
      },
    );

    it.each(['!', '@', '#', '$', '%'])(
      '左手担当キーの shifted 文字 %s は右 Shift (shiftRight) をハイライトする',
      (char) => {
        const match = findKeyForChar(char);
        expect(match?.needsShift).toBe(true);
        expect(match?.key.finger.startsWith('l')).toBe(true);
        expect(match?.shiftKeyId).toBe('shiftRight');
      },
    );
  });

  it('逆引きの結果に矛盾が無い（同じ文字が毎回同じキーに解決される）', () => {
    for (const char of ALL_CURRICULUM_CHARS) {
      const first = findKeyForChar(char);
      const second = findKeyForChar(char);
      expect(second?.key.id).toBe(first?.key.id);
    }
  });
});
