/**
 * ホーム画面（design.md §5.2）。
 *
 * レベル一覧・進捗・統計サマリ・弱点特訓の導線を表示し、練習開始時には
 * generator（t07）で問題を生成して `PracticeRequest` を組み立て、`onStart` で
 * 親（t18 が結線する App）に渡す。画面遷移は一切自前で行わず、すべて
 * `onStart` / `onNavigate` のコールバック props 経由で外に出す。
 *
 * このコンポーネントは Context を直接読まない（`useAppData` を呼ばない）。
 * `appData` は props として受け取るだけなので、t18 側で好きなタイミング・好きな
 * データソースから結線できる。
 *
 * 参照元:
 *   - docs/design.md §5.2（ワイヤーフレーム）/ §3.1（レベルロック）/ §3.6（弱点特訓）/
 *     §3.7（統計）/ §3.8（設定）
 *   - .claude/epics/typing-app/00-decisions.md §3（CSS 構成）/ §6（guideMode 'auto'）
 *   - .claude/epics/typing-app/CROSS-CUTTING.md（t08: weakScore 全件 0 なら弱点なしの判定は
 *     呼び出し側の責務 / t07: generateWeaknessItems の charset は解放済みレベルの和集合）
 */

import type {
  AppData,
  LevelDef,
  LevelId,
  LevelProgress,
  PracticeRequest,
  ScreenName,
  SessionRecord,
} from '../storage/schema';
import { LEVELS } from '../data/levels';
import { generateItems, generateWeaknessItems } from '../engine/generator';
import { computeWeakScores, getTopWeakKeys, WEAKNESS_TRAINING_QUESTION_COUNT } from '../engine/weakness';
import { resolveGuideMode } from '../engine/guideMode';
import './HomeScreen.css';

export interface HomeScreenProps {
  appData: AppData;
  /** レベル開始・弱点特訓開始のいずれも、組み立てた PracticeRequest を渡して呼ぶ */
  onStart: (request: PracticeRequest) => void;
  /** ヘッダの [統計] [設定] ボタン押下時に呼ぶ */
  onNavigate: (screen: ScreenName) => void;
}

// ---------- 表示ロジック（純粋関数。単体テスト対象） ----------

/** カリキュラム 1 行の表示状態。design.md §5.2 の ✓ / ▶ / 🔒 に対応する。 */
export type LevelDisplayState = 'cleared' | 'active' | 'locked';

/**
 * レベル 1 件の表示状態を判定する。
 * - クリア済みなら常に 'cleared'（レベルロック設定に関わらず優先）。
 * - `levelLockEnabled` が false のときは、未クリアであっても常に 'active'
 *   （design.md §3.8: レベルロック OFF で全レベル選択可能）。
 * - `levelLockEnabled` が true のときは `progress.unlocked` に従う。
 */
export function getLevelDisplayState(
  progress: LevelProgress,
  levelLockEnabled: boolean,
): LevelDisplayState {
  if (progress.cleared) {
    return 'cleared';
  }
  const selectable = levelLockEnabled ? progress.unlocked : true;
  return selectable ? 'active' : 'locked';
}

