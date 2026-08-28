/**
 * 正解打鍵・ミス打鍵の効果音を鳴らすフック。
 *
 * AudioContext は module スコープの singleton として遅延生成する（React の
 * Provider/Context は使わない）。呼び出し側は useSoundEffects(soundEnabled) が
 * 返す playSound(kind) を呼ぶだけでよく、AudioContext の生成・破棄・resume は
 * このファイルに閉じる。
 *
 * 参照元:
 *   - .claude/epics/sound-effects/00-decisions.md §4（module singleton。App.tsx に
 *     Provider を追加しない）
 *   - .claude/epics/sound-effects/00-decisions.md §5（AudioContext は実際に再生要求が
 *     来た初回にのみ生成する lazy 生成。soundEnabled === false の間は一切生成しない。
 *     resume() は Promise を await しない。React 19 StrictMode の二重実行下でも
 *     AudioContext が 2 つ生成されないこと）
 *   - .claude/epics/sound-effects/00-decisions.md §6（このファイルは environment: 'node'
 *     では AudioContext をテストできないため単体テスト対象外。ブラウザ確認に委ねる）
 */

import { useCallback, useEffect, useRef } from 'react';
import { getSoundParams, type SoundKind, type SoundParams } from '../engine/soundParams';

// module スコープの singleton。モジュール読み込み時には絶対に生成しない
// （lazy 生成。soundEnabled === false のまま一度も鳴らさなければ生成されない）。
// React 19 StrictMode がフック本体やエフェクトを二重実行しても、この変数は
// モジュール単位で 1 つしか存在しないため AudioContext が 2 つできることはない。
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

// クリックノイズ回避のための立ち上がり時間。durationMs（40ms 前後）に対して
// 十分短く、体感の遅延にはならない。
const FADE_IN_SEC = 0.005;
// exponentialRampToValueAtTime は 0 に到達できないため、ごく小さい値まで下げて
// 事実上の無音にする。
const FADE_OUT_FLOOR = 0.0001;

/**
 * 1 回分の OscillatorNode + GainNode を作って鳴らし、鳴らし終わったら破棄する
 * （ノードは使い捨てで、次の再生要求ごとに新規生成する。Web Audio API の作法どおり）。
 * 呼び出し元をブロックしないよう、すべて同期的に完結させる。
 */
function playTone(params: SoundParams): void {
  const ctx = getAudioContext();

  // autoplay ポリシー対策。再生要求は必ず keydown（user gesture）起点なので
  // resume は成功するが、Promise は await しない（16ms 予算を守るため
  // fire-and-forget。失敗しても無視してよい）。
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // 握りつぶす。resume に失敗しても打鍵処理は止めない。
    });
  }

  const now = ctx.currentTime;
  const durationSec = params.durationMs / 1000;

  const oscillator = ctx.createOscillator();
  oscillator.type = params.waveform;
  oscillator.frequency.setValueAtTime(params.frequency, now);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(FADE_OUT_FLOOR, now);
  gainNode.gain.linearRampToValueAtTime(params.gain, now + FADE_IN_SEC);
  gainNode.gain.exponentialRampToValueAtTime(FADE_OUT_FLOOR, now + durationSec);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(now);
  oscillator.stop(now + durationSec);
}

/**
 * soundEnabled が true の間だけ、playSound(kind) の呼び出しで短い効果音を鳴らす。
 *
 * - soundEnabled === false の間は AudioContext を一切生成しない（ref を読むだけで
 *   即 return するため、getAudioContext() にすら到達しない）。
 * - playSound は同期・void・fire-and-forget。内部は try/catch で保護されており、
 *   AudioContext の生成・再生に失敗しても例外は呼び出し元に伝播せず、打鍵処理を
 *   止めない。
 * - useCallback の依存配列を空にして参照を安定させる（soundEnabled の変化は
 *   ref 経由で反映するだけで、playSound 自体を作り直さない）。呼び出し側の
 *   useCallback 依存配列に安全に含められる。
 */
export function useSoundEffects(soundEnabled: boolean): (kind: SoundKind) => void {
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playSound = useCallback((kind: SoundKind): void => {
    if (!soundEnabledRef.current) {
      return;
    }
    try {
      playTone(getSoundParams(kind));
    } catch {
      // AudioContext 生成・再生の失敗を握りつぶす。効果音は補助的な機能であり、
      // 打鍵処理を絶対に止めない。
    }
  }, []);

  return playSound;
}
