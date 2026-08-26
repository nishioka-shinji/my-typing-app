import { describe, expect, it } from 'vitest';
import {
  calcAccuracy,
  calcDurationMs,
  calcKpm,
  calcWpm,
  judgePassed,
  summarizeSession,
  topMissKeys,
} from './metrics';
import type { TypingState } from '../storage/schema';

describe('calcAccuracy', () => {
  it('総打鍵が 0 のときは 0 を返す（NaN にならない）', () => {
    expect(calcAccuracy(0, 0)).toBe(0);
  });

  it('正打鍵とミスの割合を返す', () => {
    expect(calcAccuracy(96, 4)).toBeCloseTo(0.96, 10);
  });

  it('ミスのみ（correctCount === 0, missCount > 0）は 0 になる', () => {
    expect(calcAccuracy(0, 5)).toBe(0);
  });

  it('ミスが無ければ 1 になる', () => {
    expect(calcAccuracy(10, 0)).toBe(1);
  });
});

describe('calcKpm', () => {
  it('durationMs が 0 のときは Infinity ではなく 0 を返す', () => {
    expect(calcKpm(10, 0)).toBe(0);
  });

  it('durationMs が負のときも 0 を返す', () => {
    expect(calcKpm(10, -100)).toBe(0);
  });

  it('correctCount が 0 のときは 0 になる', () => {
    expect(calcKpm(0, 60000)).toBe(0);
  });

  it('1 分間に 60 打鍵で KPM 60', () => {
    expect(calcKpm(60, 60000)).toBeCloseTo(60, 10);
  });

  it('NaN / Infinity を返さない', () => {
    expect(Number.isFinite(calcKpm(0, 0))).toBe(true);
    expect(Number.isFinite(calcKpm(100, 0))).toBe(true);
    expect(Number.isNaN(calcKpm(0, 0))).toBe(false);
  });
});

describe('calcWpm', () => {
  it('durationMs が 0 のときは 0 を返す', () => {
    expect(calcWpm(10, 0)).toBe(0);
  });

  it('WPM は KPM のちょうど 1/5 になる', () => {
    const kpm = calcKpm(100, 60000);
    const wpm = calcWpm(100, 60000);
    expect(wpm).toBeCloseTo(kpm / 5, 10);
  });

  it('durationMs が負のときも 0 を返す', () => {
    expect(calcWpm(10, -1)).toBe(0);
  });
});

describe('calcDurationMs', () => {
  it('startedAt が null（1 打鍵もしていない）なら 0 を返す', () => {
    expect(calcDurationMs(null, 12345)).toBe(0);
  });

  it('lastInputAt が null なら 0 を返す', () => {
    expect(calcDurationMs(1000, null)).toBe(0);
  });

  it('両方 null でも 0 を返す', () => {
    expect(calcDurationMs(null, null)).toBe(0);
  });

  it('差が負（不正な入力）のときは 0 を返す', () => {
    expect(calcDurationMs(5000, 1000)).toBe(0);
  });

  it('正常な差分を返す', () => {
    expect(calcDurationMs(1000, 5000)).toBe(4000);
  });

  it('同一ミリ秒（差が 0）のときも 0 を返し、KPM 側で Infinity を生まない', () => {
    expect(calcDurationMs(1000, 1000)).toBe(0);
    expect(calcKpm(10, calcDurationMs(1000, 1000))).toBe(0);
  });
});

describe('judgePassed', () => {
  it('正確率・KPM がともに基準を上回れば合格', () => {
    expect(judgePassed(0.98, 120, 0.96, 100)).toBe(true);
  });

  it('正確率がちょうど基準値のとき合格になる（境界値）', () => {
    expect(judgePassed(0.96, 120, 0.96, 100)).toBe(true);
  });

  it('KPM がちょうど基準値のとき合格になる（境界値）', () => {
    expect(judgePassed(0.98, 100, 0.96, 100)).toBe(true);
  });

  it('浮動小数点誤差で基準値よりわずかに小さくなっても合格になる', () => {
    // 96/100 は理論上 0.96 だが、除算経由の値は丸め誤差を含み得る。
    const accuracy = calcAccuracy(96, 4);
    expect(judgePassed(accuracy, 100, 0.96, 100)).toBe(true);
  });

  it('正確率は基準を満たすが KPM が不足していれば不合格（AND 条件）', () => {
    expect(judgePassed(0.99, 50, 0.96, 100)).toBe(false);
  });

  it('KPM は基準を満たすが正確率が不足していれば不合格（AND 条件）', () => {
    expect(judgePassed(0.5, 150, 0.96, 100)).toBe(false);
  });

  it('両方基準未達なら不合格', () => {
    expect(judgePassed(0.5, 50, 0.96, 100)).toBe(false);
  });
});

describe('summarizeSession', () => {
  function buildState(overrides: Partial<TypingState> = {}): TypingState {
    return {
      levelId: 1,
      items: [{ text: 'abc' }],
      currentIndex: 1,
      cursor: 3,
      startedAt: 1000,
      lastKeyAt: 4000,
      lastInputAt: 4000,
      correctCount: 3,
      missCount: 0,
      consecutiveMiss: 0,
      keyStats: { a: { attempts: 1, misses: 0, totalLatencyMs: 0 } },
      ...overrides,
    };
  }

  it('TypingState から SessionSummary を組み立てる', () => {
    const state = buildState();
    const summary = summarizeSession(state, { passAccuracy: 0.9, passKpm: 10 });
    expect(summary.levelId).toBe(1);
    expect(summary.durationMs).toBe(3000);
    expect(summary.accuracy).toBe(1);
    expect(summary.correctCount).toBe(3);
    expect(summary.missCount).toBe(0);
    expect(summary.passed).toBe(true);
  });

  it('startedAt が null のセッションは KPM/WPM 0 で合否判定される', () => {
    const state = buildState({ startedAt: null, correctCount: 0, lastInputAt: null });
    const summary = summarizeSession(state, { passAccuracy: 0.9, passKpm: 10 });
    expect(summary.durationMs).toBe(0);
    expect(summary.kpm).toBe(0);
    expect(summary.wpm).toBe(0);
    expect(summary.passed).toBe(false);
  });

  it('keyStats はディープコピーされ、元の state を変更しても影響しない', () => {
    const state = buildState();
    const summary = summarizeSession(state, { passAccuracy: 0.9, passKpm: 10 });
    state.keyStats.a.misses = 999;
    expect(summary.keyStats.a.misses).toBe(0);
  });
});

describe('topMissKeys', () => {
  it('ミス回数の多い順に上位 n 件を返す', () => {
    const keyStats = {
      a: { attempts: 10, misses: 5, totalLatencyMs: 0 },
      b: { attempts: 10, misses: 8, totalLatencyMs: 0 },
      c: { attempts: 10, misses: 1, totalLatencyMs: 0 },
    };
    expect(topMissKeys(keyStats, 2)).toEqual([
      { key: 'b', misses: 8 },
      { key: 'a', misses: 5 },
    ]);
  });

  it('同数のときはキーの昇順で安定する', () => {
    const keyStats = {
      z: { attempts: 10, misses: 3, totalLatencyMs: 0 },
      a: { attempts: 10, misses: 3, totalLatencyMs: 0 },
      m: { attempts: 10, misses: 3, totalLatencyMs: 0 },
    };
    expect(topMissKeys(keyStats, 3).map((e) => e.key)).toEqual(['a', 'm', 'z']);
  });

  it('空の keyStats では空配列を返す', () => {
    expect(topMissKeys({}, 5)).toEqual([]);
  });
});
