/**
 * 効果音（正解打鍵／ミス打鍵）のイベント種別から音パラメータへのマッピング。
 *
 * DOM にも React にも Web Audio API にも依存しない純粋関数群。
 * 実際に AudioContext を使って鳴らす処理は src/hooks/useSoundEffects.ts の責務。
 *
 * 参照元:
 *   - .claude/epics/sound-effects/00-decisions.md §1（鳴らす場面は正解／ミスの 2 種類のみ）
 *   - .claude/epics/sound-effects/00-decisions.md §2（音量調整 UI は無く、gain はこのファイルの
 *     定数に固定値として置く。1 箇所で調整できるようにする）
 *   - .claude/epics/sound-effects/00-decisions.md §3（sine 波中心・40ms 前後・控えめな gain。
 *     ミス音は正解音より低い音程・gain は正解音以下）
 */

export type SoundKind = 'correct' | 'miss';

export interface SoundParams {
  /** 発振周波数（Hz） */
  frequency: number;
  /** OscillatorNode の波形 */
  waveform: OscillatorType;
  /** 音の長さ（ミリ秒） */
  durationMs: number;
  /** ピーク音量（0〜1）。gain の具体値はここでのみ調整する */
  gain: number;
}

// 正解打鍵: 少し高めの音程で軽やかに。
const CORRECT_FREQUENCY_HZ = 880;
const CORRECT_DURATION_MS = 40;
const CORRECT_GAIN = 0.08;

// ミス打鍵: 正解音より低い音程・低い（もしくは同等以下の）音量にして、
// 連続ミス時に耳障りにならないようにする（視覚フィードバックが主、音は補助）。
const MISS_FREQUENCY_HZ = 220;
const MISS_DURATION_MS = 45;
const MISS_GAIN = 0.06;

const WAVEFORM: OscillatorType = 'sine';

/**
 * イベント種別から音パラメータを返す。
 */
export function getSoundParams(kind: SoundKind): SoundParams {
  if (kind === 'miss') {
    return {
      frequency: MISS_FREQUENCY_HZ,
      waveform: WAVEFORM,
      durationMs: MISS_DURATION_MS,
      gain: MISS_GAIN,
    };
  }
  return {
    frequency: CORRECT_FREQUENCY_HZ,
    waveform: WAVEFORM,
    durationMs: CORRECT_DURATION_MS,
    gain: CORRECT_GAIN,
  };
}
