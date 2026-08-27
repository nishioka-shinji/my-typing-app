import { describe, expect, it } from 'vitest';
import { buildPolylinePoints, computeYDomain, scaleX, scaleY } from './Chart';

describe('computeYDomain', () => {
  it('series が空のとき既定レンジ [0, 1] を返す（クラッシュしない）', () => {
    expect(computeYDomain([])).toEqual({ min: 0, max: 1 });
  });

  it('全 series の values が空のとき既定レンジ [0, 1] を返す', () => {
    expect(computeYDomain([{ label: 'kpm', values: [] }])).toEqual({ min: 0, max: 1 });
  });

  it('1 点だけのときはその値を中心にレンジが作られる（min === max のパディング経由）', () => {
    const domain = computeYDomain([{ label: 'kpm', values: [100] }]);
    expect(domain.min).toBeLessThan(100);
    expect(domain.max).toBeGreaterThan(100);
  });

  it('全点が同値（0 以外）のとき min === max にならないようパディングされる', () => {
    const domain = computeYDomain([{ label: 'kpm', values: [100, 100, 100] }]);
    expect(domain.max).not.toBe(domain.min);
    expect(domain.min).toBeLessThan(100);
    expect(domain.max).toBeGreaterThan(100);
  });

  it('全点が 0 のとき（0 除算の代表的な危険ケース）もパディングされる', () => {
    const domain = computeYDomain([{ label: 'kpm', values: [0, 0] }]);
    expect(domain.max).not.toBe(domain.min);
    expect(domain.min).toBeLessThan(0);
    expect(domain.max).toBeGreaterThan(0);
  });

  it('yMin/yMax が指定されていれば優先する', () => {
    expect(computeYDomain([{ label: 'kpm', values: [10, 200] }], 0, 300)).toEqual({ min: 0, max: 300 });
  });

  it('複数 series の最小値・最大値をまたいで算出する', () => {
    const domain = computeYDomain([
      { label: 'kpm', values: [50, 120] },
      { label: 'accuracy', values: [0.8, 0.95] },
    ]);
    expect(domain.min).toBe(0.8);
    expect(domain.max).toBe(120);
  });

  it('20 点（直近セッション上限相当）でも例外を出さない', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 5);
    expect(() => computeYDomain([{ label: 'kpm', values }])).not.toThrow();
  });
});

describe('scaleX', () => {
  it('count が 0 のとき中央の座標を返す（ゼロ除算しない）', () => {
    expect(scaleX(0, 0, 320, 36, 12)).toBeCloseTo(36 + (320 - 36 - 12) / 2, 5);
  });

  it('count が 1 のとき中央の座標を返す', () => {
    expect(scaleX(0, 1, 320, 36, 12)).toBeCloseTo(36 + (320 - 36 - 12) / 2, 5);
  });

  it('count が 2 以上のとき先頭は左端、末尾は右端になる', () => {
    const left = scaleX(0, 4, 320, 36, 12);
    const right = scaleX(3, 4, 320, 36, 12);
    expect(left).toBeCloseTo(36, 5);
    expect(right).toBeCloseTo(320 - 12, 5);
  });
});

describe('scaleY', () => {
  it('domain のレンジが 0 のときゼロ除算せず中央の座標を返す', () => {
    const y = scaleY(100, { min: 100, max: 100 }, 160, 12, 12);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeCloseTo(12 + (160 - 12 - 12) / 2, 5);
  });

  it('最大値は上端付近、最小値は下端付近になる（Y は下向きが正のため反転する）', () => {
    const domain = { min: 0, max: 100 };
    const yAtMax = scaleY(100, domain, 160, 12, 12);
    const yAtMin = scaleY(0, domain, 160, 12, 12);
    expect(yAtMax).toBeLessThan(yAtMin);
  });
});

describe('buildPolylinePoints', () => {
  const padding = { top: 12, right: 12, bottom: 12, left: 36 };

  it('values が 0 件のとき空文字列を返す（polyline を描画しないためのガード）', () => {
    expect(buildPolylinePoints([], { min: 0, max: 1 }, 320, 160, padding)).toBe('');
  });

  it('values が 1 件でも例外を出さず 1 組の座標を返す', () => {
    const points = buildPolylinePoints([100], { min: 0, max: 200 }, 320, 160, padding);
    expect(points.split(' ')).toHaveLength(1);
  });

  it('values が 20 件でも例外を出さず 20 組の座標を返す', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 5);
    const points = buildPolylinePoints(values, { min: 0, max: 100 }, 320, 160, padding);
    expect(points.split(' ')).toHaveLength(20);
  });

  it('全点同値でも NaN を含まない座標文字列を返す', () => {
    const points = buildPolylinePoints([50, 50, 50], { min: 50, max: 50 }, 320, 160, padding);
    expect(points).not.toContain('NaN');
  });
});
