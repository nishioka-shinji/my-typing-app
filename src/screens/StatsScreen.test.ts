import { describe, expect, it } from 'vitest';
import {
  buildAccuracyPercentSeriesValues,
  buildHeatCellAriaLabel,
  buildKeyHeatmap,
  buildKpmSeriesValues,
  buildSessionTrend,
  classifyMissRate,
  formatKeystrokeCount,
  formatLevelBestAccuracy,
  formatLevelBestKpm,
  formatMissRatePercent,
  formatTotalTime,
} from './StatsScreen';
import { LEVEL_IDS, type KeyStat, type LevelId, type LevelProgress, type SessionRecord } from '../storage/schema';
import { ALL_KEYS } from '../data/keyboardUs';

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'test',
    levelId: 1,
    playedAt: Date.now(),
    durationMs: 10000,
    accuracy: 0.97,
    kpm: 82,
    correctCount: 20,
    missCount: 1,
    passed: true,
    keyStats: {},
    ...overrides,
  };
}

function makeProgress(overrides: Partial<LevelProgress> = {}): LevelProgress {
  return { unlocked: false, cleared: false, bestKpm: 0, bestAccuracy: 0, playCount: 0, ...overrides };
}

describe('buildSessionTrend', () => {
  it('sessions が空でも例外を出さず空配列を返す（初回起動直後・最重要）', () => {
    expect(buildSessionTrend([])).toEqual([]);
  });

  it('新しい順の sessions を古い順に反転する', () => {
    const newest = makeSession({ id: 'newest', kpm: 100 });
    const oldest = makeSession({ id: 'oldest', kpm: 50 });
    const trend = buildSessionTrend([newest, oldest]);
    expect(trend).toEqual([
      { kpm: 50, accuracy: oldest.accuracy },
      { kpm: 100, accuracy: newest.accuracy },
    ]);
  });

  it('21 件以上渡されても直近 20 件のみを対象にする', () => {
    const sessions = Array.from({ length: 25 }, (_, i) => makeSession({ id: `s${i}`, kpm: i }));
    expect(buildSessionTrend(sessions)).toHaveLength(20);
  });

  it('kpm/accuracy に NaN や Infinity が混ざるセッションを除外する（Chart への NaN 混入防止）', () => {
    const valid = makeSession({ id: 'valid', kpm: 80, accuracy: 0.9 });
    const nanKpm = makeSession({ id: 'nan-kpm', kpm: NaN, accuracy: 0.9 });
    const infAccuracy = makeSession({ id: 'inf-acc', kpm: 80, accuracy: Infinity });
    const trend = buildSessionTrend([nanKpm, infAccuracy, valid]);
    expect(trend).toEqual([{ kpm: 80, accuracy: 0.9 }]);
    for (const point of trend) {
      expect(Number.isFinite(point.kpm)).toBe(true);
      expect(Number.isFinite(point.accuracy)).toBe(true);
    }
  });
});

describe('buildKpmSeriesValues', () => {
  it('KPM を整数に丸める（小数のまま表示しない: t13 の再発防止）', () => {
    const trend = [{ kpm: 100.59518819683124, accuracy: 1 }];
    expect(buildKpmSeriesValues(trend)).toEqual([101]);
    expect(Number.isInteger(buildKpmSeriesValues(trend)[0])).toBe(true);
  });

  it('空配列を渡すと空配列を返す', () => {
    expect(buildKpmSeriesValues([])).toEqual([]);
  });
});

describe('buildAccuracyPercentSeriesValues', () => {
  it('0..1 の正確率をパーセント（小数第1位まで）に変換する', () => {
    const trend = [{ kpm: 80, accuracy: 0.9666 }];
    expect(buildAccuracyPercentSeriesValues(trend)).toEqual([96.7]);
  });

  it('空配列を渡すと空配列を返す', () => {
    expect(buildAccuracyPercentSeriesValues([])).toEqual([]);
  });
});

describe('formatKeystrokeCount', () => {
  it('3桁区切りにする', () => {
    expect(formatKeystrokeCount(12480)).toBe('12,480');
  });

  it('NaN/Infinity は 0 にフォールバックする', () => {
    expect(formatKeystrokeCount(NaN)).toBe('0');
    expect(formatKeystrokeCount(Infinity)).toBe('0');
  });
});

describe('formatTotalTime', () => {
  it('1時間未満は分のみ', () => {
    expect(formatTotalTime(59 * 60000)).toBe('59m');
  });

  it('1時間以上は時＋分', () => {
    expect(formatTotalTime(84 * 60000)).toBe('1h 24m');
  });

  it('NaN/Infinity は 0m にフォールバックする', () => {
    expect(formatTotalTime(NaN)).toBe('0m');
    expect(formatTotalTime(Infinity)).toBe('0m');
  });
});

describe('formatLevelBestAccuracy / formatLevelBestKpm', () => {
  it('未プレイ（playCount 0）のレベルは "—" にする（ゼロだらけ表示を避ける）', () => {
    const progress = makeProgress({ playCount: 0, bestAccuracy: 0, bestKpm: 0 });
    expect(formatLevelBestAccuracy(progress)).toBe('—');
    expect(formatLevelBestKpm(progress)).toBe('—');
  });

  it('プレイ済みレベルは丸めた値を表示する', () => {
    const progress = makeProgress({ playCount: 3, bestAccuracy: 0.9666, bestKpm: 82.7 });
    expect(formatLevelBestAccuracy(progress)).toBe('97%');
    expect(formatLevelBestKpm(progress)).toBe('83');
  });
});

