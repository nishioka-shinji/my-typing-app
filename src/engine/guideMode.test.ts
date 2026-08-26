import { describe, expect, it } from 'vitest';
import { resolveGuideMode, shouldShowGuide } from './guideMode';
import type { GuideMode } from '../storage/schema';

describe('resolveGuideMode', () => {
  const levelDefaults: GuideMode[] = ['always', 'onMiss', 'never'];

  for (const defaultMode of levelDefaults) {
    it(`guideMode 'auto' はレベルの既定値 '${defaultMode}' を返す`, () => {
      expect(resolveGuideMode({ guideMode: 'auto' }, defaultMode)).toBe(defaultMode);
    });
  }

  const explicitModes: GuideMode[] = ['always', 'onMiss', 'never'];

  for (const explicit of explicitModes) {
    for (const defaultMode of levelDefaults) {
      it(`明示選択 '${explicit}' はレベル既定値 '${defaultMode}' に関わらずレベル遷移で不変`, () => {
        expect(resolveGuideMode({ guideMode: explicit }, defaultMode)).toBe(explicit);
      });
    }
  }
});

describe('shouldShowGuide', () => {
  it("resolvedMode 'always' は常に表示", () => {
    expect(shouldShowGuide('always', false, 0)).toBe(true);
    expect(shouldShowGuide('always', true, 0)).toBe(true);
  });

  it("resolvedMode 'onMiss' は直近ミスがあるときだけ表示", () => {
    expect(shouldShowGuide('onMiss', true, 0)).toBe(true);
    expect(shouldShowGuide('onMiss', false, 0)).toBe(false);
  });

  it("resolvedMode 'never' は通常非表示", () => {
    expect(shouldShowGuide('never', true, 0)).toBe(false);
    expect(shouldShowGuide('never', false, 0)).toBe(false);
  });

  it("consecutiveMiss >= 3 のときは resolvedMode が 'never' でも強制表示になる", () => {
    expect(shouldShowGuide('never', false, 3)).toBe(true);
    expect(shouldShowGuide('never', false, 4)).toBe(true);
  });

  it('consecutiveMiss が 3 未満のときは強制表示されない', () => {
    expect(shouldShowGuide('never', false, 2)).toBe(false);
  });

  it("consecutiveMiss >= 3 は 'onMiss' でも表示を維持する", () => {
    expect(shouldShowGuide('onMiss', false, 3)).toBe(true);
  });
});
