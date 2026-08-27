/**
 * 統計画面（design.md §3.7 / §5.1）。
 *
 * 表示するもの:
 *   - 直近 20 セッションの KPM・正確率推移（軽量な折れ線グラフ。古い順に左から）
 *   - レベル別ベスト記録（KPM / 正確率 / プレイ回数）
 *   - 総打鍵数・総練習時間・連続練習日数（ストリーク）
 *   - キー別ヒートマップ（弱点の可視化。aggregateKeyStats ベース）
 *
 * このコンポーネントは Context を直接読まない（`useAppData` を呼ばない）。`appData` は
 * props として受け取るだけで、画面遷移も `onBack` コールバック経由で外に出す
 * （t18 が結線する）。HomeScreen (t13) と同じ方針（props 駆動・画面遷移を自前で行わない）。
 *
 * ★ settings.showStats（design.md §3.8）との連動について:
 * HomeScreen (t13) は `showStats === false` のとき「統計サマリ」と「[統計] リンク」の
 * 両方を非表示にする実装になっている。そのため showStats が false のユーザーは
 * 通常この画面へ到達する導線を持たない。一方でこの StatsScreen 自体は
 * `settings.showStats` を一切参照せず、渡されれば常にフルの内容を描画する
 * （= 画面はいつでも表示可能。design.md §3.8 は「グラフ表示の ON/OFF」であって
 * 「統計画面自体の有効/無効」ではないと解釈した）。
 * 導線を出すかどうかの判断は HomeScreen 側の責務、遷移そのものは t18（App.tsx の
 * ルーティング）の責務であり、この画面の描画条件には含めない。これにより
 * 万一 t18 が「設定で統計を隠していてもURL直打ち相当で見られるようにしたい」等の
 * 判断をしても StatsScreen 側の変更は不要になる。
 *
 * ★ ヒートマップの集計元について（DECISIONS §7 の役割分担、最重要）:
 * `AppData.aggregateKeyStats`（全期間累積・無重み）だけを使う。`weakness.ts` の
 * `computeWeakScores`（`sessions` を重み付き再集計するもの）は弱点特訓の抽出専用で
 * 役割が違うため、ここでは import すらしない（混同防止）。
 *
 * データが空のとき（初回起動直後、sessions 0 件・aggregateKeyStats 空）でも
 * 例外を出さず、「まだ記録がありません」の空状態バナーを出す。グラフ自体は
 * Chart（t12）が 0 点/1 点で安全に描画できることを確認済み。
 *
 * 参照元:
 *   - docs/design.md §3.7（記録・統計）/ §5.1（画面一覧）/ §4（アクセシビリティ）
 *   - .claude/epics/typing-app/00-decisions.md §3（CSS 構成）/ §7（aggregateKeyStats の役割）
 *   - .claude/epics/typing-app/tasks/t12/review-r1.md「後続タスクへの契約」
 *     （Chart に単位の異なる系列を混ぜない／NaN・Infinity を渡さない）
 */
import type { AppData, KeyStat, LevelProgress, SessionRecord } from '../storage/schema';
import { LEVELS } from '../data/levels';
import { ALL_KEYS, KEYBOARD_ROWS, findKeyForChar } from '../data/keyboardUs';
import { Chart } from '../components/Chart';
import './StatsScreen.css';

export interface StatsScreenProps {
  appData: AppData;
  /** ヘッダーの [戻る] ボタン押下時に呼ぶ。画面遷移はこのコールバックの外では一切行わない */
  onBack: () => void;
}

// ---------- 推移グラフ用データ整形（純粋関数。単体テスト対象） ----------

export interface SessionTrendPoint {
  kpm: number;
  accuracy: number;
}

/**
 * `AppData.sessions`（新しい順・最大 20 件）から、Chart に渡す「古い順」の推移データを作る
 * （design.md §3.7: 直近 20 セッションの推移。古い順に左から）。
 *
 * t12 レビューの契約（Chart.tsx: NaN/Infinity が混ざると polyline が丸ごと消える）に従い、
 * `Number.isFinite` で防御する。kpm/accuracy は t05 の計算結果を保存した値であり、
 * storage 層（t02）のバリデーションで NaN/Infinity は既に弾かれているため実データ経路での
 * 混入は無いはずだが、「t17 が独自に計算した値」ではなく保存値をそのまま使う場合でも
 * 防御コストは低いため踏襲する。kpm と accuracy は同じセッションの対（同じ x 座標）として
 * 扱うため、どちらか一方でも非有限ならそのセッションごと除外し、2 系列のインデックスが
 * ずれないようにする。
 */
