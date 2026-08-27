import { describe, expect, it } from 'vitest';
import { createInitialAppData, type AppData, type KeyStat, type SessionSummary } from '../storage/schema';
import { applySessionSummary, computeStreak, formatLocalDate } from './appDataUpdates';

// @types/node は導入していない（package.json は t01 凍結、依存追加はスコープ外）ため、
// DST テストでのみ使う `process.env.TZ` をこのファイル内だけの最小 ambient 宣言で補う。
declare const process: { env: Record<string, string | undefined> };

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    levelId: 1,
    durationMs: 60_000,
    accuracy: 1,
    kpm: 100,
    wpm: 20,
    correctCount: 100,
    missCount: 0,
    passed: true,
    keyStats: {},
    ...overrides,
  };
}

function keyStat(overrides: Partial<KeyStat> = {}): KeyStat {
  return { attempts: 0, misses: 0, totalLatencyMs: 0, ...overrides };
}

describe('formatLocalDate', () => {
  it('YYYY-MM-DD 形式（ゼロ埋め）でローカル日付を返す', () => {
    expect(formatLocalDate(new Date(2026, 2, 1))).toBe('2026-03-01'); // 月は 0-indexed
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('computeStreak', () => {
  it('未プレイ（空文字）からは 1 になる', () => {
    expect(computeStreak('', '2026-08-27', 0)).toBe(1);
  });

  it('同日なら据え置き', () => {
    expect(computeStreak('2026-08-27', '2026-08-27', 7)).toBe(7);
  });

  it('前日なら +1', () => {
    expect(computeStreak('2026-08-26', '2026-08-27', 7)).toBe(8);
  });

  it('2 日以上前なら 1 にリセット', () => {
    expect(computeStreak('2026-08-20', '2026-08-27', 7)).toBe(1);
  });

  it('月跨ぎ（2026-02-28 の翌日は 2026-03-01, 非うるう年）で +1 になる', () => {
    expect(computeStreak('2026-02-28', '2026-03-01', 3)).toBe(4);
  });

  it('年跨ぎ（2026-12-31 の翌日は 2027-01-01）で +1 になる', () => {
    expect(computeStreak('2026-12-31', '2027-01-01', 3)).toBe(4);
  });

  it('うるう年（2028-02-29 の翌日は 2028-03-01）で +1 になる', () => {
    expect(computeStreak('2028-02-29', '2028-03-01', 3)).toBe(4);
  });

  it('うるう年でない年に 2/29 相当が無いことを踏まえ、2026-02-28→03-02 は 2 日差でリセットされる', () => {
    expect(computeStreak('2026-02-28', '2026-03-02', 3)).toBe(1);
  });

  it('DST（サマータイム）切り替えをまたいでも暦日差 1 は +1 になる', () => {
    // 米国東部標準時は 2026-03-08 未明に DST 開始（1 日が 23 時間になる）。
    const originalTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(computeStreak('2026-03-07', '2026-03-08', 5)).toBe(6);
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe('applySessionSummary', () => {
  it('sessions の先頭に新しい記録を追加する（index 0 が最新）', () => {
    const data = createInitialAppData();
    const first = applySessionSummary(data, summary(), 1000, 'id-1');
    const second = applySessionSummary(first.data, summary(), 2000, 'id-2');

    expect(second.data.sessions.map((s) => s.id)).toEqual(['id-2', 'id-1']);
    expect(second.data.sessions[0].playedAt).toBe(2000);
  });

  it('sessions が 20 件を超えると先頭 20 件（最新順）に丸められる', () => {
    let data: AppData = createInitialAppData();
    for (let i = 0; i < 25; i += 1) {
      data = applySessionSummary(data, summary({ passed: false }), i, `id-${i}`).data;
    }
    expect(data.sessions).toHaveLength(20);
    expect(data.sessions[0].id).toBe('id-24');
    expect(data.sessions[19].id).toBe('id-5');
  });

  it('合格で cleared と次レベルの unlocked が立つ', () => {
    const data = createInitialAppData();
    const result = applySessionSummary(data, summary({ levelId: 1, passed: true }), 1000, 'id-1');

    expect(result.data.progress[1].cleared).toBe(true);
    expect(result.data.progress[2].unlocked).toBe(true);
    expect(result.unlockedLevelId).toBe(2);
  });

  it('不合格では cleared が立たず playCount と統計だけ増える', () => {
    const data = createInitialAppData();
    const result = applySessionSummary(
      data,
      summary({ levelId: 1, passed: false, kpm: 10, accuracy: 0.5 }),
      1000,
      'id-1',
    );

    expect(result.data.progress[1].cleared).toBe(false);
    expect(result.data.progress[2].unlocked).toBe(false);
    expect(result.data.progress[1].playCount).toBe(1);
    expect(result.data.progress[1].bestKpm).toBe(10);
    expect(result.data.progress[1].bestAccuracy).toBe(0.5);
    expect(result.unlockedLevelId).toBeNull();
  });

  it('既に解放済みのレベルが、その後の不合格でロックし直されない', () => {
    let data = createInitialAppData();
    data = applySessionSummary(data, summary({ levelId: 1, passed: true }), 1000, 'id-1').data;
    expect(data.progress[2].unlocked).toBe(true);

    // Lv1 を再度失敗しても Lv2 の unlocked は落ちない（Lv2 の再ロックは起きない）。
    const result = applySessionSummary(
      data,
      summary({ levelId: 1, passed: false, kpm: 1, accuracy: 0.1 }),
      2000,
      'id-2',
    );
    expect(result.data.progress[2].unlocked).toBe(true);
    expect(result.unlockedLevelId).toBeNull();
  });

  it('既に解放済みの次レベルへ再合格しても unlockedLevelId は null（新規解放ではない）', () => {
    let data = createInitialAppData();
    data = applySessionSummary(data, summary({ levelId: 1, passed: true }), 1000, 'id-1').data;
    const result = applySessionSummary(data, summary({ levelId: 1, passed: true }), 2000, 'id-2');
    expect(result.data.progress[2].unlocked).toBe(true);
    expect(result.unlockedLevelId).toBeNull();
  });

  it("弱点特訓（levelId === 'weakness'）は progress を一切変更しない（design.md §3.6 回帰テスト）", () => {
    const data = createInitialAppData();
    const result = applySessionSummary(
      data,
      summary({ levelId: 'weakness', passed: true, kpm: 999, accuracy: 1 }),
      1000,
      'id-1',
    );

    expect(result.data.progress).toEqual(data.progress);
    expect(result.unlockedLevelId).toBeNull();
    // セッション自体は記録される（統計・sessions は弱点特訓でも更新される）。
    expect(result.data.sessions).toHaveLength(1);
    expect(result.data.sessions[0].levelId).toBe('weakness');
  });

  it('bestKpm / bestAccuracy が悪い記録で上書きされない（最大値を維持）', () => {
    let data = createInitialAppData();
    data = applySessionSummary(data, summary({ levelId: 1, kpm: 80, accuracy: 0.9, passed: false }), 1000, 'id-1')
      .data;
    const result = applySessionSummary(
      data,
      summary({ levelId: 1, kpm: 50, accuracy: 0.5, passed: false }),
      2000,
      'id-2',
    );

    expect(result.data.progress[1].bestKpm).toBe(80);
    expect(result.data.progress[1].bestAccuracy).toBe(0.9);
    expect(result.data.progress[1].playCount).toBe(2);
  });

  it('aggregateKeyStats が加算される（全期間累積・無重み）', () => {
    let data = createInitialAppData();
    data = applySessionSummary(
      data,
      summary({ keyStats: { a: keyStat({ attempts: 5, misses: 1, totalLatencyMs: 100 }) } }),
      1000,
      'id-1',
    ).data;
    const result = applySessionSummary(
      data,
      summary({ keyStats: { a: keyStat({ attempts: 3, misses: 2, totalLatencyMs: 50 }) } }),
      2000,
      'id-2',
    );

    expect(result.data.aggregateKeyStats.a).toEqual({ attempts: 8, misses: 3, totalLatencyMs: 150 });
  });

  it('Lv8 合格時に次レベルが無くてもクラッシュせず unlockedLevelId は null', () => {
    const data = createInitialAppData();
    expect(() =>
      applySessionSummary(data, summary({ levelId: 8, passed: true }), 1000, 'id-1'),
    ).not.toThrow();
    const result = applySessionSummary(data, summary({ levelId: 8, passed: true }), 1000, 'id-1');
    expect(result.unlockedLevelId).toBeNull();
    expect(result.data.progress[8].cleared).toBe(true);
  });

  it('入力 AppData を破壊的変更しない（イミュータブル）', () => {
    const data = createInitialAppData();
    const snapshot = JSON.parse(JSON.stringify(data));
    applySessionSummary(data, summary({ levelId: 1, passed: true }), 1000, 'id-1');
    expect(data).toEqual(snapshot);
  });
});
