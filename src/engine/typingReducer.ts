/**
 * タイピングエンジンの中核 reducer。
 *
 * DOM にも React にも依存しない純粋関数として実装する。現在時刻を関数内で取得せず、
 * 呼び出し側が action.at として注入した時刻を用いる（テスト容易性のため。t09 のキー入力
 * フックが keydown イベントから Date.now() を渡す想定）。
 *
 * 参照元:
 *   - docs/design.md §3.3（ミス時「進めない」方式）/ §7.3（reducer の中核）
 *   - .claude/epics/typing-app/00-decisions.md §9（startedAt の遅延確定）/
 *     §10（各問題の 1 文字目は totalLatencyMs に加算しない）
 */

import type {
  DrillItem,
  KeyStat,
  LevelId,
  TypingAction,
  TypingState,
} from '../storage/schema';

function createEmptyKeyStat(): KeyStat {
  return { attempts: 0, misses: 0, totalLatencyMs: 0 };
}

/**
 * TypingState の初期値を生成する。levelId/items は呼び出し側の値をそのまま保持する
 * （RESET でも levelId/items を引き継ぐため、この関数を共通で使う）。
 */
export function createInitialTypingState(
  levelId: LevelId | 'weakness',
  items: DrillItem[],
): TypingState {
  return {
    levelId,
    items,
    currentIndex: 0,
    cursor: 0,
    startedAt: null,
    lastKeyAt: null,
    lastInputAt: null,
    correctCount: 0,
    missCount: 0,
    consecutiveMiss: 0,
    keyStats: {},
  };
}

/**
 * 現在の問題を最後まで打ち切ったか。
 *
 * reducer 自身は問題クリアを検知しても自動で NEXT_QUESTION に遷移しない
 * （呼び出し側 = UI が isQuestionComplete を見て明示的に NEXT_QUESTION をディスパッチする
 * 設計。演出のタイミング等を UI 側の都合に委ねるため）。
 */
export function isQuestionComplete(state: TypingState): boolean {
  const current = state.items[state.currentIndex];
  if (!current) return false;
  return state.cursor >= current.text.length;
}

/** 全問題を打ち切った（＝セッション完了）か */
export function isSessionComplete(state: TypingState): boolean {
  return state.currentIndex >= state.items.length;
}

function handleKeyPress(state: TypingState, key: string, at: number): TypingState {
  // 修飾キー単独や複数文字のキー名（'Shift' 'Backspace' 'Enter' 'CapsLock' 等）は無視する。
  // 一次フィルタは hook 側（t09）の責務だが、reducer が UI から直接叩かれた場合の安全策
  // として、ここでも 1 文字のキーだけを受け付ける。Backspace が無効なのもこの分岐による
  // （「進めない方式」では消すものがないため）。
  if (key.length !== 1) return state;

  // セッション完了後の入力は無視する。
  if (isSessionComplete(state)) return state;

  const current = state.items[state.currentIndex];
  const expected = current.text[state.cursor];

  // 現在の問題を最後まで打ち切っており、UI がまだ NEXT_QUESTION をディスパッチしていない
  // 場合（expected が存在しない）も無視する。
  if (expected === undefined) return state;

  const isCorrect = key === expected; // 大文字小文字を区別する厳密比較

  // DECISIONS §9: セッション内最初の有効打鍵で startedAt を確定し、以後は上書きしない。
  const startedAt = state.startedAt ?? at;

  // DECISIONS §10: 各問題の 1 文字目の試行は「次の問題文を読む時間」が latency に混入する
  // ため totalLatencyMs に加算しない。問題開始時（初期状態・NEXT_QUESTION 後）は
  // lastKeyAt が null にリセットされているので、これで判定する。正誤どちらでも同じ扱い。
  const prevStat = state.keyStats[expected] ?? createEmptyKeyStat();
  const latencyDelta = state.lastKeyAt === null ? 0 : at - state.lastKeyAt;

  // keyStats のキーは「押されたキー」ではなく「期待文字（打つべきだったキー）」にする。
  // 弱点分析（t08）は「このキーが打てない」を判定するためのものなので、ミス時にどのキーを
  // 誤って押したかではなく、どのキーで詰まっているかを記録する必要がある。
  const nextStat: KeyStat = {
    attempts: prevStat.attempts + 1,
    misses: prevStat.misses + (isCorrect ? 0 : 1),
    totalLatencyMs: prevStat.totalLatencyMs + latencyDelta,
  };

  return {
    ...state,
    startedAt,
    lastKeyAt: at,
    lastInputAt: at,
    cursor: isCorrect ? state.cursor + 1 : state.cursor,
    correctCount: state.correctCount + (isCorrect ? 1 : 0),
    missCount: state.missCount + (isCorrect ? 0 : 1),
    // 「同一文字での連続ミス」をカウントする。ミス時は cursor が進まないため、同じ
    // cursor 位置に留まる限り expected は常に同じ文字になる。したがって「連続ミス」を
    // 単純にインクリメントするだけで「同一文字での連続ミス」の意図を満たせる。正解した
    // 瞬間（cursor が進む＝別の文字に移る）や NEXT_QUESTION/RESET（別の問題に移る）で
    // 0 に戻すことで、「文字が変わったら連続ミスはリセットする」という設計書 §3.3 の
    // 意図（同じキーで詰まっている人だけを助ける）を満たす。
    consecutiveMiss: isCorrect ? 0 : state.consecutiveMiss + 1,
    keyStats: { ...state.keyStats, [expected]: nextStat },
  };
}

function handleNextQuestion(state: TypingState): TypingState {
  // セッション完了後（＝最後の問題の後）の NEXT_QUESTION は無視し、currentIndex を
  // items.length で止める。
  if (isSessionComplete(state)) return state;

  return {
    ...state,
    currentIndex: state.currentIndex + 1,
    cursor: 0,
    consecutiveMiss: 0,
    // 次の問題の 1 文字目を latency 集計から除外するためリセットする (DECISIONS §10)。
    lastKeyAt: null,
  };
}

export function typingReducer(state: TypingState, action: TypingAction): TypingState {
  switch (action.type) {
    case 'KEY_PRESS':
      return handleKeyPress(state, action.key, action.at);
    case 'NEXT_QUESTION':
      return handleNextQuestion(state);
    case 'RESET':
      // levelId/items は引き継ぎ、それ以外を初期状態に戻す。
      return createInitialTypingState(state.levelId, state.items);
    default:
      return state;
  }
}
