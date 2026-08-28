import { describe, expect, it } from 'vitest';
import type { DrillItem, TypingState } from '../storage/schema';
import {
  createInitialTypingState,
  isQuestionComplete,
  isSessionComplete,
  typingReducer,
} from './typingReducer';

function items(...texts: string[]): DrillItem[] {
  return texts.map((text) => ({ text }));
}

function press(key: string, at: number): { type: 'KEY_PRESS'; key: string; at: number } {
  return { type: 'KEY_PRESS', key, at };
}

/** 入力 state を渡す前に凍結し、reducer が破壊的変更をしていないことを検証するための補助 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('createInitialTypingState', () => {
  it('仕様どおりの初期値を返す', () => {
    const state = createInitialTypingState(1, items('ab'));
    expect(state).toEqual({
      levelId: 1,
      items: items('ab'),
      currentIndex: 0,
      cursor: 0,
      startedAt: null,
      lastKeyAt: null,
      lastInputAt: null,
      correctCount: 0,
      missCount: 0,
      consecutiveMiss: 0,
      keyStats: {},
    });
  });
});

describe('typingReducer: KEY_PRESS 正打鍵', () => {
  it('cursor と correctCount が進む', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(deepFreeze(state), press('a', 100));

    expect(next.cursor).toBe(1);
    expect(next.correctCount).toBe(1);
    expect(next.missCount).toBe(0);
  });

  it('大文字小文字を区別する（a を期待して A を打ったらミス）', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(state, press('A', 100));

    expect(next.cursor).toBe(0);
    expect(next.missCount).toBe(1);
    expect(next.correctCount).toBe(0);
  });

  it('正打鍵で consecutiveMiss が 0 に戻る', () => {
    let state = createInitialTypingState(1, items('ab'));
    state = typingReducer(state, press('x', 100)); // ミス
    state = typingReducer(state, press('x', 200)); // ミス
    expect(state.consecutiveMiss).toBe(2);

    state = typingReducer(state, press('a', 300)); // 正解
    expect(state.consecutiveMiss).toBe(0);
    expect(state.cursor).toBe(1);
  });
});

describe('typingReducer: KEY_PRESS 誤打鍵', () => {
  it('cursor が動かず missCount が増える（進めない方式）', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(deepFreeze(state), press('z', 100));

    expect(next.cursor).toBe(0);
    expect(next.missCount).toBe(1);
    expect(next.correctCount).toBe(0);
  });

  it('ミス時に keyStats[期待文字].misses が増える（押されたキー側ではない）', () => {
    const state = createInitialTypingState(1, items('ab'));
    // 'a' を期待して 'z' を押す → 記録されるのは 'a' 側
    const next = typingReducer(state, press('z', 100));

    expect(next.keyStats.a).toEqual({ attempts: 1, misses: 1, totalLatencyMs: 0 });
    expect(next.keyStats.z).toBeUndefined();
  });

  it('同一文字で 3 連続ミスすると consecutiveMiss === 3 になる', () => {
    let state = createInitialTypingState(1, items('ab'));
    state = typingReducer(state, press('z', 100));
    state = typingReducer(state, press('z', 200));
    state = typingReducer(state, press('z', 300));

    expect(state.consecutiveMiss).toBe(3);
    expect(state.missCount).toBe(3);
    expect(state.cursor).toBe(0);
  });
});

describe('typingReducer: 修飾キー・Backspace の無視', () => {
  it.each(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Backspace', 'Enter'])(
    '%s は完全に無視される（state が変化しない）',
    (key) => {
      const state = createInitialTypingState(1, items('ab'));
      const next = typingReducer(deepFreeze(state), press(key, 100));

      expect(next).toBe(state);
      expect(next.missCount).toBe(0);
      expect(next.cursor).toBe(0);
    },
  );

  it('Backspace は state を変化させない（消すものがないため無効）', () => {
    let state = createInitialTypingState(1, items('ab'));
    state = typingReducer(state, press('a', 100));
    const beforeBackspace = state;

    const next = typingReducer(deepFreeze(state), press('Backspace', 200));

    expect(next).toBe(beforeBackspace);
  });
});

describe('typingReducer: 問題クリアとセッション完了', () => {
  it('問題末尾で isQuestionComplete が true になる', () => {
    let state = createInitialTypingState(1, items('ab', 'c'));
    state = typingReducer(state, press('a', 100));
    expect(isQuestionComplete(state)).toBe(false);

    state = typingReducer(state, press('b', 200));
    expect(isQuestionComplete(state)).toBe(true);
    expect(isSessionComplete(state)).toBe(false);
  });

  it('NEXT_QUESTION で currentIndex が進み、cursor と lastKeyAt がリセットされる', () => {
    let state = createInitialTypingState(1, items('ab', 'c'));
    state = typingReducer(state, press('a', 100));
    state = typingReducer(state, press('b', 200));
    expect(state.lastKeyAt).toBe(200);

    state = typingReducer(deepFreeze(state), { type: 'NEXT_QUESTION' });

    expect(state.currentIndex).toBe(1);
    expect(state.cursor).toBe(0);
    expect(state.consecutiveMiss).toBe(0);
    expect(state.lastKeyAt).toBeNull();
  });

  it('最終問題クリア後に NEXT_QUESTION で isSessionComplete が true になる', () => {
    let state = createInitialTypingState(1, items('a', 'b'));
    state = typingReducer(state, press('a', 100));
    state = typingReducer(state, { type: 'NEXT_QUESTION' });
    expect(isSessionComplete(state)).toBe(false);

    state = typingReducer(state, press('b', 200));
    expect(isQuestionComplete(state)).toBe(true);

    state = typingReducer(state, { type: 'NEXT_QUESTION' });
    expect(state.currentIndex).toBe(2);
    expect(isSessionComplete(state)).toBe(true);
  });

  it('セッション完了後の KEY_PRESS は無視される', () => {
    let state = createInitialTypingState(1, items('a'));
    state = typingReducer(state, press('a', 100));
    state = typingReducer(state, { type: 'NEXT_QUESTION' });
    expect(isSessionComplete(state)).toBe(true);

    const next = typingReducer(deepFreeze(state), press('a', 200));
    expect(next).toBe(state);
  });

  it('セッション完了後の NEXT_QUESTION は currentIndex を items.length で止める', () => {
    let state = createInitialTypingState(1, items('a'));
    state = typingReducer(state, press('a', 100));
    state = typingReducer(state, { type: 'NEXT_QUESTION' });
    expect(state.currentIndex).toBe(1);

    const next = typingReducer(deepFreeze(state), { type: 'NEXT_QUESTION' });
    expect(next).toBe(state);
    expect(next.currentIndex).toBe(1);
  });
});

describe('typingReducer: RESET', () => {
  it('levelId/items を保持したまま初期状態に戻す', () => {
    let state = createInitialTypingState(1, items('ab', 'c'));
    state = typingReducer(state, press('a', 100));
    state = typingReducer(state, press('z', 200));

    const next = typingReducer(deepFreeze(state), { type: 'RESET' });

    expect(next).toEqual(createInitialTypingState(1, items('ab', 'c')));
  });
});

describe('typingReducer: startedAt の遅延確定 (DECISIONS §9)', () => {
  it('初期状態では null、初回 KEY_PRESS で確定し、以後は上書きされない', () => {
    let state = createInitialTypingState(1, items('abc'));
    expect(state.startedAt).toBeNull();

    state = typingReducer(state, press('a', 1000));
    expect(state.startedAt).toBe(1000);

    state = typingReducer(state, press('b', 2000));
    expect(state.startedAt).toBe(1000);

    // ミスでも startedAt は変わらない
    state = typingReducer(state, press('z', 3000));
    expect(state.startedAt).toBe(1000);
  });

  it('1 打鍵もしなければ startedAt は null のままである', () => {
    const state = createInitialTypingState(1, items('abc'));
    expect(state.startedAt).toBeNull();
  });

  it('毎 KEY_PRESS で lastInputAt が更新される', () => {
    let state = createInitialTypingState(1, items('abc'));
    state = typingReducer(state, press('a', 1000));
    expect(state.lastInputAt).toBe(1000);

    state = typingReducer(state, press('z', 2000)); // ミスでも更新される
    expect(state.lastInputAt).toBe(2000);
  });
});

describe('typingReducer: totalLatencyMs から読む時間を除外する (DECISIONS §10)', () => {
  it('各問題の 1 文字目は totalLatencyMs に加算されず attempts のみ増える', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(state, press('a', 5000)); // この問題の 1 打鍵目

    expect(next.keyStats.a).toEqual({ attempts: 1, misses: 0, totalLatencyMs: 0 });
  });

  it('2 文字目以降は at - lastKeyAt が加算される', () => {
    let state = createInitialTypingState(1, items('ab'));
    state = typingReducer(state, press('a', 5000));
    state = typingReducer(state, press('b', 5300));

    expect(state.keyStats.b).toEqual({ attempts: 1, misses: 0, totalLatencyMs: 300 });
  });

  it('1 文字目のミスでも totalLatencyMs は加算されない（attempts/misses は増える）', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(state, press('z', 5000));

    expect(next.keyStats.a).toEqual({ attempts: 1, misses: 1, totalLatencyMs: 0 });
  });

  it('NEXT_QUESTION 後の 1 文字目も latency 集計から除外される', () => {
    let state = createInitialTypingState(1, items('a', 'bc'));
    state = typingReducer(state, press('a', 1000));
    state = typingReducer(state, { type: 'NEXT_QUESTION' });

    state = typingReducer(state, press('b', 9000)); // 新しい問題の 1 打鍵目
    expect(state.keyStats.b).toEqual({ attempts: 1, misses: 0, totalLatencyMs: 0 });

    state = typingReducer(state, press('c', 9200));
    expect(state.keyStats.c).toEqual({ attempts: 1, misses: 0, totalLatencyMs: 200 });
  });

  it('同じキーが複数回登場しても attempts/misses/totalLatencyMs が累積する', () => {
    let state = createInitialTypingState(1, items('aa'));
    state = typingReducer(state, press('a', 1000)); // 1 打鍵目（latency 除外）
    state = typingReducer(state, press('x', 1500)); // 2 打鍵目、ミス
    state = typingReducer(state, press('a', 1800)); // 2 打鍵目、正解

    expect(state.keyStats.a).toEqual({ attempts: 3, misses: 1, totalLatencyMs: 800 });
  });
});

describe('typingReducer: 破壊的変更をしない', () => {
  it('Object.freeze した state を渡してもエラーにならず、元の state は変化しない', () => {
    const state = deepFreeze(createInitialTypingState(1, items('ab')));

    expect(() => typingReducer(state, press('a', 100))).not.toThrow();
    // freeze された元の state 自体は変わっていない
    expect(state.cursor).toBe(0);
    expect(state.keyStats).toEqual({});
  });

  it('KEY_PRESS を繰り返しても同じ state オブジェクトを再利用しない（新しいオブジェクトを返す）', () => {
    const state = createInitialTypingState(1, items('ab'));
    const next = typingReducer(state, press('a', 100));

    expect(next).not.toBe(state);
    expect(state.cursor).toBe(0);
  });
});

describe('typingReducer: 境界値', () => {
  it('items が空の場合、初期状態から isSessionComplete が true になる', () => {
    const state = createInitialTypingState(1, []);
    expect(isSessionComplete(state)).toBe(true);
    expect(isQuestionComplete(state)).toBe(false);
  });

  it('items が空の場合、KEY_PRESS を送っても state が変化しない', () => {
    const state = createInitialTypingState(1, []);
    const next = typingReducer(deepFreeze(state), press('a', 100));
    expect(next).toBe(state);
  });

  it('1 文字だけの問題を正打鍵すると即座に isQuestionComplete が true になる', () => {
    const state = createInitialTypingState(1, items('a'));
    const next = typingReducer(state, press('a', 100));

    expect(next.cursor).toBe(1);
    expect(isQuestionComplete(next)).toBe(true);
    expect(isSessionComplete(next)).toBe(false);
  });

  it('弱点特訓 (levelId: "weakness") でも動作する', () => {
    const state: TypingState = createInitialTypingState('weakness', items('ab'));
    const next = typingReducer(state, press('a', 100));

    expect(next.levelId).toBe('weakness');
    expect(next.cursor).toBe(1);
  });
});
