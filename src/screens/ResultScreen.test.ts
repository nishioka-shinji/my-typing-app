import { describe, expect, it } from 'vitest';
import type { SessionRecord, SessionResult } from '../storage/schema';
import {
  formatAccuracy,
  formatDuration,
  formatKpm,
  getDisplayMissKeys,
  getUnlockMessage,
  isAccuracyAchieved,
  isKpmAchieved,
  missBarWidthPercent,
  shouldShowNextLevelButton,
} from './ResultScreen';

/**
 * ResultScreen は jsdom 非導入のためレンダリングテストを書けない
 * （vite.config.ts は t01 所有で変更不可、design.md §11: 画面は手動確認方針）。
 * そのため表示ロジックを純粋関数として切り出し、ここで単体テストする。
 */

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    levelId: 3,
    playedAt: 1000,
    durationMs: 138_000,
    accuracy: 0.962,
    kpm: 104,
    correctCount: 200,
    missCount: 8,
    passed: true,
    keyStats: {},
    ...overrides,
  };
}

function makeResult(overrides: Partial<SessionResult> = {}, recordOverrides: Partial<SessionRecord> = {}): SessionResult {
  return {
    record: makeRecord(recordOverrides),
    passAccuracy: 0.96,
    passKpm: 100,
    wpm: 20.8,
    unlockedLevelId: 4,
    levelTitle: 'Lv3 下段',
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('0 秒を "0m 0s" にする', () => {
    expect(formatDuration(0)).toBe('0m 0s');
  });

  it('60 秒ちょうどを "1m 0s" にする', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  it('分秒混在 (2分18秒) を "2m 18s" にする', () => {
    expect(formatDuration(138_000)).toBe('2m 18s');
  });

  it('1 時間超を "1h Xm Ys" にする', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
  });

  it('負値や NaN を 0 として扱い、マイナス表示や NaN を出さない', () => {
    expect(formatDuration(-500)).toBe('0m 0s');
    expect(formatDuration(NaN)).toBe('0m 0s');
    expect(formatDuration(Infinity)).not.toMatch(/NaN|Infinity/);
  });
});

describe('formatAccuracy / formatKpm', () => {
  it('正確率を小数点 1 桁の % に整形する', () => {
    expect(formatAccuracy(0.962)).toBe('96.2%');
    expect(formatAccuracy(1)).toBe('100.0%');
    expect(formatAccuracy(0)).toBe('0.0%');
  });

  it('KPM を整数に丸める', () => {
    expect(formatKpm(103.6)).toBe('104');
    expect(formatKpm(0)).toBe('0');
  });

  it('NaN/Infinity を画面に出さない', () => {
    expect(formatAccuracy(NaN)).not.toMatch(/NaN/);
    expect(formatKpm(NaN)).not.toMatch(/NaN/);
  });
});

describe('isAccuracyAchieved / isKpmAchieved', () => {
  it('ちょうど基準値のとき達成扱いになる（境界値）', () => {
    expect(isAccuracyAchieved(0.96, 0.96)).toBe(true);
    expect(isKpmAchieved(100, 100)).toBe(true);
  });

  it('基準未達を正しく判定する', () => {
    expect(isAccuracyAchieved(0.95, 0.96)).toBe(false);
    expect(isKpmAchieved(99, 100)).toBe(false);
  });

  it('基準超過は達成扱い', () => {
    expect(isAccuracyAchieved(0.97, 0.96)).toBe(true);
    expect(isKpmAchieved(104, 100)).toBe(true);
  });
});

