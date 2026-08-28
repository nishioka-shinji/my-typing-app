import { describe, expect, it } from 'vitest';
import { WORDS } from './words';
import { getLevel } from './levels';

describe('WORDS', () => {
  it('280〜320 語程度である', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(280);
    expect(WORDS.length).toBeLessThanOrEqual(320);
  });

  it('全語が小文字 a-z のみで構成される', () => {
    for (const word of WORDS) {
      expect(word, `"${word}" が小文字 a-z のみ`).toMatch(/^[a-z]+$/);
    }
  });

  it('全語の長さが 3〜8 文字である', () => {
    for (const word of WORDS) {
      expect(word.length, `"${word}" の長さ`).toBeGreaterThanOrEqual(3);
      expect(word.length, `"${word}" の長さ`).toBeLessThanOrEqual(8);
    }
  });

  it('重複がない', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it('アルファベット順に整理されている', () => {
    const sorted = [...WORDS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(WORDS).toEqual(sorted);
  });

  it('Lv4 の charset (全英字) に全語が収まる', () => {
    const level4 = getLevel(4);
    const charset = new Set(level4.charset);
    for (const word of WORDS) {
      for (const char of word) {
        expect(charset.has(char), `"${word}" の "${char}" が Lv4 charset に含まれる`).toBe(true);
      }
    }
  });
});
