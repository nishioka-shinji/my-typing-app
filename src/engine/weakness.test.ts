import { describe, expect, it } from 'vitest';
// ソースを文字列として読み込み、静的な設計確認（import 一覧・識別子の不在）に使う。
// node:fs は使わない（@types/node 非依存の構成のため）。Vite の `?raw` インポートで代替する。
import weaknessSource from './weakness.ts?raw';
import {
  aggregateWeightedKeyStats,
  computeWeakScores,
  getTopWeakKeys,
  getWeaknessTrainingPlan,
  WEAKNESS_KEY_WEIGHT_MULTIPLIER,
  WEAKNESS_TRAINING_QUESTION_COUNT,
} from './weakness';
import type { KeyStat, SessionRecord } from '../storage/schema';

/** テスト用の SessionRecord を組み立てるヘルパー。keyStats 以外はダミー値で埋める。 */
function makeSession(
  playedAt: number,
  keyStats: Record<string, KeyStat>,
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    id: `session-${playedAt}`,
    levelId: 1,
    playedAt,
    durationMs: 60000,
    accuracy: 0.9,
    kpm: 100,
    correctCount: 90,
    missCount: 10,
    passed: true,
    keyStats,
    ...overrides,
  };
}

function stat(attempts: number, misses: number, totalLatencyMs: number): KeyStat {
  return { attempts, misses, totalLatencyMs };
}

describe('aggregateWeightedKeyStats', () => {
  it('sessions が空なら空オブジェクトを返す', () => {
    expect(aggregateWeightedKeyStats([])).toEqual({});
  });

  it('直近 5 件は重み 1.0 で合算される', () => {
    const sessions = [
      makeSession(5, { a: stat(10, 2, 200) }),
      makeSession(4, { a: stat(10, 2, 200) }),
      makeSession(3, { a: stat(10, 2, 200) }),
      makeSession(2, { a: stat(10, 2, 200) }),
      makeSession(1, { a: stat(10, 2, 200) }),
    ];
    const result = aggregateWeightedKeyStats(sessions);
    // 5 件 * weight 1.0 * attempts 10 = 50
    expect(result.a.attempts).toBeCloseTo(50, 10);
    expect(result.a.misses).toBeCloseTo(10, 10);
    expect(result.a.totalLatencyMs).toBeCloseTo(1000, 10);
  });

  it('6 件目以降は重み 0.5 が掛かる（playedAt の新しい順で判定、入力の並び順には依存しない）', () => {
    // わざと playedAt の昇順（古い→新しい）でシャッフルして渡し、内部でのソートを確認する。
    const sessions = [
      makeSession(1, { a: stat(10, 0, 0) }), // 最古 = 6 番目 → weight 0.5
      makeSession(6, { a: stat(10, 0, 0) }), // 最新 = 1 番目 → weight 1.0
      makeSession(2, { a: stat(10, 0, 0) }),
      makeSession(5, { a: stat(10, 0, 0) }),
      makeSession(3, { a: stat(10, 0, 0) }),
      makeSession(4, { a: stat(10, 0, 0) }),
    ];
    const result = aggregateWeightedKeyStats(sessions);
    // 新しい順: 6,5,4,3,2(weight1.0 x5) ,1(weight0.5)
    // attempts = 5*1.0*10 + 1*0.5*10 = 55
    expect(result.a.attempts).toBeCloseTo(55, 10);
  });

  it('古いセッションのミスが薄まる（同じミス数でも直近か古いかで寄与が変わる）', () => {
    // ケース A: 大量ミスのセッションが直近5件以内（weight 1.0）
    const recentHeavyMiss = aggregateWeightedKeyStats([
      makeSession(6, { a: stat(10, 10, 0) }), // weight 1.0, misses 10
      makeSession(5, { a: stat(10, 0, 0) }),
      makeSession(4, { a: stat(10, 0, 0) }),
      makeSession(3, { a: stat(10, 0, 0) }),
      makeSession(2, { a: stat(10, 0, 0) }),
      makeSession(1, { a: stat(10, 0, 0) }), // weight 0.5
    ]);
    // ケース B: 同じ大量ミスのセッションが 6 番目以降（weight 0.5）に押し出される
    const oldHeavyMiss = aggregateWeightedKeyStats([
      makeSession(7, { a: stat(10, 0, 0) }),
      makeSession(6, { a: stat(10, 0, 0) }),
      makeSession(5, { a: stat(10, 0, 0) }),
      makeSession(4, { a: stat(10, 0, 0) }),
      makeSession(3, { a: stat(10, 0, 0) }),
      makeSession(1, { a: stat(10, 10, 0) }), // 最古 = 6 番目 → weight 0.5, misses 10
    ]);

    expect(recentHeavyMiss.a.misses).toBeCloseTo(10, 10); // 1.0 * 10
    expect(oldHeavyMiss.a.misses).toBeCloseTo(5, 10); // 0.5 * 10
    expect(oldHeavyMiss.a.misses).toBeLessThan(recentHeavyMiss.a.misses);
  });
});

