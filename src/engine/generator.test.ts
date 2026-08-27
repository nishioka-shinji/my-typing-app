import { describe, expect, it } from 'vitest';
import {
  generateFixedListItems,
  generateItems,
  generateRandomCharsItems,
  generateWeaknessItems,
  generateWordsItems,
  shuffle,
} from './generator';
import type { Rng } from './generator';
import { LEVELS, getLevel } from '../data/levels';
import { WORDS } from '../data/words';
import { SHELL_COMMANDS, GIT_COMMANDS } from '../data/commands';
import type { DrillItem } from '../storage/schema';

/**
 * mulberry32 による決定的な擬似乱数生成器（テスト専用）。
 * 同じ seed からは常に同じ数列を返す。Math.random には一切依存しない。
 */
function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 与えた数値の配列を順番に繰り返し返す rng（テスト専用）。
 * 特定の分岐を狙い撃ちする敵対的なテストケース用。
 */
function createCycleRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function charsOf(text: string): string[] {
  return text.split('');
}

/** text 中に同一文字が 3 回以上連続する箇所が無いかを確認する。 */
function hasNoTripleRun(text: string): boolean {
  for (let i = 0; i + 2 < text.length; i++) {
    if (text[i] === text[i + 1] && text[i + 1] === text[i + 2]) {
      return false;
    }
  }
  return true;
}

describe('generateRandomCharsItems', () => {
  it('questionCount と同じ件数を返す（10/20/30 いずれも）', () => {
    const charset = ['a', 's', 'd', 'f'];
    for (const count of [10, 20, 30]) {
      const items = generateRandomCharsItems(charset, count, createSeededRng(1));
      expect(items).toHaveLength(count);
    }
  });

  it('生成される全文字が charset に収まる（charset 外混入なし: design.md §11）', () => {
    const charset = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];
    const charsetSet = new Set(charset);
    const items = generateRandomCharsItems(charset, 200, createSeededRng(42));
    for (const item of items) {
      for (const ch of charsOf(item.text)) {
        expect(charsetSet.has(ch)).toBe(true);
      }
    }
  });

  it('各問題の長さが 1〜5 に収まる', () => {
    const charset = ['a', 'b', 'c'];
    const items = generateRandomCharsItems(charset, 300, createSeededRng(7));
    for (const item of items) {
      expect(item.text.length).toBeGreaterThanOrEqual(1);
      expect(item.text.length).toBeLessThanOrEqual(5);
    }
  });

  it('rng を固定すると出力が決定的になる（同じ seed → 同じ結果）', () => {
    const charset = ['a', 'b', 'c', 'd'];
    const itemsA = generateRandomCharsItems(charset, 30, createSeededRng(123));
    const itemsB = generateRandomCharsItems(charset, 30, createSeededRng(123));
    expect(itemsA).toEqual(itemsB);
  });

  it('敵対的な rng（常に先頭候補を選ぼうとする）でも同一文字が 3 連続しない', () => {
    // 長さは毎回 5（rng() = 0.999... → floor(0.999*5)+1 = 5）、
    // 文字選択は毎回「除外前の候補の先頭」を選ぼうとする rng() = 0 を注入する。
    // 対策が無ければ 'aaaaa' のような 3 連続が発生するはずのケース。
    const rng = createCycleRng([0.999, 0, 0, 0, 0, 0]);
    const charset = ['a', 'b'];
    const items = generateRandomCharsItems(charset, 50, rng);
    for (const item of items) {
      expect(item.text).toHaveLength(5);
      expect(hasNoTripleRun(item.text)).toBe(true);
    }
  });

  it('多数の実データ（Lv1〜Lv6 の charset）でも 3 連続が発生しない', () => {
    const randomCharLevels = LEVELS.filter((l) => l.generator === 'randomChars');
    for (const level of randomCharLevels) {
      const items = generateRandomCharsItems(level.charset ?? [], 100, createSeededRng(level.id));
      for (const item of items) {
        expect(hasNoTripleRun(item.text)).toBe(true);
      }
    }
  });

  it('charset が空でも無限ループ・クラッシュせず、空文字の問題を返す', () => {
    const items = generateRandomCharsItems([], 20, createSeededRng(1));
    expect(items).toHaveLength(20);
    for (const item of items) {
      expect(item.text).toBe('');
    }
  });

  it('charset が 1 文字だけでも無限ループ・クラッシュしない（3 連続回避と衝突するケース）', () => {
    const items = generateRandomCharsItems(['x'], 50, createSeededRng(2));
    expect(items).toHaveLength(50);
    for (const item of items) {
      expect(item.text.length).toBeGreaterThanOrEqual(1);
      expect(item.text.length).toBeLessThanOrEqual(5);
      // 選べる文字が 'x' しかないため、3 連続制約より優先して 'x' を使い続ける。
      for (const ch of charsOf(item.text)) {
        expect(ch).toBe('x');
      }
    }
  });

  it('questionCount が 0 以下なら空配列を返す', () => {
    expect(generateRandomCharsItems(['a'], 0, createSeededRng(1))).toEqual([]);
  });
});

