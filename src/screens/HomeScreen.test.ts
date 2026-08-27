import { describe, expect, it } from 'vitest';
import {
  formatKeystrokeCount,
  formatTotalTime,
  getLevelDisplayState,
  getUnlockedCharsetUnion,
  getWeaknessPassCriteria,
  getWeaknessStatus,
} from './HomeScreen';
import { LEVEL_IDS, type LevelId, type LevelProgress, type SessionRecord } from '../storage/schema';
import { LEVELS } from '../data/levels';

function makeProgress(overrides: Partial<LevelProgress> = {}): LevelProgress {
  return { unlocked: false, cleared: false, bestKpm: 0, bestAccuracy: 0, playCount: 0, ...overrides };
}

function makeProgressMap(overrides: Partial<Record<LevelId, LevelProgress>> = {}): Record<LevelId, LevelProgress> {
  return LEVEL_IDS.reduce<Record<LevelId, LevelProgress>>((acc, id) => {
    acc[id] = overrides[id] ?? makeProgress({ unlocked: id === 1 });
    return acc;
  }, {} as Record<LevelId, LevelProgress>);
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'test',
    levelId: 1,
    playedAt: Date.now(),
    durationMs: 10000,
    accuracy: 1,
    kpm: 100,
    correctCount: 20,
    missCount: 0,
    passed: true,
    keyStats: {},
    ...overrides,
  };
}

describe('getLevelDisplayState', () => {
  it('cleared はロック設定に関わらず cleared', () => {
    const progress = makeProgress({ cleared: true, unlocked: true });
    expect(getLevelDisplayState(progress, true)).toBe('cleared');
    expect(getLevelDisplayState(progress, false)).toBe('cleared');
  });

  it('levelLockEnabled=true のとき、unlocked な未クリアは active', () => {
    const progress = makeProgress({ unlocked: true, cleared: false });
    expect(getLevelDisplayState(progress, true)).toBe('active');
  });

  it('levelLockEnabled=true のとき、unlocked=false は locked', () => {
    const progress = makeProgress({ unlocked: false, cleared: false });
    expect(getLevelDisplayState(progress, true)).toBe('locked');
  });

  it('levelLockEnabled=false のときは unlocked=false でも active（全レベル選択可能）', () => {
    const progress = makeProgress({ unlocked: false, cleared: false });
    expect(getLevelDisplayState(progress, false)).toBe('active');
  });
});

describe('formatTotalTime', () => {
  it('0ms は "0m"', () => {
    expect(formatTotalTime(0)).toBe('0m');
  });

  it('60分ちょうどは "1h 0m"', () => {
    expect(formatTotalTime(60 * 60 * 1000)).toBe('1h 0m');
  });

  it('1時間24分は "1h 24m"', () => {
    expect(formatTotalTime((60 + 24) * 60 * 1000)).toBe('1h 24m');
  });

  it('24時間超はそのまま積み上げる（例: 25h 5m）', () => {
    expect(formatTotalTime((25 * 60 + 5) * 60 * 1000)).toBe('25h 5m');
  });

  it('59分は "59m"（繰り上がらない境界）', () => {
    expect(formatTotalTime(59 * 60 * 1000)).toBe('59m');
  });
});

describe('formatKeystrokeCount', () => {
  it('3桁未満はそのまま', () => {
    expect(formatKeystrokeCount(0)).toBe('0');
    expect(formatKeystrokeCount(82)).toBe('82');
  });

  it('3桁区切りでカンマを入れる', () => {
    expect(formatKeystrokeCount(12480)).toBe('12,480');
    expect(formatKeystrokeCount(1234567)).toBe('1,234,567');
  });

  it('ちょうど1000は "1,000"', () => {
    expect(formatKeystrokeCount(1000)).toBe('1,000');
  });
});