describe('shouldShowNextLevelButton（design.md §3.6 の回帰テスト。最重要）', () => {
  it('合格して次レベルが解放されたときは true', () => {
    const result = makeResult({ unlockedLevelId: 4 }, { passed: true, levelId: 3 });
    expect(shouldShowNextLevelButton(result, () => {})).toBe(true);
  });

  it('不合格（unlockedLevelId が null）のときは false', () => {
    const result = makeResult({ unlockedLevelId: null }, { passed: false, levelId: 3 });
    expect(shouldShowNextLevelButton(result, () => {})).toBe(false);
  });

  it('Lv8 合格（次のレベルが存在しないため unlockedLevelId が null）のときは false', () => {
    const result = makeResult({ unlockedLevelId: null }, { passed: true, levelId: 8 });
    expect(shouldShowNextLevelButton(result, () => {})).toBe(false);
  });

  it('弱点特訓のときは onNextLevel が渡されていても常に false', () => {
    const result = makeResult({ unlockedLevelId: null }, { passed: true, levelId: 'weakness' });
    expect(shouldShowNextLevelButton(result, () => {})).toBe(false);
  });

  it('onNextLevel が null（呼び出し側が渡さない）なら常に false', () => {
    const result = makeResult({ unlockedLevelId: 4 }, { passed: true, levelId: 3 });
    expect(shouldShowNextLevelButton(result, null)).toBe(false);
  });
});

describe('getUnlockMessage', () => {
  it('合格して解放されたレベルの番号を含むメッセージを返す', () => {
    const result = makeResult({ unlockedLevelId: 4 });
    expect(getUnlockMessage(result)).toBe('Lv4 が解放されました');
  });

  it('unlockedLevelId が null のときは null', () => {
    const result = makeResult({ unlockedLevelId: null });
    expect(getUnlockMessage(result)).toBeNull();
  });

  it('弱点特訓のときは unlockedLevelId があっても null（防御的ガード）', () => {
    const result = makeResult({ unlockedLevelId: 4 }, { levelId: 'weakness' });
    expect(getUnlockMessage(result)).toBeNull();
  });
});

describe('getDisplayMissKeys', () => {
  it('ミス回数の多い順に返す', () => {
    const keyStats = {
      p: { attempts: 10, misses: 6, totalLatencyMs: 0 },
      ';': { attempts: 8, misses: 4, totalLatencyMs: 0 },
      '/': { attempts: 5, misses: 1, totalLatencyMs: 0 },
    };
    const result = getDisplayMissKeys(keyStats);
    expect(result.map((e) => e.key)).toEqual(['p', ';', '/']);
    expect(result.map((e) => e.misses)).toEqual([6, 4, 1]);
  });

  it('ミス 0 件のキーは除外する（苦手キーとして誤表示しない）', () => {
    const keyStats = {
      a: { attempts: 10, misses: 0, totalLatencyMs: 0 },
      s: { attempts: 10, misses: 0, totalLatencyMs: 0 },
    };
    expect(getDisplayMissKeys(keyStats)).toEqual([]);
  });

  it('keyStats が空でも例外を出さず空配列を返す', () => {
    expect(getDisplayMissKeys({})).toEqual([]);
  });

  it('上位 n 件までに制限する', () => {
    const keyStats = {
      a: { attempts: 10, misses: 5, totalLatencyMs: 0 },
      b: { attempts: 10, misses: 4, totalLatencyMs: 0 },
      c: { attempts: 10, misses: 3, totalLatencyMs: 0 },
    };
    expect(getDisplayMissKeys(keyStats, 2)).toHaveLength(2);
  });
});

describe('missBarWidthPercent', () => {
  it('最大値に対する比率を 0〜100 で返す', () => {
    expect(missBarWidthPercent(6, 6)).toBe(100);
    expect(missBarWidthPercent(3, 6)).toBe(50);
    expect(missBarWidthPercent(1, 6)).toBeCloseTo((1 / 6) * 100);
  });

  it('maxMisses が 0 のときゼロ除算せず 0 を返す', () => {
    expect(missBarWidthPercent(0, 0)).toBe(0);
  });

  it('misses が 1 件のみ（maxMisses と同値）のとき 100 を返す', () => {
    expect(missBarWidthPercent(1, 1)).toBe(100);
  });

  it('NaN/Infinity を返さない', () => {
    expect(Number.isFinite(missBarWidthPercent(NaN, 6))).toBe(true);
    expect(Number.isFinite(missBarWidthPercent(3, NaN))).toBe(true);
  });
});
