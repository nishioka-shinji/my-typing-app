import { describe, expect, it } from 'vitest';
import { createInitialAppData, type AppData, type SessionRecord, BACKUP_STORAGE_KEY, STORAGE_KEY } from './schema';
import { loadAppData, saveAppData, resetAppData, MAX_SESSIONS, type StorageLike } from './storage';

/** インメモリの StorageLike フェイク。テストから中身を検証できるよう Map も返す。 */
function createMemoryStorage(initial: Record<string, string> = {}): {
  storage: StorageLike;
  raw: Map<string, string>;
} {
  const raw = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key) => (raw.has(key) ? raw.get(key)! : null),
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
  return { storage, raw };
}

/** getItem/setItem/removeItem のすべてが常に例外を投げるフェイク */
function createAlwaysThrowingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('access denied');
    },
    setItem: () => {
      throw new Error('access denied');
    },
    removeItem: () => {
      throw new Error('access denied');
    },
  };
}

/** sessions が一定件数を超えると setItem が QuotaExceededError を投げるフェイク */
function createQuotaLimitedStorage(maxSessions: number): {
  storage: StorageLike;
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => (raw.has(key) ? raw.get(key)! : null),
    setItem: (key, value) => {
      const parsed = JSON.parse(value) as AppData;
      if (parsed.sessions.length > maxSessions) {
        const err = new DOMException('quota exceeded', 'QuotaExceededError');
        throw err;
      }
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
  return { storage, raw };
}

function fakeSession(id: string): SessionRecord {
  return {
    id,
    levelId: 1,
    playedAt: 0,
    durationMs: 1000,
    accuracy: 1,
    kpm: 100,
    correctCount: 10,
    missCount: 0,
    passed: true,
    keyStats: {},
  };
}

describe('loadAppData', () => {
  it('未保存（getItem が null）なら初期値を返す', () => {
    const { storage } = createMemoryStorage();
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it('壊れた JSON 文字列でも例外を投げず初期値を返す', () => {
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: '{this is not json' });
    expect(() => loadAppData(storage)).not.toThrow();
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it.each([0, 2])('schemaVersion が %d（不一致）なら初期値を返し、旧データを backup キーへ退避する', (badVersion) => {
    const original = { ...createInitialAppData(), schemaVersion: badVersion };
    const rawString = JSON.stringify(original);
    const { storage, raw } = createMemoryStorage({ [STORAGE_KEY]: rawString });

    const result = loadAppData(storage);

    expect(result).toEqual(createInitialAppData());
    expect(raw.get(BACKUP_STORAGE_KEY)).toBe(rawString);
  });

  it.each([
    ['null', 'null'],
    ['配列', '[1,2,3]'],
    ['数値', '42'],
    ['文字列', '"hello"'],
  ])('ルートが %s など型不正なら例外を投げず初期値を返す', (_label, jsonText) => {
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: jsonText });
    expect(() => loadAppData(storage)).not.toThrow();
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it('schemaVersion は正しいが一部フィールドが欠損している場合、欠損キーを初期値で補う', () => {
    const partial = {
      schemaVersion: 1,
      // progress, sessions, aggregateKeyStats, totals, settings は全て欠損
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(partial) });

    const result = loadAppData(storage);

    expect(result).toEqual(createInitialAppData());
  });

  it('progress の一部レベルが欠損していても Lv1〜Lv8 すべてのキーが存在する状態に正規化する', () => {
    const partial = {
      schemaVersion: 1,
      progress: {
        1: { unlocked: true, cleared: true, bestKpm: 120, bestAccuracy: 0.99, playCount: 3 },
        // 2〜8 は欠損
      },
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(partial) });

    const result = loadAppData(storage);

    expect(result.progress[1]).toEqual({
      unlocked: true,
      cleared: true,
      bestKpm: 120,
      bestAccuracy: 0.99,
      playCount: 3,
    });
    for (const levelId of [2, 3, 4, 5, 6, 7, 8] as const) {
      expect(result.progress[levelId]).toEqual(createInitialAppData().progress[levelId]);
    }
  });

  it('localStorage が存在しない環境（getItem/setItem がそもそも呼べない）でも例外を投げず初期値を返す', () => {
    // storage 引数を省略すると既定実装が globalThis.localStorage を参照するが、
    // vitest の environment は 'node' 固定のため localStorage は存在しない。
    expect(() => loadAppData()).not.toThrow();
    expect(loadAppData()).toEqual(createInitialAppData());
  });

  it('storage へのアクセス自体が例外を投げる環境でも初期値を返す', () => {
    const storage = createAlwaysThrowingStorage();
    expect(() => loadAppData(storage)).not.toThrow();
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it('バックアップ保存自体が失敗しても（容量超過等）例外を投げず初期値を返す', () => {
    const original = { ...createInitialAppData(), schemaVersion: 99 };
    const storage: StorageLike = {
      getItem: (key) => (key === STORAGE_KEY ? JSON.stringify(original) : null),
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(() => loadAppData(storage)).not.toThrow();
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it('保存データの sessions が 20 件を超えている場合、読み込み時点で新しい順に 20 件へ丸める', () => {
    // saveAppData を経由せず、直接 21 件入った blob を置くことで load 側の丸めだけを検証する。
    const sessions = Array.from({ length: 21 }, (_, i) => fakeSession(`s${i}`));
    const original = { ...createInitialAppData(), sessions };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });

    const result = loadAppData(storage);

    expect(result.sessions).toHaveLength(MAX_SESSIONS);
    expect(result.sessions).toEqual(sessions.slice(0, MAX_SESSIONS));
  });

  it('sessions の要素が SessionRecord の形をしていない場合、その要素だけを除外する（丸ごと初期化はしない）', () => {
    const original = {
      schemaVersion: 1,
      sessions: [fakeSession('valid'), {}, { id: 'x' }, null, 42, { ...fakeSession('bad-keystats'), keyStats: 'not-an-object' }],
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });

    const result = loadAppData(storage);

    expect(result.sessions).toEqual([fakeSession('valid')]);
  });

  it('aggregateKeyStats の値が KeyStat の形をしていないエントリは除外する', () => {
    const original = {
      schemaVersion: 1,
      aggregateKeyStats: {
        a: { attempts: 5, misses: 1, totalLatencyMs: 100 },
        b: 'oops',
        c: null,
      },
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });

    const result = loadAppData(storage);

    expect(result.aggregateKeyStats).toEqual({ a: { attempts: 5, misses: 1, totalLatencyMs: 100 } });
  });

  it('settings に未知キーや範囲外の値が混ざっていても既定値へフォールバックし、未知キーは残さない', () => {
    const original = {
      schemaVersion: 1,
      settings: { questionCount: 9999, guideMode: 'bogus', evil: true, showKeyboard: 'yes' },
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });

    const result = loadAppData(storage);

    expect(result.settings).toEqual(createInitialAppData().settings);
    expect(result.settings).not.toHaveProperty('evil');
  });

  it('totals に型不正な値や未知キーが混ざっていても該当フィールドのみ初期値へフォールバックする', () => {
    const original = {
      schemaVersion: 1,
      totals: { streakDays: 'many', totalKeystrokes: 42, extra: 1 },
    };
    const { storage } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });

    const result = loadAppData(storage);

    expect(result.totals).toEqual({
      totalKeystrokes: 42,
      totalTimeMs: 0,
      streakDays: 0,
      lastPlayedDate: '',
    });
  });
});