describe('getWeaknessStatus', () => {
  it('セッション 0 件（初回起動）は no-data', () => {
    expect(getWeaknessStatus([])).toEqual({ kind: 'no-data' });
  });

  it('試行回数が全キー閾値未満のときは no-data', () => {
    const sessions = [
      makeSession({
        keyStats: { a: { attempts: 2, misses: 0, totalLatencyMs: 200 } },
      }),
    ];
    expect(getWeaknessStatus(sessions)).toEqual({ kind: 'no-data' });
  });

  it('ノーミス（全キー weakScore 0）のときは no-weakness であり、弱点キーを提示しない', () => {
    // 全キーが同じ missRate(0) / latency で、判定材料はあるが差が無いケース。
    const sessions = [
      makeSession({
        keyStats: {
          a: { attempts: 10, misses: 0, totalLatencyMs: 1000 },
          s: { attempts: 10, misses: 0, totalLatencyMs: 1000 },
        },
      }),
    ];
    expect(getWeaknessStatus(sessions)).toEqual({ kind: 'no-weakness' });
  });

  it('実際に弱点キーがあるときは ready で上位キーを返す', () => {
    const sessions = [
      makeSession({
        keyStats: {
          a: { attempts: 10, misses: 8, totalLatencyMs: 5000 },
          s: { attempts: 10, misses: 0, totalLatencyMs: 500 },
        },
      }),
    ];
    const status = getWeaknessStatus(sessions);
    expect(status.kind).toBe('ready');
    if (status.kind === 'ready') {
      expect(status.keys).toContain('a');
    }
  });
});

describe('getUnlockedCharsetUnion', () => {
  it('Lv1 のみ解放時は Lv1 の charset のみ', () => {
    const progress = makeProgressMap();
    const result = getUnlockedCharsetUnion(progress);
    const lv1 = LEVELS.find((l) => l.id === 1)!;
    expect(result.sort()).toEqual([...new Set(lv1.charset)].sort());
  });

  it('Lv1〜Lv3 解放時は3レベル分の和集合になり、未解放レベルの記号は含まない', () => {
    const progress = makeProgressMap({
      1: makeProgress({ unlocked: true, cleared: true }),
      2: makeProgress({ unlocked: true, cleared: true }),
      3: makeProgress({ unlocked: true, cleared: false }),
    });
    const result = new Set(getUnlockedCharsetUnion(progress));
    const lv3 = LEVELS.find((l) => l.id === 3)!;
    const lv6 = LEVELS.find((l) => l.id === 6)!;
    for (const ch of lv3.charset ?? []) {
      expect(result.has(ch)).toBe(true);
    }
    // Lv6 は未解放なので、Lv3 と重複しない記号（例: '~'）は含まれないこと。
    expect(result.has('~')).toBe(false);
    expect(lv6.charset).toContain('~');
  });
});

describe('getWeaknessPassCriteria', () => {
  it('挑戦中のレベル（unlocked かつ未クリア）の基準を使う', () => {
    const progress = makeProgressMap({
      1: makeProgress({ unlocked: true, cleared: true }),
      2: makeProgress({ unlocked: true, cleared: false }),
    });
    const lv2 = LEVELS.find((l) => l.id === 2)!;
    expect(getWeaknessPassCriteria(progress)).toEqual({
      passAccuracy: lv2.passAccuracy,
      passKpm: lv2.passKpm,
    });
  });

  it('全クリア済みなら最後にクリアしたレベルの基準にフォールバックする', () => {
    const progress = makeProgressMap(
      LEVEL_IDS.reduce<Partial<Record<LevelId, LevelProgress>>>((acc, id) => {
        acc[id] = makeProgress({ unlocked: true, cleared: true });
        return acc;
      }, {}),
    );
    const lv8 = LEVELS.find((l) => l.id === 8)!;
    expect(getWeaknessPassCriteria(progress)).toEqual({
      passAccuracy: lv8.passAccuracy,
      passKpm: lv8.passKpm,
    });
  });
});