export function buildSessionTrend(sessions: SessionRecord[]): SessionTrendPoint[] {
  return sessions
    .slice(0, 20)
    .filter((session) => Number.isFinite(session.kpm) && Number.isFinite(session.accuracy))
    .map((session) => ({ kpm: session.kpm, accuracy: session.accuracy }))
    .reverse();
}

/**
 * KPM 推移を Chart の `values` 用に整数へ丸める。
 *
 * ★ t13 で "100.59518819683124 KPM" とそのまま表示された major の再発防止（同じ轍を
 * 踏まない）。KPM は元々 `correctCount / (durationMs/60000)` の除算結果で小数を含みうる
 * ため、表示・グラフ双方で必ず丸める。
 */
export function buildKpmSeriesValues(trend: SessionTrendPoint[]): number[] {
  return trend.map((point) => Math.round(point.kpm));
}

/**
 * 正確率推移を Chart の `values` 用にパーセント（0..100、小数第 1 位まで）へ変換する。
 *
 * ★ t12 レビューで確定した契約: KPM（50〜120 程度）と正確率（0..1）を同じ Chart に
 * 混ぜるとスケールが潰れる（正確率系列の Y 座標差が 0.02px という実測あり）。
 * 対策として **KPM 用と正確率用の Chart を分ける**（このファイルの StatsScreen 本体で
 * 2 つの `<Chart>` を独立して描画する）。さらに正確率は 0..100 のパーセント表示に
 * 変換しておくことで、そのままでも軸ラベルが直感的な値になる。
 */
export function buildAccuracyPercentSeriesValues(trend: SessionTrendPoint[]): number[] {
  return trend.map((point) => Math.round(point.accuracy * 1000) / 10);
}

// ---------- 総合記録の表示整形（純粋関数。単体テスト対象） ----------

/**
 * 総打鍵数をカンマ区切りに整形する。NaN/Infinity は '0' にフォールバックする。
 *
 * HomeScreen.tsx（t13 所有）の同名関数と同じロジックだが、files_owned の境界上
 * import できる共有ユーティリティモジュールが存在しないため、この画面専用に複製する
 * （t15 ResultScreen 相当の画面でも同様の複製が前例としてある想定）。
 */
