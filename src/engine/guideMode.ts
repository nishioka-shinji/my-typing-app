/**
 * Settings.guideMode の 'auto' 解決と、運指ガイドの表示判定。
 *
 * DOM にも React にも依存しない純粋関数群。
 *
 * 参照元:
 *   - .claude/epics/typing-app/00-decisions.md §6（guideMode 'auto' の解決順序）
 *   - docs/design.md §3.3（同一文字 3 回連続ミスでヘルプ強制介入）/ §3.5（運指ガイドの 3 段階表示）
 */

import type { GuideMode, Settings } from '../storage/schema';

/**
 * 実効 guideMode を解決する（DECISIONS §6）。
 * - settings.guideMode === 'auto'（ユーザー未選択の sentinel 値）のときのみ、
 *   レベルごとの既定値 levelDefaultGuideMode を返す（レベル連動）。
 * - ユーザーが 'always' | 'onMiss' | 'never' を明示選択している場合は、
 *   レベルに関係なく常にその値を優先する（レベル遷移で上書きしない）。
 */
export function resolveGuideMode(
  settings: Pick<Settings, 'guideMode'>,
  levelDefaultGuideMode: GuideMode,
): GuideMode {
  if (settings.guideMode === 'auto') {
    return levelDefaultGuideMode;
  }
  return settings.guideMode;
}

/**
 * 運指ガイドを表示すべきかを判定する。
 * - 同一文字で 3 回以上連続ミスしているときは、resolvedMode が 'never' でも
 *   強制的に表示する（design.md §3.3 のヘルプ強制介入）。
 * - 'always' は常に表示。
 * - 'onMiss' は直近にミスがあったときのみ表示。
 * - 'never' はそれ以外では非表示。
 */
export function shouldShowGuide(
  resolvedMode: GuideMode,
  hasRecentMiss: boolean,
  consecutiveMiss: number,
): boolean {
  if (consecutiveMiss >= 3) {
    return true;
  }
  if (resolvedMode === 'always') {
    return true;
  }
  if (resolvedMode === 'onMiss') {
    return hasRecentMiss;
  }
  return false;
}