describe('computeWeakScores - 試行回数フィルタ', () => {
  it('重み付き attempts が 5 未満のキーは除外される（4 回）', () => {
    const sessions = [makeSession(1, { a: stat(4, 4, 400) })];
    const scores = computeWeakScores(sessions);
    expect(scores.find((s) => s.key === 'a')).toBeUndefined();
  });

  it('重み付き attempts がちょうど 5 のキーは含まれる', () => {
    const sessions = [makeSession(1, { a: stat(5, 1, 100) })];
    const scores = computeWeakScores(sessions);
    expect(scores.find((s) => s.key === 'a')).toBeDefined();
  });

  it('sessions が空でも例外を出さず空配列を返す', () => {
    expect(computeWeakScores([])).toEqual([]);
  });

  it('全キーが 5 回未満で除外され尽くすと空配列を返す', () => {
    const sessions = [makeSession(1, { a: stat(1, 0, 0), b: stat(2, 0, 0) })];
    expect(computeWeakScores(sessions)).toEqual([]);
  });
});

describe('computeWeakScores - 正規化のゼロ除算ガード', () => {
  it('有効キーが 1 個のとき NaN/Infinity にならない（weakScore は有限値 0）', () => {
    const sessions = [makeSession(1, { a: stat(10, 3, 500) })];
    const scores = computeWeakScores(sessions);
    expect(scores).toHaveLength(1);
    expect(Number.isFinite(scores[0].weakScore)).toBe(true);
    expect(Number.isNaN(scores[0].weakScore)).toBe(false);
    // min === max（比較対象が自分自身のみ）なので正規化結果は 0
    expect(scores[0].weakScore).toBe(0);
  });

  it('全キーの missRate/latency が同一のとき min-max 正規化がゼロ除算しない（NaN を返さない）', () => {
    const sessions = [makeSession(1, { a: stat(10, 5, 500), b: stat(10, 5, 500), c: stat(10, 5, 500) })];
    const scores = computeWeakScores(sessions);
    expect(scores).toHaveLength(3);
    for (const s of scores) {
      expect(Number.isFinite(s.weakScore)).toBe(true);
      expect(Number.isNaN(s.weakScore)).toBe(false);
      expect(s.weakScore).toBe(0);
    }
  });

  it('attempts が 0 のキーが混在しても 0 除算しない（そもそも 5 未満で除外される）', () => {
    const sessions = [makeSession(1, { a: stat(10, 2, 200), z: stat(0, 0, 0) })];
    const scores = computeWeakScores(sessions);
    expect(scores.find((s) => s.key === 'z')).toBeUndefined();
    expect(scores.every((s) => Number.isFinite(s.weakScore))).toBe(true);
  });
});

describe('computeWeakScores - weakScore の重み配分 (0.65 / 0.35)', () => {
  it('missRate だけが異なり latency が同一なら、weakScore の差は missRate 側の正規化差 * 0.65 に一致する', () => {
    // a: missRate 最大, b: missRate 最小, latency は 2 キーとも同一
    const sessions = [
      makeSession(1, {
        a: stat(10, 10, 1000), // missRate 1.0
        b: stat(10, 0, 1000), // missRate 0.0
      }),
    ];
    const scores = computeWeakScores(sessions);
    const a = scores.find((s) => s.key === 'a')!;
    const b = scores.find((s) => s.key === 'b')!;
    // latency 側の正規化差は 0（同一値）なので、差は missRate 側の正規化差(1.0) * 0.65 のみ
    expect(a.weakScore - b.weakScore).toBeCloseTo(0.65, 10);
  });

  it('latency だけが異なり missRate が同一なら、weakScore の差は latency 側の正規化差 * 0.35 に一致する', () => {
    const sessions = [
      makeSession(1, {
        a: stat(10, 5, 2000), // latency 200ms
        b: stat(10, 5, 0), // latency 0ms
      }),
    ];
    const scores = computeWeakScores(sessions);
    const a = scores.find((s) => s.key === 'a')!;
    const b = scores.find((s) => s.key === 'b')!;
    expect(a.weakScore - b.weakScore).toBeCloseTo(0.35, 10);
  });
});

