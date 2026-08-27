/**
 * 練習画面の指標バー（正確率 / KPM / ミス / 問題番号を 1 行表示）。
 *
 * props のみで動作し、Context・storage・metrics.ts には依存しない。数値の計算
 * （0/0 のガード等）は呼び出し側（t15/t16/t17）が src/engine/metrics.ts の関数を
 * 使って行う契約。本コンポーネントは表示専用だが、props 誤用時に NaN/Infinity を
 * 画面に出さないための防御的ガードのみ持つ。
 *
 * 参照元: docs/design.md §5.3
 */
import './StatsBar.css';

export interface StatsBarProps {
  /** 正確率。0..1 を想定（metrics.ts の calcAccuracy と同じスケール） */
  accuracy: number;
  /** 1 分あたりの正しい打鍵数 */
  kpm: number;
  missCount: number;
  /** 現在の問題インデックス。0-indexed（TypingState.currentIndex と同じ規約）。表示は +1 する */
  questionIndex: number;
  questionTotal: number;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  const v = safeNumber(value);
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampNonNegativeInt(value: number): number {
  const v = Math.round(safeNumber(value));
  return v < 0 ? 0 : v;
}

export function StatsBar({ accuracy, kpm, missCount, questionIndex, questionTotal }: StatsBarProps) {
  const accuracyPct = Math.round(clamp01(accuracy) * 100);
  const kpmValue = clampNonNegativeInt(kpm);
  const missValue = clampNonNegativeInt(missCount);
  const questionTotalValue = clampNonNegativeInt(questionTotal);
  // questionIndex は 0-indexed のため、人間向け表示では +1 する
  const questionCurrent = clampNonNegativeInt(questionIndex) + 1;

  return (
    <div className="statsbar">
      <span className="statsbar__item">
        <span className="statsbar__label">正確率</span>
        <span className="statsbar__value">{accuracyPct}%</span>
      </span>
      <span className="statsbar__item">
        <span className="statsbar__label">KPM</span>
        <span className="statsbar__value">{kpmValue}</span>
      </span>
      <span className="statsbar__item">
        <span className="statsbar__label">ミス</span>
        <span className="statsbar__value">{missValue}</span>
      </span>
      <span className="statsbar__item">
        <span className="statsbar__label">問題</span>
        <span className="statsbar__value">
          {questionCurrent}/{questionTotalValue}
        </span>
      </span>
    </div>
  );
}
