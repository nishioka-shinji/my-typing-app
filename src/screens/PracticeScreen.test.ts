import { describe, expect, it } from 'vitest';
import {
  computeProgressLabel,
  resolveAlertKeyId,
  resolveKeyboardVisible,
  resolveShowFingerGuide,
} from './PracticeScreen';
import {
  createInitialTypingState,
  isSessionComplete,
  typingReducer,
} from '../engine/typingReducer';
import { summarizeSession } from '../engine/metrics';
import type { DrillItem, TypingState } from '../storage/schema';

/**
 * jsdom 非導入 (t01 の決定) のため PracticeScreen 自体のレンダリングテストは
 * 書けない。代わりに、画面から切り出した純粋関数と、typingReducer/metrics を
 * 組み合わせた「画面が実際に踏む手順」を直接検証する。
 *
 * PracticeScreen.tsx から named export された関数をそのまま import しているが、
 * この時点では JSX を含む PracticeScreen 関数自体は一切呼び出されない（定義される
 * だけ）ため、DOM が無い環境でも安全に import できる（Keyboard.test.ts が
 * resolveKeyStates を同様の方法でテストしている前例に倣う）。
 */

describe('resolveAlertKeyId（3 連続ミスのヘルプ強制介入）', () => {
  it('consecutiveMiss が 2 以下では点滅対象を返さない', () => {
    expect(resolveAlertKeyId('a', 0)).toBeNull();
    expect(resolveAlertKeyId('a', 1)).toBeNull();
    expect(resolveAlertKeyId('a', 2)).toBeNull();
  });

  it('consecutiveMiss が 3 になった瞬間に「次に打つべき文字」のキー id を返す', () => {
    expect(resolveAlertKeyId('a', 3)).toBe('a');
    expect(resolveAlertKeyId(';', 3)).toBe('semicolon');
  });

  it('consecutiveMiss が 3 を超えても点滅対象を返し続ける', () => {
    expect(resolveAlertKeyId('a', 4)).toBe('a');
    expect(resolveAlertKeyId('a', 10)).toBe('a');
  });

  it('正打鍵で consecutiveMiss が 0 に戻ると点滅対象も消える（リセット）', () => {
    // 3 連続ミス相当の状態から、正打鍵で 0 に戻ったケースを模す。
    expect(resolveAlertKeyId('a', 3)).toBe('a');
    expect(resolveAlertKeyId('a', 0)).toBeNull();
  });

  it('nextChar が null（セッション未開始/完了時）は consecutiveMiss に関わらず null', () => {
    expect(resolveAlertKeyId(null, 5)).toBeNull();
  });

  it('US 配列で解決できない文字は null を返す（無反応。呼び出し側の実害なし）', () => {
    expect(resolveAlertKeyId('あ', 3)).toBeNull();
  });
});

describe('resolveShowFingerGuide（guideMode の実効表示 × 3 連続ミス強制表示の合成）', () => {
  it("settings.guideMode === 'auto' はレベル既定値に従う", () => {
    expect(resolveShowFingerGuide('auto', 'always', 0)).toBe(true);
    expect(resolveShowFingerGuide('auto', 'never', 0)).toBe(false);
  });

  it('明示選択はレベル既定値に関わらず優先される', () => {
    expect(resolveShowFingerGuide('never', 'always', 0)).toBe(false);
    expect(resolveShowFingerGuide('always', 'never', 0)).toBe(true);
  });

  it("'onMiss' は consecutiveMiss > 0 のときだけ表示する", () => {
    expect(resolveShowFingerGuide('onMiss', 'never', 0)).toBe(false);
    expect(resolveShowFingerGuide('onMiss', 'never', 1)).toBe(true);
  });

  it("guideMode が 'never'（明示選択）でも consecutiveMiss >= 3 で強制表示になる", () => {
    expect(resolveShowFingerGuide('never', 'never', 2)).toBe(false);
    expect(resolveShowFingerGuide('never', 'never', 3)).toBe(true);
  });

  it("'auto' + レベル既定 'never' でも 3 連続ミスで強制表示になる", () => {
    expect(resolveShowFingerGuide('auto', 'never', 3)).toBe(true);
  });
});

/**
 * r1 レビュー minor-3 対応: settings.showKeyboard=false のときヘルプ強制介入
 * （design.md §3.3）が完全に不可視になっていた問題を、3 連続ミス以上の間だけ
 * Keyboard を強制表示する方式で解消した。ここではその判定ロジックを検証する。
 */
describe('resolveKeyboardVisible（showKeyboard=false でもヘルプ強制介入は表示する）', () => {
  it('showKeyboard=true なら consecutiveMiss に関わらず常に表示', () => {
    expect(resolveKeyboardVisible(true, 0)).toBe(true);
    expect(resolveKeyboardVisible(true, 5)).toBe(true);
  });

  it('showKeyboard=false かつ consecutiveMiss が 2 以下なら非表示', () => {
    expect(resolveKeyboardVisible(false, 0)).toBe(false);
    expect(resolveKeyboardVisible(false, 1)).toBe(false);
    expect(resolveKeyboardVisible(false, 2)).toBe(false);
  });

  it('showKeyboard=false でも consecutiveMiss >= 3 になった瞬間に強制表示される', () => {
    expect(resolveKeyboardVisible(false, 3)).toBe(true);
    expect(resolveKeyboardVisible(false, 10)).toBe(true);
  });
});