describe('getTopWeakKeys', () => {
  it('sessions が空なら空配列を返す', () => {
    expect(getTopWeakKeys([])).toEqual([]);
  });

  it('有効キーが n 個未満ならある分だけ返す', () => {
    const sessions = [makeSession(1, { a: stat(10, 5, 500) })];
    expect(getTopWeakKeys(sessions, 5)).toEqual(['a']);
  });

  it('weakScore 降順で上位 n 件を返す', () => {
    const sessions = [
      makeSession(1, {
        a: stat(10, 1, 100), // missRate 0.1 (最も弱点度が低い)
        b: stat(10, 5, 500), // missRate 0.5
        c: stat(10, 10, 1000), // missRate 1.0 (最も弱点度が高い)
        d: stat(10, 7, 700),
        e: stat(10, 3, 300),
        f: stat(10, 9, 900),
      }),
    ];
    const top3 = getTopWeakKeys(sessions, 3);
    expect(top3).toEqual(['c', 'f', 'd']);
  });

  it('同点はキー昇順でタイブレークする（決定的な順序）', () => {
    // 全キー同一 missRate/latency → weakScore はすべて 0 で同点
    const sessions = [
      makeSession(1, {
        z: stat(10, 5, 500),
        a: stat(10, 5, 500),
        m: stat(10, 5, 500),
      }),
    ];
    expect(getTopWeakKeys(sessions, 3)).toEqual(['a', 'm', 'z']);
  });

  it('既定値 n=5 で上位 5 キーを返す', () => {
    const keyStats: Record<string, KeyStat> = {};
    for (let i = 0; i < 8; i += 1) {
      keyStats[`k${i}`] = stat(10, i, i * 10);
    }
    const sessions = [makeSession(1, keyStats)];
    expect(getTopWeakKeys(sessions)).toHaveLength(5);
    // ミス数が多い k7..k3 が上位に来る
    expect(getTopWeakKeys(sessions)).toEqual(['k7', 'k6', 'k5', 'k4', 'k3']);
  });
});

describe('getWeaknessTrainingPlan', () => {
  it('弱点キー・問題数・出現重み倍率をまとめて返す', () => {
    const sessions = [makeSession(1, { a: stat(10, 8, 800), b: stat(10, 1, 100) })];
    const plan = getWeaknessTrainingPlan(sessions);
    expect(plan.keys).toEqual(['a', 'b']);
    expect(plan.questionCount).toBe(WEAKNESS_TRAINING_QUESTION_COUNT);
    expect(plan.questionCount).toBe(20);
    expect(plan.weightMultiplier).toBe(WEAKNESS_KEY_WEIGHT_MULTIPLIER);
    expect(plan.weightMultiplier).toBe(3);
  });

  it('sessions が空（初回起動）でもクラッシュせず、空の弱点キーリストを返す', () => {
    const plan = getWeaknessTrainingPlan([]);
    expect(plan.keys).toEqual([]);
    expect(plan.questionCount).toBe(20);
    expect(plan.weightMultiplier).toBe(3);
  });
});

describe('設計上の確認: aggregateKeyStats を弱点分析に使っていない', () => {
  it('weakness.ts が ../storage/schema から aggregateKeyStats をインポートしていない（DECISIONS §7）', () => {
    // ヒートマップ専用（t17）である AppData.aggregateKeyStats を弱点分析に混用しないことの
    // 静的な保証。コメントでの言及（役割分離の説明）は許容し、あくまで
    // 「schema からの import 一覧」に含まれていないかだけを検査する。
    const importLines = weaknessSource
      .split('\n')
      .filter((line: string) => line.includes('from') && line.includes('../storage/schema'));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/aggregateKeyStats/);
    }
  });

  it('weakness.ts の実装コード（コメントを除く）が aggregateKeyStats という識別子を使っていない', () => {
    // ブロックコメント (/** ... */) を除去してから検査することで、
    // 「役割分離の説明」コメント中の言及は許容しつつ、実装コードでの使用のみを禁止する。
    const withoutBlockComments = weaknessSource.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutBlockComments).not.toMatch(/aggregateKeyStats/);
  });
});