/** 総打鍵数をカンマ区切りに整形する（例: 12480 -> "12,480"）。 */
export function formatKeystrokeCount(totalKeystrokes: number): string {
  const normalized = Math.max(0, Math.floor(totalKeystrokes));
  return normalized.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 総時間を `1h 24m` 形式に整形する。
 * - 1 時間未満は分のみ（例: 0 -> "0m"、59分 -> "59m"）。
 * - 1 時間以上は時＋分（60分ちょうど -> "1h 0m"）。24 時間を超えても単純に積み上げる
 *   （日をまたいでも h をリセットしない。総練習時間の累積値のため）。
 */
export function formatTotalTime(totalTimeMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, totalTimeMs) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/** 弱点特訓ブロックの表示状態。 */
export type WeaknessStatus =
  /** セッション不足・キーごとの試行回数不足で判定材料がまだ無い */
  | { kind: 'no-data' }
  /** 判定材料はあるが、全キーの weakScore が 0（＝相対的な弱点差が無い＝ノーミス等） */
  | { kind: 'no-weakness' }
  /** 弱点あり。keys は表示・特訓に使う上位キー（最大 5 件） */
  | { kind: 'ready'; keys: string[] };

/**
 * 弱点特訓の導線を出すべきか判定する（CROSS_CUTTING の t08 契約対応）。
 *
 * `getTopWeakKeys` は相対順位のみで判定するため、ノーミスのユーザーでも必ず 5 キー
 * 返してしまう（試行回数の閾値さえ満たせば weakScore は全キー 0 になるだけで、
 * 配列自体は空にならない）。「弱点として提示してよいか」は
 * `computeWeakScores` の結果を見て、
 *   - 候補が 0 件（試行回数不足）なら 'no-data'
 *   - 候補はあるが全 weakScore が 0 なら 'no-weakness'
 *   - 1 件でも weakScore > 0 があれば 'ready'
 * の 3 状態に分けて判定する。これにより初回起動直後や無ミスのユーザーに
 * 「a s d f j が苦手です」という誤った表示をしない。
 */
export function getWeaknessStatus(sessions: SessionRecord[]): WeaknessStatus {
  const scores = computeWeakScores(sessions);
  if (scores.length === 0) {
    return { kind: 'no-data' };
  }
  const hasSignal = scores.some((score) => score.weakScore > 0);
  if (!hasSignal) {
    return { kind: 'no-weakness' };
  }
  return { kind: 'ready', keys: getTopWeakKeys(sessions) };
}

/**
 * 弱点特訓の問題生成（`generateWeaknessItems`）に渡す charset を算出する。
 *
 * t07 レビュアー推奨（CROSS_CUTTING 記載）に従い、**解放済みレベルの charset の和集合**
 * とする。未解放レベルの記号（例: まだ辿り着いていない Lv6 の Shift 記号）が弱点特訓に
 * 混入するのを防ぐため。`levelLockEnabled` の設定値には依存しない
 * （ロック設定を OFF にして先のレベルを選べるようにしても、実際に合格して解放した
 * 記号だけを弱点特訓の母集団にする方が「まだ習っていない記号を特訓で急に見せられる」
 * 事故を避けられるという判断。ロック OFF は「先取りして挑戦できる」機能であって
 * 「未経験の記号を弱点として出す」機能ではないため）。
 * `items`（fixedList）方式のレベルは charset を持たないため対象外。
 */
export function getUnlockedCharsetUnion(progress: Record<LevelId, LevelProgress>): string[] {
  const charset = new Set<string>();
  for (const level of LEVELS) {
    if (progress[level.id].unlocked && level.charset) {
      for (const ch of level.charset) {
        charset.add(ch);
      }
    }
  }
  return [...charset];
}

/**
 * 弱点特訓セッションの合否判定基準（passAccuracy / passKpm）を決める。
 *
 * design.md は弱点特訓に固有の合格基準を定めておらず（§3.6: 「特訓セッションは
 * レベル解放判定には影響しない」とあるのみ）、`PracticeRequest` は型上
 * passAccuracy/passKpm を必須で持つため、何らかの値を選ぶ必要がある。
 * ここでは「今まさに挑戦中のレベル」（unlocked かつ未クリアの最初のレベル）の基準を
 * 流用する。全レベルクリア済みなら最後にクリアしたレベルの基準、それも無ければ
 * （通常あり得ないが防御的に）Lv1 の基準にフォールバックする。結果画面での
 * 合否表示に意味を持たせつつ、レベル解放には一切影響しないのは
 * summarizeSession（t05）側の契約どおり。
 */
export function getWeaknessPassCriteria(
  progress: Record<LevelId, LevelProgress>,
): { passAccuracy: number; passKpm: number } {
  const currentLevel = LEVELS.find((level) => progress[level.id].unlocked && !progress[level.id].cleared);
  if (currentLevel) {
    return { passAccuracy: currentLevel.passAccuracy, passKpm: currentLevel.passKpm };
  }
  const clearedLevels = LEVELS.filter((level) => progress[level.id].cleared);
  const fallbackLevel = clearedLevels[clearedLevels.length - 1] ?? LEVELS[0];
  return { passAccuracy: fallbackLevel.passAccuracy, passKpm: fallbackLevel.passKpm };
}

// ---------- 表示補助 ----------

const LEVEL_ICON: Record<LevelDisplayState, string> = {
  cleared: '✓',
  active: '▶',
  locked: '🔒',
};

const LEVEL_STATE_LABEL: Record<LevelDisplayState, string> = {
  cleared: 'クリア済み',
  active: '挑戦中',
  locked: 'ロック中',
};

function formatBestRecord(progress: LevelProgress): string {
  const accuracyPercent = Math.round(progress.bestAccuracy * 100);
  return `${accuracyPercent}% / ${progress.bestKpm} KPM`;
}

// ---------- コンポーネント本体 ----------

export function HomeScreen({ appData, onStart, onNavigate }: HomeScreenProps) {
  const { settings } = appData;

  function handleStartLevel(level: LevelDef) {
    const items = generateItems(level, { questionCount: settings.questionCount });
    const guideMode = resolveGuideMode(settings, level.defaultGuideMode);
    const request: PracticeRequest = {
      kind: 'level',
      levelId: level.id,
      title: `Lv${level.id} ${level.name}`,
      items,
      passAccuracy: level.passAccuracy,
      passKpm: level.passKpm,
      guideMode,
    };
    onStart(request);
  }

  function handleStartWeakness(keys: string[]) {
    const charset = getUnlockedCharsetUnion(appData.progress);
    const items = generateWeaknessItems(keys, charset, {
      questionCount: WEAKNESS_TRAINING_QUESTION_COUNT,
    });
    const criteria = getWeaknessPassCriteria(appData.progress);
    // レベル定義が無いため既定値は 'onMiss' とする（ユーザーが明示選択していればそちらを優先）。
    // 弱点特訓は「すでにある程度習得した上で苦手キーだけを狙う」補習枠のため、常時表示ほど
    // 手厚くはせず、ミス時のみ運指ガイドを出す中間的な既定値が妥当と判断した。
    const guideMode = resolveGuideMode(settings, 'onMiss');
    const request: PracticeRequest = {
      kind: 'weakness',
      levelId: 'weakness',
      title: '弱点特訓',
      items,
      passAccuracy: criteria.passAccuracy,
      passKpm: criteria.passKpm,
      guideMode,
    };
    onStart(request);
  }

  const weaknessStatus = getWeaknessStatus(appData.sessions);

  return (
    <div className="home">
      <header className="home__header">
        <span className="home__prompt">$ my-typing-app</span>
        <div className="home__header-actions">
          {settings.showStats && (
            <button type="button" className="home__nav-button" onClick={() => onNavigate('stats')}>
              統計
            </button>
          )}
          <button type="button" className="home__nav-button" onClick={() => onNavigate('settings')}>
            設定
          </button>
        </div>
      </header>

      {settings.showStats && (
        <section className="home__summary" aria-label="統計サマリ">
          <div className="home__summary-item">連続 {appData.totals.streakDays} 日</div>
          <div className="home__summary-item">
            総打鍵 {formatKeystrokeCount(appData.totals.totalKeystrokes)}
          </div>
          <div className="home__summary-item">総時間 {formatTotalTime(appData.totals.totalTimeMs)}</div>
        </section>
      )}

      <section className="home__curriculum">
        <h2 className="home__section-title">CURRICULUM</h2>
        <ul className="home__level-list" aria-label="カリキュラム一覧">
          {LEVELS.map((level) => {
            const progress = appData.progress[level.id];
            const state = getLevelDisplayState(progress, settings.levelLockEnabled);
            const clickable = state !== 'locked';
            const statusText = state === 'cleared' ? formatBestRecord(progress) : state === 'active' ? '---- 未クリア' : '';
            const ariaLabel = `Lv${level.id} ${level.name}、${LEVEL_STATE_LABEL[state]}${statusText ? `、${statusText}` : ''}`;

            return (
              <li key={level.id} className={`home__level home__level--${state}`}>
                <button
                  type="button"
                  className="home__level-button"
                  disabled={!clickable}
                  aria-label={ariaLabel}
                  onClick={clickable ? () => handleStartLevel(level) : undefined}
                >
                  <span className="home__level-icon" aria-hidden="true">
                    {LEVEL_ICON[state]}
                  </span>
                  <span className="home__level-name">
                    Lv{level.id} {level.name}
                  </span>
                  <span className="home__level-status">
                    {state === 'locked' ? `(${LEVEL_STATE_LABEL.locked})` : statusText}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="home__weakness">
        <h2 className="home__section-title">
          <span aria-hidden="true">⚡</span> 弱点特訓
        </h2>
        {weaknessStatus.kind === 'ready' ? (
          <div className="home__weakness-body">
            <p className="home__weakness-text">
              {weaknessStatus.keys.map((key) => (
                <code key={key} className="home__weakness-key">
                  {key}
                </code>
              ))}
              <span> が苦手です</span>
            </p>
            <button
              type="button"
              className="home__weakness-button"
              onClick={() => handleStartWeakness(weaknessStatus.keys)}
            >
              特訓する
            </button>
          </div>
        ) : (
          <div className="home__weakness-body">
            <p className="home__weakness-empty">
              {weaknessStatus.kind === 'no-data'
                ? 'データを集めています。練習を重ねると弱点を分析します。'
                : '今のところ苦手なキーは見つかっていません。'}
            </p>
            <button type="button" className="home__weakness-button" disabled>
              特訓する
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