describe('saveAppData / loadAppData のラウンドトリップ', () => {
  it('保存した値を読み込むと等価になる', () => {
    const { storage } = createMemoryStorage();
    const data: AppData = {
      ...createInitialAppData(),
      totals: {
        totalKeystrokes: 500,
        totalTimeMs: 60000,
        streakDays: 3,
        lastPlayedDate: '2026-08-27',
      },
      sessions: [fakeSession('a'), fakeSession('b')],
    };

    expect(saveAppData(data, storage)).toBe('ok');
    expect(loadAppData(storage)).toEqual(data);
  });

  it.each([
    [20, 20],
    [21, 20],
    [25, 20],
  ])('sessions %d 件を保存すると新しい順で %d 件へ丸められる', (inputCount, expectedCount) => {
    const { storage } = createMemoryStorage();
    const sessions = Array.from({ length: inputCount }, (_, i) => fakeSession(`s${i}`));
    const data: AppData = { ...createInitialAppData(), sessions };

    expect(saveAppData(data, storage)).toBe('ok');
    const loaded = loadAppData(storage);

    expect(loaded.sessions).toHaveLength(expectedCount);
    expect(loaded.sessions).toEqual(sessions.slice(0, expectedCount));
  });
});

describe('saveAppData の異常系', () => {
  it('data.sessions が配列でなくても例外を投げず、sessions を空配列として保存する', () => {
    const { storage } = createMemoryStorage();
    const broken = { ...createInitialAppData(), sessions: 'not-an-array' } as unknown as AppData;

    expect(() => saveAppData(broken, storage)).not.toThrow();
    const result = saveAppData(broken, storage);

    expect(result).toBe('ok');
    expect(loadAppData(storage).sessions).toEqual([]);
  });

  it('setItem が QuotaExceededError を投げる場合、sessions を削って再試行し degraded で保存できる', () => {
    const { storage, raw } = createQuotaLimitedStorage(5);
    const sessions = Array.from({ length: 20 }, (_, i) => fakeSession(`s${i}`));
    const data: AppData = { ...createInitialAppData(), sessions };

    const result = saveAppData(data, storage);

    expect(result).toBe('degraded');
    const savedRaw = raw.get(STORAGE_KEY);
    expect(savedRaw).toBeDefined();
    const saved = JSON.parse(savedRaw!) as AppData;
    expect(saved.sessions).toHaveLength(5);
    expect(saved.sessions).toEqual(sessions.slice(0, 5));
  });

  it('setItem が常に throw する場合、例外を投げず failed を返す', () => {
    const storage = createAlwaysThrowingStorage();
    const data = createInitialAppData();

    expect(() => saveAppData(data, storage)).not.toThrow();
    expect(saveAppData(data, storage)).toBe('failed');
  });

  it('localStorage が存在しない環境でも例外を投げず failed を返す', () => {
    expect(() => saveAppData(createInitialAppData())).not.toThrow();
    expect(saveAppData(createInitialAppData())).toBe('failed');
  });
});