describe('computeProgressLabel（進捗表示 N/M の計算）', () => {
  it('0-indexed の currentIndex を 1-indexed の表示に変換する', () => {
    expect(computeProgressLabel(0, 20)).toEqual({ current: 1, total: 20 });
    expect(computeProgressLabel(7, 20)).toEqual({ current: 8, total: 20 });
  });

  it('currentIndex が total に達しても "21/20" のように超過表示しない（クランプ）', () => {
    expect(computeProgressLabel(20, 20)).toEqual({ current: 20, total: 20 });
    expect(computeProgressLabel(99, 20)).toEqual({ current: 20, total: 20 });
  });

  it('items が空（total 0）のときは 0/0 を返し例外を出さない', () => {
    expect(computeProgressLabel(0, 0)).toEqual({ current: 0, total: 0 });
  });

  it('負の currentIndex を渡しても 1 未満にはならない', () => {
    expect(computeProgressLabel(-1, 20)).toEqual({ current: 1, total: 20 });
  });
});

/**
 * missSeq（= TypingState.missCount）の単調性担保について。
 *
 * PracticeScreen は RESET アクションを一切 dispatch しない設計にしている
 * （画面はセッション 1 回につき 1 回マウントされ、「もう一度」はコンポーネントの
 * 再マウント = missCount を含む TypingState 全体を作り直す形で対応する想定。
 * t18 が再マウントを行う際は DrillText/Keyboard も含めて丸ごと作り直されるため、
 * missSeq が同一インスタンス内で減ることはない）。
 * ここでは、その前提を裏付けるため、RESET を挟まない一連の KEY_PRESS/NEXT_QUESTION
 * だけで missCount が単調非減少であることを typingReducer で直接検証する。
 */
describe('missSeq（TypingState.missCount）の単調性', () => {
  const items: DrillItem[] = [{ text: 'ab' }, { text: 'cd' }];

  it('RESET を dispatch しない限り、ミス・正解・問題送りのどの操作でも missCount は減らない', () => {
    let state: TypingState = createInitialTypingState(1, items);
    const missCountHistory: number[] = [state.missCount];

    const steps: Array<{ type: 'KEY_PRESS'; key: string } | { type: 'NEXT_QUESTION' }> = [
      { type: 'KEY_PRESS', key: 'x' }, // 1 問目 1 文字目ミス
      { type: 'KEY_PRESS', key: 'x' }, // 同一文字への連続ミス
      { type: 'KEY_PRESS', key: 'a' }, // 正解（cursor 進む）
      { type: 'KEY_PRESS', key: 'b' }, // 正解（1 問目クリア）
      { type: 'NEXT_QUESTION' },
      { type: 'KEY_PRESS', key: 'c' }, // 2 問目 1 文字目は正解
      { type: 'KEY_PRESS', key: 'x' }, // 2 問目 2 文字目ミス
      { type: 'KEY_PRESS', key: 'd' }, // 正解（2 問目クリア）
      { type: 'NEXT_QUESTION' }, // 最終問題クリア後の NEXT_QUESTION でセッション完了になる
    ];

    let at = 1000;
    for (const step of steps) {
      at += 100;
      state =
        step.type === 'KEY_PRESS'
          ? typingReducer(state, { type: 'KEY_PRESS', key: step.key, at })
          : typingReducer(state, { type: 'NEXT_QUESTION' });
      missCountHistory.push(state.missCount);
    }

    for (let i = 1; i < missCountHistory.length; i += 1) {
      expect(missCountHistory[i]).toBeGreaterThanOrEqual(missCountHistory[i - 1]);
    }
    // 3 回ミスした（'x' が 3 回）ので最終的な missCount は 3
    expect(state.missCount).toBe(3);
    expect(isSessionComplete(state)).toBe(true);
  });
});

describe('セッション完了判定と SessionSummary（1 打鍵も無いケースを含む）', () => {
  it('全問題を打ち切ると isSessionComplete が true になり、summarizeSession が有限値を返す', () => {
    const items: DrillItem[] = [{ text: 'ab' }];
    let state = createInitialTypingState(1, items);
    state = typingReducer(state, { type: 'KEY_PRESS', key: 'a', at: 1000 });
    state = typingReducer(state, { type: 'KEY_PRESS', key: 'b', at: 1200 });

    expect(isSessionComplete(state)).toBe(false); // NEXT_QUESTION 前はまだ完了していない
    state = typingReducer(state, { type: 'NEXT_QUESTION' });
    expect(isSessionComplete(state)).toBe(true);

    const summary = summarizeSession(state, { passAccuracy: 0.9, passKpm: 10 });
    expect(Number.isFinite(summary.accuracy)).toBe(true);
    expect(Number.isFinite(summary.kpm)).toBe(true);
    expect(Number.isFinite(summary.durationMs)).toBe(true);
    expect(summary.durationMs).toBeGreaterThan(0);
  });

  it('items が空（1 打鍵もせず終了）でも isSessionComplete が最初から true で、NaN/Infinity を出さない', () => {
    const state = createInitialTypingState(1, []);
    expect(isSessionComplete(state)).toBe(true);

    const summary = summarizeSession(state, { passAccuracy: 0.9, passKpm: 10 });
    expect(summary.accuracy).toBe(0);
    expect(summary.kpm).toBe(0);
    expect(summary.durationMs).toBe(0);
    expect(summary.passed).toBe(false);
    expect(Number.isNaN(summary.accuracy)).toBe(false);
    expect(Number.isFinite(summary.kpm)).toBe(true);
  });
});