describe('buildKeyHeatmap', () => {
  it('aggregateKeyStats が空でも例外を出さず、全ての非特殊キーが attempts 0 / missRate null になる', () => {
    const heatmap = buildKeyHeatmap({});
    const nonSpecialKeys = ALL_KEYS.filter((k) => !k.special);
    expect(heatmap.size).toBe(nonSpecialKeys.length);
    for (const key of nonSpecialKeys) {
      const cell = heatmap.get(key.id);
      expect(cell).toBeDefined();
      expect(cell?.attempts).toBe(0);
      expect(cell?.missRate).toBeNull();
    }
  });

  it('attempts が 0 のキーはゼロ除算せず missRate が null になる（misses だけ非0のデータが来ても安全）', () => {
    const stats: Record<string, KeyStat> = { a: { attempts: 0, misses: 0, totalLatencyMs: 0 } };
    const heatmap = buildKeyHeatmap(stats);
    const cell = heatmap.get('a');
    expect(cell?.missRate).toBeNull();
    expect(Number.isNaN(cell?.missRate)).toBe(false);
  });

  it('全キーが同じ値でもゼロ除算・NaN が起きない', () => {
    const stats: Record<string, KeyStat> = {};
    for (const ch of ['a', 's', 'd', 'f']) {
      stats[ch] = { attempts: 10, misses: 5, totalLatencyMs: 1000 };
    }
    const heatmap = buildKeyHeatmap(stats);
    for (const ch of ['a', 's', 'd', 'f']) {
      const cell = heatmap.get(ch);
      expect(cell?.missRate).toBe(0.5);
      expect(Number.isFinite(cell!.missRate as number)).toBe(true);
    }
  });

  it('大文字（shifted 面）と小文字（unshifted 面）を同じ物理キーへ合算する（例: H と h → h キー）', () => {
    const stats: Record<string, KeyStat> = {
      h: { attempts: 10, misses: 1, totalLatencyMs: 500 },
      H: { attempts: 4, misses: 2, totalLatencyMs: 500 },
    };
    const heatmap = buildKeyHeatmap(stats);
    const cell = heatmap.get('h');
    expect(cell?.attempts).toBe(14);
    expect(cell?.misses).toBe(3);
  });

  it('特殊キー（Backspace 等）は結果に含まれない', () => {
    const heatmap = buildKeyHeatmap({});
    expect(heatmap.has('backspace')).toBe(false);
    expect(heatmap.has('shiftLeft')).toBe(false);
  });

  it('US配列で解決できない文字（想定外データ）が混ざっても例外を出さない', () => {
    const stats: Record<string, KeyStat> = { 'あ': { attempts: 5, misses: 1, totalLatencyMs: 100 } };
    expect(() => buildKeyHeatmap(stats)).not.toThrow();
  });
});

describe('classifyMissRate', () => {
  it('null（未試行）は none', () => {
    expect(classifyMissRate(null)).toBe('none');
  });

  it('境界値を正しく分類する', () => {
    expect(classifyMissRate(0)).toBe('low');
    expect(classifyMissRate(0.049)).toBe('low');
    expect(classifyMissRate(0.05)).toBe('mid');
    expect(classifyMissRate(0.149)).toBe('mid');
    expect(classifyMissRate(0.15)).toBe('high');
    expect(classifyMissRate(0.299)).toBe('high');
    expect(classifyMissRate(0.3)).toBe('severe');
    expect(classifyMissRate(1)).toBe('severe');
  });
});

describe('formatMissRatePercent', () => {
  it('null は "—"', () => {
    expect(formatMissRatePercent(null)).toBe('—');
  });

  it('0 は "0%"', () => {
    expect(formatMissRatePercent(0)).toBe('0%');
  });

  it('0.5 は "50%"', () => {
    expect(formatMissRatePercent(0.5)).toBe('50%');
  });
});

describe('buildHeatCellAriaLabel', () => {
  it('attempts 0 のときは「記録なし」', () => {
    const label = buildHeatCellAriaLabel('a', { keyId: 'a', attempts: 0, misses: 0, missRate: null });
    expect(label).toContain('記録なし');
  });

  it('attempts > 0 のときはミス率と試行回数を含む', () => {
    const label = buildHeatCellAriaLabel('a', { keyId: 'a', attempts: 10, misses: 2, missRate: 0.2 });
    expect(label).toContain('20%');
    expect(label).toContain('10');
  });
});

// LEVEL_IDS を使い、全レベル分の LevelProgress マップを作れることを確認しておく
// （StatsScreen 本体が appData.progress を全 8 レベル分ループする前提と整合するか）。
describe('LEVEL_IDS との整合', () => {
  it('全レベル分の進捗を作れる', () => {
    const progressMap = LEVEL_IDS.reduce<Record<LevelId, LevelProgress>>((acc, id) => {
      acc[id] = makeProgress({ unlocked: id === 1 });
      return acc;
    }, {} as Record<LevelId, LevelProgress>);
    expect(Object.keys(progressMap)).toHaveLength(8);
  });
});