describe('resetAppData', () => {
  it('保存されている内容を初期値で上書きし、初期値を返す', () => {
    const { storage } = createMemoryStorage();
    saveAppData({ ...createInitialAppData(), sessions: [fakeSession('a')] }, storage);

    const result = resetAppData(storage);

    expect(result).toEqual(createInitialAppData());
    expect(loadAppData(storage)).toEqual(createInitialAppData());
  });

  it('backup キーに退避された旧データも削除する', () => {
    const badVersionData = { ...createInitialAppData(), schemaVersion: 99 };
    const { storage, raw } = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(badVersionData) });
    // schemaVersion 不一致の読み込みで backup キーへ退避させておく
    loadAppData(storage);
    expect(raw.has(BACKUP_STORAGE_KEY)).toBe(true);

    resetAppData(storage);

    expect(raw.has(BACKUP_STORAGE_KEY)).toBe(false);
  });

  it('removeItem が例外を投げる環境でも例外を外に投げず初期値を返す', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('cannot remove');
      },
    };

    expect(() => resetAppData(storage)).not.toThrow();
    expect(resetAppData(storage)).toEqual(createInitialAppData());
  });

  it('保存に失敗する環境でも例外を投げず初期値を返す', () => {
    const storage = createAlwaysThrowingStorage();
    expect(() => resetAppData(storage)).not.toThrow();
    expect(resetAppData(storage)).toEqual(createInitialAppData());
  });
});