describe('generateWordsItems', () => {
  it('Lv4 の charset に収まる単語だけを返す（実データで検証）', () => {
    const level4 = getLevel(4);
    const charsetSet = new Set(level4.charset ?? []);
    const wordSet = new Set(WORDS);
    const items = generateWordsItems(level4.charset ?? [], 20, createSeededRng(3));

    expect(items).toHaveLength(20);
    for (const item of items) {
      expect(wordSet.has(item.text)).toBe(true);
      for (const ch of charsOf(item.text)) {
        expect(charsetSet.has(ch)).toBe(true);
      }
    }
  });

  it('charset に収まらない単語は抽出されない（限定的な charset で検証）', () => {
    // WORDS 中で h/e/l/o のみで構成される単語は 'hello' のみ。
    const charset = ['h', 'e', 'l', 'o'];
    const items = generateWordsItems(charset, 10, createSeededRng(4));
    expect(items).toHaveLength(10);
    for (const item of items) {
      expect(item.text).toBe('hello');
    }
  });

  it('単語数が questionCount より少ない場合、重複を許して埋める（無限ループしない）', () => {
    const charset = ['h', 'e', 'l', 'o'];
    const items = generateWordsItems(charset, 37, createSeededRng(5));
    expect(items).toHaveLength(37);
    expect(items.every((item) => item.text === 'hello')).toBe(true);
  });

  it('charset に収まる単語が 1 つも無い場合、空文字で埋めてクラッシュしない', () => {
    const items = generateWordsItems(['z'], 15, createSeededRng(6));
    expect(items).toHaveLength(15);
    for (const item of items) {
      expect(item.text).toBe('');
    }
  });

  it('questionCount が 0 以下なら空配列を返す', () => {
    expect(generateWordsItems(['a', 'b', 'c'], 0, createSeededRng(1))).toEqual([]);
  });
});

