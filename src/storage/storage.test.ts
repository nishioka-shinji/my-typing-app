import { describe, expect, it } from 'vitest';
import { createInitialAppData, type AppData, type SessionRecord, BACKUP_STORAGE_KEY, STORAGE_KEY } from './schema';
import { loadAppData, saveAppData, resetAppData, type StorageLike } from './storage';

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

/** setItem が常に例外を投げるフェイク */
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

    expect(saveAppData(data, storage)).toBe(true);
    expect(loadAppData(storage)).toEqual(data);
  });

  it('sessions が 20 件を超える場合、保存時に新しい順で 20 件へ丸められる', () => {
    const { storage } = createMemoryStorage();
    const sessions = Array.from({ length: 25 }, (_, i) => fakeSession(`s${i}`));
    const data: AppData = { ...createInitialAppData(), sessions };

    expect(saveAppData(data, storage)).toBe(true);
    const loaded = loadAppData(storage);

    expect(loaded.sessions).toHaveLength(20);
    expect(loaded.sessions).toEqual(sessions.slice(0, 20));
  });
});

describe('saveAppData の容量超過フォールバック', () => {
  it('setItem が QuotaExceededError を投げる場合、sessions を削って再試行し、最終的に保存できる', () => {
    const { storage, raw } = createQuotaLimitedStorage(5);
    const sessions = Array.from({ length: 20 }, (_, i) => fakeSession(`s${i}`));
    const data: AppData = { ...createInitialAppData(), sessions };

    const result = saveAppData(data, storage);

    expect(result).toBe(true);
    const savedRaw = raw.get(STORAGE_KEY);
    expect(savedRaw).toBeDefined();
    const saved = JSON.parse(savedRaw!) as AppData;
    expect(saved.sessions).toHaveLength(5);
    expect(saved.sessions).toEqual(sessions.slice(0, 5));
  });

  it('setItem が常に throw する場合、例外を投げず false を返す', () => {
    const storage = createAlwaysThrowingStorage();
    const data = createInitialAppData();

    expect(() => saveAppData(data, storage)).not.toThrow();
    expect(saveAppData(data, storage)).toBe(false);
  });

  it('localStorage が存在しない環境でも例外を投げず false を返す', () => {
    expect(() => saveAppData(createInitialAppData())).not.toThrow();
    expect(saveAppData(createInitialAppData())).toBe(false);
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

  it('保存に失敗する環境でも例外を投げず初期値を返す', () => {
    const storage = createAlwaysThrowingStorage();
    expect(() => resetAppData(storage)).not.toThrow();
    expect(resetAppData(storage)).toEqual(createInitialAppData());
  });
});
