import { describe, expect, it } from 'vitest';
import { getSoundParams } from './soundParams';
import type { SoundKind } from './soundParams';

describe('getSoundParams', () => {
  const kinds: SoundKind[] = ['correct', 'miss'];

  for (const kind of kinds) {
    it(`'${kind}' のパラメータが返る`, () => {
      const params = getSoundParams(kind);
      expect(params.frequency).toBeGreaterThan(0);
      expect(params.durationMs).toBeGreaterThan(0);
      expect(params.gain).toBeGreaterThan(0);
      expect(params.waveform).toBe('sine');
    });
  }

  it('miss の gain は correct の gain 以下である（連続ミスでストレスにならないため）', () => {
    const correct = getSoundParams('correct');
    const miss = getSoundParams('miss');
    expect(miss.gain).toBeLessThanOrEqual(correct.gain);
  });

  it('miss の周波数は correct の周波数より低い（音程で区別する）', () => {
    const correct = getSoundParams('correct');
    const miss = getSoundParams('miss');
    expect(miss.frequency).toBeLessThan(correct.frequency);
  });

  it('durationMs は控えめな短音の想定範囲内（20〜80ms）', () => {
    for (const kind of kinds) {
      const { durationMs } = getSoundParams(kind);
      expect(durationMs).toBeGreaterThanOrEqual(20);
      expect(durationMs).toBeLessThanOrEqual(80);
    }
  });

  it('gain は控えめな上限（0.2）以下', () => {
    for (const kind of kinds) {
      const { gain } = getSoundParams(kind);
      expect(gain).toBeLessThanOrEqual(0.2);
    }
  });

  it('波形は両方とも sine（柔らかい音のキャラクター）', () => {
    for (const kind of kinds) {
      expect(getSoundParams(kind).waveform).toBe('sine');
    }
  });

  it('同じ kind を渡すと常に同じパラメータを返す（純粋関数）', () => {
    expect(getSoundParams('correct')).toEqual(getSoundParams('correct'));
    expect(getSoundParams('miss')).toEqual(getSoundParams('miss'));
  });
});
