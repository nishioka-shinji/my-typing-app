/**
 * 軽量 SVG 折れ線グラフ（直近セッションの KPM・正確率推移を想定）。
 *
 * 依存ライブラリを追加せず SVG を自前描画する（design.md §3.7）。props のみで
 * 動作し、Context・storage には依存しない。座標計算はすべて純粋関数として
 * 切り出してあり、Chart.test.ts で 0 点／1 点／全点同値／複数系列の境界値を
 * 単体テストする（vitest の environment は 'node' 固定のため、DOM を必要とする
 * レンダリングそのものはテストできない。手動確認は npm run dev で行う）。
 *
 * 参照元: docs/design.md §3.7
 */
import './Chart.css';

export interface ChartSeries {
  label: string;
  values: number[];
  /** 省略時は DEFAULT_SERIES_COLORS を順番に使う */
  color?: string;
}

export interface ChartProps {
  series: ChartSeries[];
  /** SVG の高さ(px)。省略時は 160 */
  height?: number;
  /** Y 軸下限を固定したい場合に指定。省略時は series の最小値から自動算出 */
  yMin?: number;
  /** Y 軸上限を固定したい場合に指定。省略時は series の最大値から自動算出 */
  yMax?: number;
  /** X 軸に表示するラベル（例: セッション日時の短縮表記） */
  xLabels?: string[];
}

interface Domain {
  min: number;
  max: number;
}

interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** SVG の内部座標系の幅。実表示幅は CSS (width: 100%) で決まる */
const VIEWBOX_WIDTH = 320;
const DEFAULT_HEIGHT = 160;
const POINT_RADIUS = 2.5;
const GRID_LINE_RATIOS = [0, 0.5, 1] as const;

/** 系列に色指定がないときに順番に使うデフォルトカラー（theme.css のトークン） */
const DEFAULT_SERIES_COLORS = ['var(--cursor)', 'var(--text-done)', 'var(--accent)'];

/**
 * Y 軸のドメイン(min/max)を算出する。
 * - series が空、または全 values が空のときは既定レンジ [0, 1] を返す（クラッシュ防止）。
 * - yMin/yMax が指定されていればそれを優先する。
 * - 全データ点が同値（min === max）のときはゼロ除算を避けるため上下にパディングする。
 */
export function computeYDomain(series: ChartSeries[], yMin?: number, yMax?: number): Domain {
  const allValues = series.flatMap((s) => s.values);
  const fallbackMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const fallbackMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  let min = yMin ?? fallbackMin;
  let max = yMax ?? fallbackMax;

  if (min === max) {
    // 全点同値（0 のときは ±1、それ以外は値の 10% 分）だけレンジを広げてゼロ除算を防ぐ
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }

  return { min, max };
}

/**
 * データ点のインデックスを SVG の X 座標に変換する。
 * count <= 1 のときは中央に配置する（0 除算を避けつつ、1 点でも描画できるように）。
 */
export function scaleX(index: number, count: number, width: number, paddingLeft: number, paddingRight: number): number {
  const usable = width - paddingLeft - paddingRight;
  if (count <= 1) {
    return paddingLeft + usable / 2;
  }
  return paddingLeft + (usable * index) / (count - 1);
}

/**
 * 値を SVG の Y 座標に変換する（値が大きいほど上＝小さい Y になる）。
 * domain.max === domain.min（レンジ 0）のときはゼロ除算を避け、中央の高さを返す。
 */
export function scaleY(value: number, domain: Domain, height: number, paddingTop: number, paddingBottom: number): number {
  const usable = height - paddingTop - paddingBottom;
  const range = domain.max - domain.min;
  if (range === 0) {
    return paddingTop + usable / 2;
  }
  const ratio = (value - domain.min) / range;
  return paddingTop + usable * (1 - ratio);
}

/**
 * 1 系列分の polyline 用 points 文字列を組み立てる。
 * values が 0 件のときは空文字列を返す（呼び出し側で polyline 自体を描画しない）。
 */
export function buildPolylinePoints(
  values: number[],
  domain: Domain,
  width: number,
  height: number,
  padding: ChartPadding,
): string {
  if (values.length === 0) {
    return '';
  }
  return values
    .map((value, index) => {
      const x = scaleX(index, values.length, width, padding.left, padding.right);
      const y = scaleY(value, domain, height, padding.top, padding.bottom);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatAxisValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function Chart({ series, height = DEFAULT_HEIGHT, yMin, yMax, xLabels }: ChartProps) {
  const width = VIEWBOX_WIDTH;
  const hasXLabels = xLabels !== undefined && xLabels.length > 0;
  const padding: ChartPadding = { top: 12, right: 12, bottom: hasXLabels ? 28 : 12, left: 36 };
  const domain = computeYDomain(series, yMin, yMax);
  const isEmpty = series.length === 0 || series.every((s) => s.values.length === 0);

  return (
    <div className="chart">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="セッション推移グラフ"
      >
        {GRID_LINE_RATIOS.map((ratio) => {
          const y = padding.top + (height - padding.top - padding.bottom) * ratio;
          return (
            <line
              key={ratio}
              className="chart__grid-line"
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
            />
          );
        })}

        <text className="chart__axis-label" x={2} y={padding.top + 4}>
          {formatAxisValue(domain.max)}
        </text>
        <text className="chart__axis-label" x={2} y={height - padding.bottom}>
          {formatAxisValue(domain.min)}
        </text>

        {series.map((s, seriesIndex) => {
          const color = s.color ?? DEFAULT_SERIES_COLORS[seriesIndex % DEFAULT_SERIES_COLORS.length];
          const points = buildPolylinePoints(s.values, domain, width, height, padding);
          return (
            <g key={s.label}>
              {s.values.length > 1 && (
                <polyline className="chart__line" points={points} style={{ stroke: color }} />
              )}
              {s.values.map((value, index) => (
                <circle
                  key={index}
                  className="chart__point"
                  r={POINT_RADIUS}
                  cx={scaleX(index, s.values.length, width, padding.left, padding.right)}
                  cy={scaleY(value, domain, height, padding.top, padding.bottom)}
                  style={{ fill: color }}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {isEmpty && <p className="chart__empty">まだデータがありません</p>}

      {hasXLabels && (
        <div className="chart__x-labels">
          {xLabels.map((label, index) => (
            <span key={index} className="chart__x-label">
              {label}
            </span>
          ))}
        </div>
      )}

      {series.length > 0 && (
        <ul className="chart__legend">
          {series.map((s, index) => (
            <li key={s.label} className="chart__legend-item">
              <span
                className="chart__legend-swatch"
                style={{ backgroundColor: s.color ?? DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
