/**
 * 練習画面の問題文表示（確定済み・現在位置・ミス演出）。
 *
 * props のみで動作し、Context・storage・typingReducer には一切依存しない
 * （t15/t16/t17 が TypingState から必要な値を抽出して渡す想定の契約）。
 *
 * 参照元:
 *   - docs/design.md §5.3（練習画面レイアウト）/ §10.1（カラートークン）/
 *     §10.2（タイポグラフィ）/ §10.3（フィードバック）/ §4（再描画範囲の限定）
 *   - .claude/epics/typing-app/00-decisions.md §3（CSS 構成方式・クラス名 prefix）
 *
 * t11（Keyboard/KeyCap）レビューで発覚した罠への対策:
 *   1. 同値 props でアニメーションが再生されない問題
 *      → missSeq の変化を検知したら、対象 DOM に reflow を強制してからクラスを
 *        付け直す（後述の useEffect）。同じ文字への連続ミスでも確実に再生される。
 *   2. CSS 詳細度によるカラー上書き
 *      → ミスフラッシュは CSS Animation で実装しており、Animation は通常の
 *        (!important の付かない) 静的宣言より常に優先されるため、
 *        drilltext__char--current 等の状態クラスの color 指定と競合しない。
 *   3. コントラスト比不足
 *      → 実装後に theme.css の実値で計算済み（report 参照）。text-done/cursor/error は
 *        いずれも --bg・--bg-elevated の両方に対して 4.5:1 を上回る。
 */
import { memo, useEffect, useRef } from 'react';
import './DrillText.css';

export type DrillCharState = 'done' | 'current' | 'pending';

export interface DrillTextProps {
  /** 出題文字列（DrillItem.text 相当）。表示専用で、判定ロジックは持たない */
  text: string;
  /** 現在のカーソル位置（0-indexed）。text[cursor] が次に打つべき文字 */
  cursor: number;
  /** Lv7/Lv8 用のコマンド説明（DrillItem.hint 相当）。渡された場合のみ 1 行併記する */
  hint?: string;
  /**
   * ミスのたびに +1 される nonce。同じ文字への連続ミス（cursor が変わらないミス）でも
   * 呼び出し側はこの値を必ず増やすこと。DrillText 側はこの値の変化を検知して
   * フラッシュ／シェイクを再生する（値そのものの意味は持たない）。
   */
  missSeq: number;
}

interface CharProps {
  ch: string;
  state: DrillCharState;
  isCurrent: boolean;
}

/** スペースを可視化する記号（U+2423 OPEN BOX）。実際の判定文字は変えず表示のみ置き換える */
const SPACE_GLYPH = '␣';

/**
 * 1 文字分の表示。React.memo で確定済み・未入力文字の再レンダリングを避ける
 * （design.md §4: 打鍵ごとの再レンダリング範囲を「現在の問題行」に限定する方針の実装）。
 * props は ch/state/isCurrent の primitive のみなので、cursor が 1 つ進んでも
 * 値が変化しない文字（大半の文字）は shallow compare で再レンダリングされない。
 * 実際に再レンダリングされるのは「done に変わった直前の文字」と「current になった
 * 次の文字」の高々 2 文字のみ。
 */
const Char = memo(function Char({ ch, state, isCurrent }: CharProps) {
  const isSpace = ch === ' ';
  const display = isSpace ? SPACE_GLYPH : ch;
  const classNames = ['drilltext__char', `drilltext__char--${state}`];
  if (isSpace) {
    classNames.push('drilltext__char--space');
  }
  return (
    <span className={classNames.join(' ')} data-current={isCurrent ? 'true' : undefined}>
      {display}
    </span>
  );
});

export function DrillText({ text, cursor, hint, missSeq }: DrillTextProps) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const prevMissSeqRef = useRef(missSeq);

  useEffect(() => {
    if (missSeq === prevMissSeqRef.current) {
      return;
    }
    prevMissSeqRef.current = missSeq;
    const line = lineRef.current;
    if (!line) {
      return;
    }
    const flashTarget = line.querySelector<HTMLElement>('[data-current="true"]');

    // 同じ文字への連続ミスなど、クラス名(文字列)としては変化がないケースでも
    // CSS アニメーションを確実に再生させるため、一度クラスを外して reflow を
    // 強制してから再度付与する。React の key 変更による強制再マウント（t11 方式）
    // だと文字単位のメモ化を壊してしまうため、ここでは DOM 直接操作で代替する。
    line.classList.remove('drilltext__line--shake');
    flashTarget?.classList.remove('drilltext__char--flash');
    void line.offsetWidth; // reflow を強制するためだけの読み取り
    line.classList.add('drilltext__line--shake');
    flashTarget?.classList.add('drilltext__char--flash');
  }, [missSeq]);

  const chars = text.split('');

  return (
    <div className="drilltext">
      {/* key={text} により、問題が切り替わったときだけ行全体を再マウントしてフェード
          イン演出（150ms）を再生する。同一問題内の cursor/missSeq の更新では
          key が変わらないため再マウントは発生せず、Char の memo 化はここでも保たれる。 */}
      <div className="drilltext__line" ref={lineRef} key={text}>
        {chars.map((ch, index) => {
          const state: DrillCharState = index < cursor ? 'done' : index === cursor ? 'current' : 'pending';
          return <Char key={index} ch={ch} state={state} isCurrent={index === cursor} />;
        })}
      </div>
      {hint !== undefined && hint !== '' && <p className="drilltext__hint">{hint}</p>}
    </div>
  );
}
