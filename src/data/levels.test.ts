import { describe, expect, it } from 'vitest';
import { LEVELS, getLevel } from './levels';

describe('LEVELS', () => {
  it('8 レベルが定義されている', () => {
    expect(LEVELS).toHaveLength(8);
  });

  it('id が 1..8 で重複なく揃っている', () => {
    const ids = LEVELS.map((l) => l.id).slice().sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('randomChars / words レベルは charset が非空で items が未定義', () => {
    for (const level of LEVELS) {
      if (level.generator === 'randomChars' || level.generator === 'words') {
        expect(level.charset, `Lv${level.id} の charset`).toBeDefined();
        expect(level.charset!.length).toBeGreaterThan(0);
        expect(level.items).toBeUndefined();
      }
    }
  });

  it('fixedList レベルは items が questionCount より多い', () => {
    const fixedLevels = LEVELS.filter((l) => l.generator === 'fixedList');
    expect(fixedLevels).toHaveLength(2);
    for (const level of fixedLevels) {
      expect(level.items, `Lv${level.id} の items`).toBeDefined();
      expect(level.items!.length).toBeGreaterThan(level.questionCount);
      expect(level.charset).toBeUndefined();
    }
  });

  it('passAccuracy が 0〜1 の範囲である', () => {
    for (const level of LEVELS) {
      expect(level.passAccuracy).toBeGreaterThan(0);
      expect(level.passAccuracy).toBeLessThanOrEqual(1);
    }
  });

  it('questionCount が全レベル 20 である', () => {
    for (const level of LEVELS) {
      expect(level.questionCount).toBe(20);
    }
  });

  it('generator が設計書 §3.1 のとおり割り当てられている', () => {
    const expected: Record<number, string> = {
      1: 'randomChars',
      2: 'randomChars',
      3: 'randomChars',
      4: 'words',
      5: 'randomChars',
      6: 'randomChars',
      7: 'fixedList',
      8: 'fixedList',
    };
    for (const level of LEVELS) {
      expect(level.generator).toBe(expected[level.id]);
    }
  });

  it('defaultGuideMode が §3.5 の段階どおり (Lv1-3 always / Lv4-6 onMiss / Lv7-8 never)', () => {
    for (const level of LEVELS) {
      if (level.id <= 3) {
        expect(level.defaultGuideMode).toBe('always');
      } else if (level.id <= 6) {
        expect(level.defaultGuideMode).toBe('onMiss');
      } else {
        expect(level.defaultGuideMode).toBe('never');
      }
    }
  });

  it('Lv3 の charset に , . / が含まれ、英字 26 文字を網羅する (DECISIONS §4)', () => {
    const level3 = getLevel(3);
    const charset = level3.charset!;
    expect(charset).toContain(',');
    expect(charset).toContain('.');
    expect(charset).toContain('/');
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      expect(charset, `Lv3 charset に ${c} が含まれる`).toContain(c);
    }
  });

  it('Lv5 の charset に [ ] \\ \' が含まれる (DECISIONS §5)', () => {
    const level5 = getLevel(5);
    const charset = level5.charset!;
    expect(charset).toContain('[');
    expect(charset).toContain(']');
    expect(charset).toContain('\\');
    expect(charset).toContain("'");
  });

  it('Lv6 の記号一覧が設計書 §3.1 のまま変更されていない', () => {
    const level6 = getLevel(6);
    const expected = [
      '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
      '_', '+', '{', '}', '|', ':', '"', '<', '>', '?',
    ];
    expect(level6.charset).toEqual(expected);
  });

  it('Lv4 の charset は全英字 26 文字である', () => {
    const level4 = getLevel(4);
    expect(level4.charset).toHaveLength(26);
    expect(new Set(level4.charset).size).toBe(26);
  });

  it('Lv7/Lv8 の items 全件に hint が付いている', () => {
    for (const id of [7, 8] as const) {
      const level = getLevel(id);
      for (const item of level.items!) {
        expect(item.hint, `"${item.text}" の hint`).toBeTruthy();
      }
    }
  });
});

describe('getLevel', () => {
  it('id に対応する LevelDef を返す', () => {
    expect(getLevel(1).name).toBe('ホームポジション');
    expect(getLevel(8).name).toBe('実践 Git');
  });
});
