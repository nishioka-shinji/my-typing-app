import { describe, expect, it } from 'vitest';
import {
  GUIDE_MODE_OPTIONS,
  QUESTION_COUNT_OPTIONS,
  getSaveStatusInfo,
  isValidQuestionCount,
  resetFlowReducer,
} from './SettingsScreen';
import { resolveGuideMode } from '../engine/guideMode';
import type { GuideMode } from '../storage/schema';

describe('GUIDE_MODE_OPTIONS', () => {
  it('4択であり、auto/always/onMiss/never を網羅する (DECISIONS §6)', () => {
    expect(GUIDE_MODE_OPTIONS.map((opt) => opt.value)).toEqual(['auto', 'always', 'onMiss', 'never']);
  });

  it("'auto' は「レベル連動（自動）」ラベルに対応する", () => {
    const auto = GUIDE_MODE_OPTIONS.find((opt) => opt.value === 'auto');
    expect(auto?.label).toBe('レベル連動（自動）');
  });

  it("'auto' は resolveGuideMode によりレベルの既定値に解決される", () => {
    const levelDefaults: GuideMode[] = ['always', 'onMiss', 'never'];
    for (const levelDefault of levelDefaults) {
      expect(resolveGuideMode({ guideMode: 'auto' }, levelDefault)).toBe(levelDefault);
    }
  });

  it('auto 以外の明示選択は、レベルが変わっても上書きされない (DECISIONS §6 回帰テスト)', () => {
    const explicitOptions = GUIDE_MODE_OPTIONS.filter((opt) => opt.value !== 'auto');
    const levelDefaults: GuideMode[] = ['always', 'onMiss', 'never'];
    for (const opt of explicitOptions) {
      for (const levelDefault of levelDefaults) {
        expect(resolveGuideMode({ guideMode: opt.value }, levelDefault)).toBe(opt.value);
      }
    }
  });
});

describe('isValidQuestionCount', () => {
  it('10/20/30 は受け付ける', () => {
    for (const count of QUESTION_COUNT_OPTIONS) {
      expect(isValidQuestionCount(count)).toBe(true);
    }
  });

  it('10/20/30 以外は拒否する', () => {
    for (const invalid of [0, 5, 15, 25, 40, -10, 20.5, 100]) {
      expect(isValidQuestionCount(invalid)).toBe(false);
    }
  });
});

describe('getSaveStatusInfo', () => {
  it("'ok' は警告レベルにならない", () => {
    expect(getSaveStatusInfo('ok').level).toBe('ok');
  });

  it("'degraded' は警告になる（容量超過によるデータ損失の恐れ）", () => {
    const info = getSaveStatusInfo('degraded');
    expect(info.level).toBe('warning');
    expect(info.message.length).toBeGreaterThan(0);
  });

  it("'failed' はエラーになる（保存不可）", () => {
    const info = getSaveStatusInfo('failed');
    expect(info.level).toBe('error');
    expect(info.message.length).toBeGreaterThan(0);
  });
});

describe('resetFlowReducer', () => {
  it('idle -> REQUEST -> confirming', () => {
    expect(resetFlowReducer('idle', { type: 'REQUEST' })).toBe('confirming');
  });

  it('confirming -> CANCEL -> idle（キャンセル時は何も実行されない前提の状態遷移）', () => {
    expect(resetFlowReducer('confirming', { type: 'CANCEL' })).toBe('idle');
  });

  it('confirming -> CONFIRM -> idle（実行後は確認 UI を閉じる）', () => {
    expect(resetFlowReducer('confirming', { type: 'CONFIRM' })).toBe('idle');
  });

  it('idle -> CANCEL は idle のまま', () => {
    expect(resetFlowReducer('idle', { type: 'CANCEL' })).toBe('idle');
  });
});