export function formatKeystrokeCount(totalKeystrokes: number): string {
  if (!Number.isFinite(totalKeystrokes)) {
    return '0';
  }
  const normalized = Math.max(0, Math.floor(totalKeystrokes));
  return normalized.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 総練習時間を `1h 24m` 形式に整形する。NaN/Infinity は '0m' にフォールバックする。
 * HomeScreen.tsx と同じ丸め方（詳細は {@link formatKeystrokeCount} のコメント参照）。
 */
export function formatTotalTime(totalTimeMs: number): string {
  if (!Number.isFinite(totalTimeMs)) {
    return '0m';
  }
  const totalMinutes = Math.floor(Math.max(0, totalTimeMs) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/**
 * レベル別ベスト記録（正確率）を整形する。未プレイ（playCount === 0）のレベルは
 * "0% / 0 KPM" という「ゼロだらけ」の誤解を招く表示を避け、"—" にする。
 */
export function formatLevelBestAccuracy(progress: LevelProgress): string {
  return progress.playCount > 0 ? `${Math.round(progress.bestAccuracy * 100)}%` : '—';
}

/** レベル別ベスト記録（KPM）を整形する。丸め方針は {@link formatLevelBestAccuracy} 参照。 */
export function formatLevelBestKpm(progress: LevelProgress): string {
  return progress.playCount > 0 ? String(Math.round(progress.bestKpm)) : '—';
}

// ---------- キー別ヒートマップ（純粋関数。単体テスト対象） ----------

export interface KeyHeatCell {
  keyId: string;
  attempts: number;
  misses: number;
  /** attempts が 0（未試行）のときは null。"0% ミス（試行済み）" と区別するため */
  missRate: number | null;
}

/**
 * `AppData.aggregateKeyStats`（全期間累積・無重み。DECISIONS §7 のヒートマップ専用データ）
 * から、物理キーごとに集計した `KeyHeatCell` を作る。
 *
 * `aggregateKeyStats` のキーは「期待文字」（typingReducer.ts のコメント参照）であり、
 * 物理キー 1 つが複数の文字を持ちうる（例: '1' キーは unshifted '1' と shifted '!'、
 * 'h' キーは 'h' と Shift 込みの 'H'）。`findKeyForChar` で文字→物理キーへ正引きし、
 * 同じ物理キーに乗る全文字分の attempts/misses を合算する。
 *
 * ゼロ除算ガード: attempts が 0 の物理キーは missRate を null にする（0 で割らない）。
 * 全キーが同じ値でも／aggregateKeyStats が空でも、この関数は例外を投げない
 * （`ALL_KEYS` を土台にループするため、非特殊キーは必ず 1 件ずつ結果に含まれる）。
 */
export function buildKeyHeatmap(aggregateKeyStats: Record<string, KeyStat>): Map<string, KeyHeatCell> {
  const totals = new Map<string, { attempts: number; misses: number }>();

  for (const [char, stat] of Object.entries(aggregateKeyStats)) {
    const match = findKeyForChar(char);
    if (!match) {
      // US 配列で入力不可能な文字（想定外データ）は無視する。クラッシュしないことを優先する。
      continue;
    }
    const current = totals.get(match.key.id) ?? { attempts: 0, misses: 0 };
    current.attempts += stat.attempts;
    current.misses += stat.misses;
    totals.set(match.key.id, current);
  }

  const cells = new Map<string, KeyHeatCell>();
  for (const key of ALL_KEYS) {
    if (key.special) {
      // Backspace/Tab/CapsLock/Enter/Shift/Space は文字を持たない（打鍵ミス判定の対象外）
      // ため、ヒートマップの集計対象そのものから外す。
      continue;
    }
    const total = totals.get(key.id);
    const attempts = total?.attempts ?? 0;
    const misses = total?.misses ?? 0;
    cells.set(key.id, {
      keyId: key.id,
      attempts,
      misses,
      missRate: attempts > 0 ? misses / attempts : null,
    });
  }
  return cells;
}

/** ヒートマップの濃淡段階。数値以外の手掛かり（CSS クラス名）として使う。 */
export type HeatLevel = 'none' | 'low' | 'mid' | 'high' | 'severe';

/**
 * missRate を 5 段階に分類する。閾値は「ミスがほぼ無い(<5%)/たまにある(<15%)/
 * 目立つ(<30%)/多い(>=30%)」というざっくりした目安であり、design.md に具体的な
 * 閾値の指定は無いため実装者判断で定めた。null（未試行）は 'none'。
 */
export function classifyMissRate(missRate: number | null): HeatLevel {
  if (missRate === null) return 'none';
  if (missRate < 0.05) return 'low';
  if (missRate < 0.15) return 'mid';
  if (missRate < 0.3) return 'high';
  return 'severe';
}

/**
 * missRate をパーセント表示用の文字列にする。色以外の手掛かり（design.md §4:
 * 色だけに依存しない）としてセル内・aria-label 双方で使う。null（未試行）は '—'。
 */
export function formatMissRatePercent(missRate: number | null): string {
  if (missRate === null) return '—';
  return `${Math.round(missRate * 100)}%`;
}

/** ヒートマップ 1 キー分の aria-label（スクリーンリーダー向け。色を使わず値を読み上げる）。 */
export function buildHeatCellAriaLabel(label: string, cell: KeyHeatCell): string {
  if (cell.attempts === 0) {
    return `${label} キー: 記録なし`;
  }
  return `${label} キー: ミス率 ${formatMissRatePercent(cell.missRate)}、試行 ${cell.attempts} 回`;
}

// ---------- コンポーネント本体 ----------

export function StatsScreen({ appData, onBack }: StatsScreenProps) {
  const { sessions, aggregateKeyStats, totals, progress } = appData;

  const trend = buildSessionTrend(sessions);
  const kpmValues = buildKpmSeriesValues(trend);
  const accuracyValues = buildAccuracyPercentSeriesValues(trend);
  const heatmap = buildKeyHeatmap(aggregateKeyStats);
  const hasNoSessions = sessions.length === 0;

  return (
    <div className="stats">
      <header className="stats__header">
        <button type="button" className="stats__back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="stats__title">統計</h1>
      </header>

      {hasNoSessions && (
        <p className="stats__empty-banner">
          まだ記録がありません。練習を始めるとここに推移・ベスト記録・ヒートマップが表示されます。
        </p>
      )}

      <section className="stats__section" aria-label="打鍵推移">
        <h2 className="stats__section-title">推移（直近{trend.length}セッション・古い順）</h2>
        {trend.length === 0 ? (
          <p className="stats__section-empty">まだデータがありません。</p>
        ) : (
          <div className="stats__charts">
            <div className="stats__chart-block">
              <h3 className="stats__chart-title">KPM</h3>
              <Chart series={[{ label: 'KPM', values: kpmValues, color: 'var(--cursor)' }]} />
            </div>
            <div className="stats__chart-block">
              <h3 className="stats__chart-title">正確率（%）</h3>
              <Chart series={[{ label: '正確率', values: accuracyValues, color: 'var(--text-done)' }]} />
            </div>
          </div>
        )}
      </section>

      <section className="stats__section" aria-label="総合記録">
        <h2 className="stats__section-title">総合記録</h2>
        <div className="stats__totals">
          <div className="stats__total-item">
            総打鍵数 <strong>{formatKeystrokeCount(totals.totalKeystrokes)}</strong>
          </div>
          <div className="stats__total-item">
            総練習時間 <strong>{formatTotalTime(totals.totalTimeMs)}</strong>
          </div>
          <div className="stats__total-item">
            連続練習日数 <strong>{totals.streakDays}日</strong>
          </div>
        </div>
      </section>

      <section className="stats__section" aria-label="レベル別ベスト記録">
        <h2 className="stats__section-title">レベル別ベスト記録</h2>
        <p className="stats__section-caption">「—」は未プレイのレベルです。</p>
        <div className="stats__table-wrap">
          <table className="stats__level-table">
            <thead>
              <tr>
                <th scope="col">レベル</th>
                <th scope="col">ベスト正確率</th>
                <th scope="col">ベストKPM</th>
                <th scope="col">プレイ回数</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => {
                const levelProgress = progress[level.id];
                return (
                  <tr key={level.id}>
                    <td>
                      Lv{level.id} {level.name}
                    </td>
                    <td>{formatLevelBestAccuracy(levelProgress)}</td>
                    <td>{formatLevelBestKpm(levelProgress)}</td>
                    <td>{levelProgress.playCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stats__section" aria-label="キー別ヒートマップ">
        <h2 className="stats__section-title">キー別ヒートマップ（ミス率）</h2>
        <p className="stats__section-caption">
          色が濃いほどミス率が高いキーです。色に加えてキー内の数値（ミス率 %）でも確認できます。
          「—」は未試行のキーです（グレー・破線表示）。
        </p>
        <div className="stats__heatmap">
          {KEYBOARD_ROWS.map((row, rowIndex) => (
            <div className="stats__heatmap-row" key={rowIndex}>
              {row.map((key) => {
                if (key.special) {
                  // Backspace/Tab/CapsLock/Enter/Shift/Space はヒートマップ対象外だが、
                  // US 配列の見た目（行の幅比）を保つため空セルとして描画する。
                  return (
                    <div
                      key={key.id}
                      className="stats__heatmap-key stats__heatmap-key--special"
                      style={{ flexGrow: key.width ?? 1 }}
                      aria-hidden="true"
                    >
                      <span className="stats__heatmap-label">{key.label}</span>
                    </div>
                  );
                }

                const cell = heatmap.get(key.id);
                const missRate = cell?.missRate ?? null;
                const level = classifyMissRate(missRate);
                const valueText = cell ? formatMissRatePercent(cell.missRate) : '—';
                const ariaLabel = cell
                  ? buildHeatCellAriaLabel(key.label, cell)
                  : `${key.label} キー: 記録なし`;

                return (
                  <div
                    key={key.id}
                    className={`stats__heatmap-key stats__heatmap-key--${level}`}
                    style={{ flexGrow: key.width ?? 1 }}
                    title={ariaLabel}
                    aria-label={ariaLabel}
                  >
                    <span className="stats__heatmap-label">{key.label}</span>
                    <span className="stats__heatmap-value">{valueText}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
