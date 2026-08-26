/**
 * 練習画面の keydown 購読フック。
 *
 * 判定ロジック（何を無視し、何を文字入力として扱うか）は keyEventPolicy.ts に
 * 切り出し済みの純粋関数 classifyKeyEvent に委譲する。このファイルの責務は
 * DOM イベントの購読・解除・classifyKeyEvent の結果に応じた副作用（コールバック
 * 呼び出し・preventDefault・CapsLock/IME の状態変化通知）だけに絞る。
 *
 * 参照元:
 *   - docs/design.md §9（キー入力ハンドリングの注意点）/ §4（16ms レイテンシ・window ではなく要素で購読）
 *   - .claude/epics/typing-app/01-tasks.json t09 steps
 */

import { useEffect, useRef, type RefObject } from 'react';
import { classifyKeyEvent } from './keyEventPolicy';

export interface UseKeyboardInputOptions {
  /**
   * keydown を購読する対象要素への ref。`window` ではなく要素で購読する
   * （design.md §9: 練習画面は `<div tabIndex={0}>` にフォーカスを当てる前提）。
   */
  targetRef: RefObject<HTMLElement | null>;
  /** false の間は購読しない（結果画面表示中など、誤入力を拾いたくない場面向け） */
  enabled: boolean;
  /**
   * 打鍵として受理した 1 文字を通知する。at は Date.now() を使う
   * （SessionRecord.playedAt と同じ時間軸で durationMs を扱うため。
   * performance.now() は起点がタブ生成時刻などブラウザ依存で、
   * playedAt=Date.now() との差分計算に使えない）。
   */
  onChar: (char: string, at: number) => void;
  /** Escape が押されたことを通知する（セッション中断確認のトリガー。中断の実行は呼び出し側） */
  onEscape: () => void;
  /** IME 変換中の状態が変化したときに呼ばれる（true: 変換中に入った / false: 抜けた） */
  onImeDetected?: (active: boolean) => void;
  /** CapsLock の ON/OFF が変化したときだけ呼ばれる */
  onCapsLockChange?: (on: boolean) => void;
}

/**
 * targetRef の要素に keydown リスナーを登録し、classifyKeyEvent の判定結果に
 * 応じてコールバックを呼び出す。
 *
 * パフォーマンス方針（design.md §4: 入力レイテンシ 16ms 以内 / 再レンダー範囲を広げない）:
 *   - コールバック本体は毎レンダー変わりうる（呼び出し側が useCallback を使わない場合も
 *     ある）ため ref に退避し、リスナーの張り直しは enabled / targetRef が変わったときだけ
 *     に限定する。これにより呼び出し側の再レンダーのたびに addEventListener/removeEventListener
 *     が走ることを避ける。
 *   - keydown ハンドラ内は classifyKeyEvent（純粋関数、O(1)）とコールバック呼び出しのみで、
 *     重い処理は一切行わない。
 */
export function useKeyboardInput({
  targetRef,
  enabled,
  onChar,
  onEscape,
  onImeDetected,
  onCapsLockChange,
}: UseKeyboardInputOptions): void {
  const callbacksRef = useRef({ onChar, onEscape, onImeDetected, onCapsLockChange });
  useEffect(() => {
    callbacksRef.current = { onChar, onEscape, onImeDetected, onCapsLockChange };
  });

  // CapsLock / IME の直前の状態。変化したときだけ通知するために保持する。
  const capsLockOnRef = useRef(false);
  const imeActiveRef = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!enabled || !target) return undefined;

    function handleKeyDown(event: KeyboardEvent): void {
      // CapsLock は判定結果に関わらず毎回チェックする（ミス扱いにしない設定キーの
      // 押下でも CapsLock 状態自体は変わりうるため）。getModifierState が使えない
      // 環境（型定義上は必須だが念のため）ではガードする。
      const capsLockOn =
        typeof event.getModifierState === 'function' && event.getModifierState('CapsLock');
      if (capsLockOn !== capsLockOnRef.current) {
        capsLockOnRef.current = capsLockOn;
        callbacksRef.current.onCapsLockChange?.(capsLockOn);
      }

      const result = classifyKeyEvent(event);

      if (result.preventDefault) {
        event.preventDefault();
      }

      const isImeActive = result.reason === 'ime';
      if (isImeActive !== imeActiveRef.current) {
        imeActiveRef.current = isImeActive;
        callbacksRef.current.onImeDetected?.(isImeActive);
      }

      if (result.action === 'ignore') {
        return;
      }

      if (result.action === 'escape') {
        callbacksRef.current.onEscape();
        return;
      }

      // result.action === 'char'（classifyKeyEvent の契約上、この分岐では char が必ず入る）
      callbacksRef.current.onChar(result.char as string, Date.now());
    }

    target.addEventListener('keydown', handleKeyDown);
    return () => {
      target.removeEventListener('keydown', handleKeyDown);
    };
  }, [targetRef, enabled]);
}
