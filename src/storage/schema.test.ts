import { describe, expect, it } from 'vitest';
import {
  createInitialAppData,
  DEFAULT_SETTINGS,
  LEVEL_IDS,
  SCHEMA_VERSION,
} from './schema';

describe('createInitialAppData', () => {
  it('schemaVersion が 1 である', () => {
    expect(createInitialAppData().schemaVersion).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('Lv1 のみ unlocked で、他は unlocked が false', () => {
    const data = createInitialAppData();
    expect(data.progress[1].unlocked).toBe(true);
    for (const levelId of LEVEL_IDS) {
      if (levelId === 1) continue;
      expect(data.progress[levelId].unlocked).toBe(false);
    }
  });

  it('全レベルの進捗が cleared:false, best 系 0, playCount 0 で初期化される', () => {
    const data = createInitialAppData();
    for (const levelId of LEVEL_IDS) {
      const progress = data.progress[levelId];
      expect(progress.cleared).toBe(false);
      expect(progress.bestKpm).toBe(0);
      expect(progress.bestAccuracy).toBe(0);
      expect(progress.playCount).toBe(0);
    }
  });

  it('sessions が空配列、aggregateKeyStats が空オブジェクトである', () => {
    const data = createInitialAppData();
    expect(data.sessions).toEqual([]);
    expect(data.aggregateKeyStats).toEqual({});
  });

  it('totals が初期値で埋まっている', () => {
    const data = createInitialAppData();
    expect(data.totals).toEqual({
      totalKeystrokes: 0,
      totalTimeMs: 0,
      streakDays: 0,
      lastPlayedDate: '',
    });
  });

  it('settings が DEFAULT_SETTINGS と一致する (questionCount 20, guideMode auto)', () => {
    const data = createInitialAppData();
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(data.settings.questionCount).toBe(20);
    expect(data.settings.guideMode).toBe('auto');
  });

  it('呼び出しごとに別インスタンスを返す（参照を共有しない）', () => {
    const a = createInitialAppData();
    const b = createInitialAppData();

    expect(a).not.toBe(b);
    expect(a.progress).not.toBe(b.progress);
    expect(a.settings).not.toBe(b.settings);
    expect(a.sessions).not.toBe(b.sessions);
    expect(a.totals).not.toBe(b.totals);
    expect(a.aggregateKeyStats).not.toBe(b.aggregateKeyStats);

    a.settings.showKeyboard = false;
    a.progress[1].cleared = true;
    a.sessions.push({
      id: 'x',
      levelId: 1,
      playedAt: 0,
      durationMs: 0,
      accuracy: 0,
      kpm: 0,
      correctCount: 0,
      missCount: 0,
      passed: false,
      keyStats: {},
    });

    expect(b.settings.showKeyboard).toBe(true);
    expect(b.progress[1].cleared).toBe(false);
    expect(b.sessions).toEqual([]);
  });
});