describe('generateFixedListItems', () => {
  const pool: DrillItem[] = [
    { text: 'ls -la', hint: '詳細一覧' },
    { text: 'cd ..', hint: '親へ移動' },
    { text: 'pwd', hint: 'パス表示' },
    { text: 'cat a.txt', hint: '表示' },
    { text: 'git status', hint: '状態確認' },
  ];

  it('questionCount 件を返し、元プールの部分集合で hint を保持する', () => {
    const items = generateFixedListItems(pool, 3, createSeededRng(1));
    expect(items).toHaveLength(3);
    for (const item of items) {
      const original = pool.find((p) => p.text === item.text);
      expect(original).toBeDefined();
      expect(item.hint).toBe(original?.hint);
    }
    // 重複が無いこと（シャッフル後の先頭抽出なので同じ要素が 2 回出ない）
    const texts = items.map((i) => i.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('プールが questionCount より少ない場合は全件を返す（水増ししない）', () => {
    const items = generateFixedListItems(pool, 1000, createSeededRng(2));
    expect(items).toHaveLength(pool.length);
    const texts = new Set(items.map((i) => i.text));
    expect(texts).toEqual(new Set(pool.map((p) => p.text)));
  });

  it('items が空なら空配列を返す', () => {
    expect(generateFixedListItems([], 10, createSeededRng(1))).toEqual([]);
  });

  it('questionCount が 0 以下なら空配列を返す', () => {
    expect(generateFixedListItems(pool, 0, createSeededRng(1))).toEqual([]);
  });
});

describe('generateItems（レベル定義からのディスパッチ）', () => {
  it('全レベルで questionCount と同じ件数を返し、charset があれば charset 外混入が無い', () => {
    for (const level of LEVELS) {
      const items = generateItems(level, { questionCount: level.questionCount, rng: createSeededRng(level.id) });
      expect(items).toHaveLength(level.questionCount);

      if (level.charset) {
        const charsetSet = new Set(level.charset);
        for (const item of items) {
          for (const ch of charsOf(item.text)) {
            expect(charsetSet.has(ch)).toBe(true);
          }
        }
      }
    }
  });

  it('options.questionCount で level.questionCount を上書きできる（設定の 10/20/30 反映）', () => {
    const level1 = getLevel(1);
    for (const count of [10, 20, 30]) {
      const items = generateItems(level1, { questionCount: count, rng: createSeededRng(9) });
      expect(items).toHaveLength(count);
    }
  });

  it('Lv7/Lv8（fixedList）は元プールの要素を返し hint を保持する', () => {
    const level7 = getLevel(7);
    const items7 = generateItems(level7, { rng: createSeededRng(7) });
    expect(items7).toHaveLength(level7.questionCount);
    for (const item of items7) {
      const original = SHELL_COMMANDS.find((c) => c.text === item.text);
      expect(original).toBeDefined();
      expect(item.hint).toBe(original?.hint);
    }

    const level8 = getLevel(8);
    const items8 = generateItems(level8, { rng: createSeededRng(8) });
    expect(items8).toHaveLength(level8.questionCount);
    for (const item of items8) {
      const original = GIT_COMMANDS.find((c) => c.text === item.text);
      expect(original).toBeDefined();
      expect(item.hint).toBe(original?.hint);
    }
  });

  it('rng を省略すると Math.random 由来で動作しクラッシュしない', () => {
    const level1 = getLevel(1);
    const items = generateItems(level1);
    expect(items).toHaveLength(level1.questionCount);
  });
});

describe('generateWeaknessItems', () => {
  it('weakKeys が空配列でもクラッシュせず、charset 内の文字だけで生成する（通常の randomChars にフォールバック）', () => {
    const charset = ['a', 'b', 'c'];
    const charsetSet = new Set(charset);
    const items = generateWeaknessItems([], charset, { questionCount: 20, rng: createSeededRng(1) });
    expect(items).toHaveLength(20);
    for (const item of items) {
      for (const ch of charsOf(item.text)) {
        expect(charsetSet.has(ch)).toBe(true);
      }
    }
  });

  it('questionCount を省略すると 20 件生成する（design.md §3.6）', () => {
    const items = generateWeaknessItems(['a'], ['a', 'b', 'c'], { rng: createSeededRng(1) });
    expect(items).toHaveLength(20);
  });

  it('各問題について弱点キーが 40% 以上の頻度で含まれる（design.md §3.6）', () => {
    const weakKeys = ['p'];
    const charset = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';', 'p'];
    const items = generateWeaknessItems(weakKeys, charset, {
      questionCount: 200,
      rng: createSeededRng(11),
    });

    expect(items).toHaveLength(200);
    for (const item of items) {
      const weakCount = charsOf(item.text).filter((ch) => weakKeys.includes(ch)).length;
      const ratio = weakCount / item.text.length;
      expect(ratio).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });

  it('弱点キーの出現重みが非弱点キーより有意に高い（3 倍相当の重み付け）', () => {
    const weakKeys = ['p'];
    const charset = ['a', 'p', 'q']; // 'p' が弱点、'a'/'q' はそれ以外
    const items = generateWeaknessItems(weakKeys, charset, {
      questionCount: 500,
      rng: createSeededRng(22),
    });

    let pCount = 0;
    let qCount = 0;
    for (const item of items) {
      for (const ch of charsOf(item.text)) {
        if (ch === 'p') pCount++;
        if (ch === 'q') qCount++;
      }
    }

    expect(pCount).toBeGreaterThan(0);
    expect(qCount).toBeGreaterThan(0);
    // 40% 強制枠がある分 3 倍ちょうどにはならないが、明確に q より高頻度になるはず。
    expect(pCount / qCount).toBeGreaterThan(1.5);
  });

  it('生成された全文字が charset と weakKeys の和集合に収まる（想定外の文字が混入しない）', () => {
    const weakKeys = ['9'];
    const charset = ['a', 'b'];
    const allowed = new Set([...charset, ...weakKeys]);
    const items = generateWeaknessItems(weakKeys, charset, {
      questionCount: 100,
      rng: createSeededRng(33),
    });
    for (const item of items) {
      for (const ch of charsOf(item.text)) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it('同一文字の 3 連続が発生しない（弱点特訓でも randomChars と同じ制約を守る）', () => {
    const weakKeys = ['p'];
    const charset = ['a', 's', 'd', 'p'];
    const items = generateWeaknessItems(weakKeys, charset, {
      questionCount: 100,
      rng: createSeededRng(44),
    });
    for (const item of items) {
      expect(hasNoTripleRun(item.text)).toBe(true);
    }
  });

  it('questionCount が 0 以下なら空配列を返す', () => {
    expect(generateWeaknessItems(['a'], ['a', 'b'], { questionCount: 0 })).toEqual([]);
  });
});

describe('shuffle', () => {
  it('元配列を変更せず、要素の集合を保ったまま並び替える', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input, createSeededRng(1));
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it('rng を固定すると決定的な並びになる', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const resultA = shuffle(input, createSeededRng(99));
    const resultB = shuffle(input, createSeededRng(99));
    expect(resultA).toEqual(resultB);
  });
});
