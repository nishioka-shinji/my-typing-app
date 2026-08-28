/**
 * アプリのルート。AppDataProvider（t10）をマウントし、5 画面
 * （Home / Practice / Result / Stats / Settings）を `useState<ScreenName>` による
 * 状態ベースのルーティングで結線する（ルータライブラリは導入しない）。
 *
 * このファイルは新規ロジックを書かず、既存モジュール（各画面・engine・data・hooks）の
 * 結線と最小限の受け渡しに留める方針（01-tasks.json t18 の description）。
 * ただし「もう一度」「次のレベルへ」用の PracticeRequest 再構築だけは、
 * HomeScreen（t13, files_owned=t13 のため編集不可）が同種のロジックを
 * 非 export のコンポーネント内関数として持っているため、やむを得ず本ファイルに
 * 同等のロジックを重複して持つ（HomeScreen が export している純粋関数
 * getUnlockedCharsetUnion / getWeaknessPassCriteria / getWeaknessStatus は再利用する）。
 *
 * 各画面 props 契約の参照元（結線前に必読、すべてレビューで確定済み）:
 *   - tasks/t16/review-r1.md（PracticeScreen。missSeq 単調性のための key 再マウント契約）
 *   - tasks/t13/review-r1.md（HomeScreen）/ t14（SettingsScreen）/ t15（ResultScreen）/
 *     t17（StatsScreen）
 *   - CROSS-CUTTING.md §4〜§7（saveStatus バナー・sticky 判断・onResetAll 二重確認禁止 等）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppData,
  LevelDef,
  LevelId,
  PracticeRequest,
  ScreenName,
  SessionResult,
  SessionSummary,
} from './storage/schema';
import type { SaveAppDataResult } from './storage/storage';
import { AppDataProvider, useAppData } from './hooks/useAppData';
import { getLevel } from './data/levels';
import { generateItems, generateWeaknessItems } from './engine/generator';
import { resolveGuideMode } from './engine/guideMode';
import { WEAKNESS_TRAINING_QUESTION_COUNT } from './engine/weakness';
import {
  HomeScreen,
  getUnlockedCharsetUnion,
  getWeaknessPassCriteria,
  getWeaknessStatus,
} from './screens/HomeScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import './App.css';

/**
 * 完了したセッションを次の画面へ渡すために保持する内部状態。
 * `SessionResult`（schema.ts）に加え、「次のレベルへ」ボタンを出すかどうかの
 * 判定に使う `nextLevelId` を一緒に保持する（ResultScreen 自体は次レベルの
 * 存在を知らないため、呼び出し側=t18 が判断する契約: t15 review-r1.md 参照）。
 */
interface PendingResult {
  result: SessionResult;
  nextLevelId: LevelId | null;
}

/** レベルセッション用の PracticeRequest を組み立てる（HomeScreen.handleStartLevel と同等）。 */
function buildLevelRequest(level: LevelDef, appData: AppData): PracticeRequest {
  const items = generateItems(level, { questionCount: appData.settings.questionCount });
  const guideMode = resolveGuideMode(appData.settings, level.defaultGuideMode);
  return {
    kind: 'level',
    levelId: level.id,
    title: `Lv${level.id} ${level.name}`,
    items,
    passAccuracy: level.passAccuracy,
    passKpm: level.passKpm,
    guideMode,
  };
}

/** 弱点特訓セッション用の PracticeRequest を組み立てる（HomeScreen.handleStartWeakness と同等）。 */
function buildWeaknessRequest(appData: AppData): PracticeRequest {
  const status = getWeaknessStatus(appData.sessions);
  const keys = status.kind === 'ready' ? status.keys : [];
  const charset = getUnlockedCharsetUnion(appData.progress);
  const items = generateWeaknessItems(keys, charset, {
    questionCount: WEAKNESS_TRAINING_QUESTION_COUNT,
  });
  const criteria = getWeaknessPassCriteria(appData.progress);
  const guideMode = resolveGuideMode(appData.settings, 'onMiss');
  return {
    kind: 'weakness',
    levelId: 'weakness',
    title: '弱点特訓',
    items,
    passAccuracy: criteria.passAccuracy,
    passKpm: criteria.passKpm,
    guideMode,
  };
}

/**
 * 次レベルへのボタンを出すべきかを判定する。
 *
 * `unlockedLevelId`（recordSession の戻り値）は「今回のセッションで新規に解放されたか」
 * を示すだけで「次のレベルが存在し選択可能か」ではない（t15 review-r1.md の指摘）。
 * 既にクリア済みのレベルを再挑戦した場合、次レベルは以前から解放済みで
 * `unlockedLevelId` は null のままになるため、`appDataBefore.progress` の
 * unlocked 状態も合わせて見る。
 */
function computeNextLevelId(
  levelId: LevelId | 'weakness',
  appDataBefore: AppData,
  unlockedLevelId: LevelId | null,
): LevelId | null {
  if (levelId === 'weakness' || levelId >= 8) {
    return null;
  }
  const nextId = (levelId + 1) as LevelId;
  const alreadyUnlocked = appDataBefore.progress[nextId]?.unlocked ?? false;
  return alreadyUnlocked || unlockedLevelId === nextId ? nextId : null;
}

/**
 * `saveStatus` の重大度を比較する（sticky バナー用）。'failed' > 'degraded' > 'ok'。
 * データ損失の可能性がある異常のうち、より深刻な方向にのみ状態を進める。
 */
function severity(status: SaveAppDataResult): number {
  if (status === 'failed') return 2;
  if (status === 'degraded') return 1;
  return 0;
}

/**
 * 保存状態の全画面共通バナー（CROSS-CUTTING §5）。
 *
 * - `saveStatus === 'ok'` のときは何も描画しない（t14 設定画面パネルとの二重表示を防ぐ）。
 * - `role="status"`（polite）を使う。t14 のパネルは `role="alert"` を使っているため、
 *   同じ内容を `alert` で重ねると二重読み上げになる（CROSS-CUTTING §7）。
 * - sticky: 一度 'degraded' / 'failed' になったら、後続の保存が 'ok' に戻っても
 *   警告を表示し続ける（§7 の判断: 直近の保存結果だけを見ると、設定変更などで
 *   再保存が走った瞬間に警告が消え、データ損失を二度と知る手段がなくなるため）。
 *   ユーザーが「閉じる」を押すと、その時点の重大度までは消せるが、
 *   それより深刻な状態（degraded → failed）に悪化した場合は再表示する。
 */
function SaveStatusBanner({ status }: { status: SaveAppDataResult }) {
  const [worst, setWorst] = useState<SaveAppDataResult>(status);
  const [dismissedLevel, setDismissedLevel] = useState(0);

  useEffect(() => {
    setWorst((prev) => (severity(status) > severity(prev) ? status : prev));
  }, [status]);

  if (worst === 'ok' || severity(worst) <= dismissedLevel) {
    return null;
  }

  const message =
    worst === 'failed'
      ? '記録を保存できませんでした。ブラウザの設定（プライベートモード等）を確認してください（詳細: 設定 > データ管理）。'
      : '保存容量の上限を超え、古い練習記録が一部削除されました（詳細: 設定 > データ管理）。';

  return (
    <div className="app__save-banner" role="status">
      <span className="app__save-banner-text">{message}</span>
      <button
        type="button"
        className="app__save-banner-dismiss"
        onClick={() => setDismissedLevel(severity(worst))}
        aria-label="この警告を閉じる"
      >
        閉じる
      </button>
    </div>
  );
}

function AppShell() {
  const { appData, saveStatus, updateSettings, recordSession, resetAll } = useAppData();
  const [screen, setScreen] = useState<ScreenName>('home');
  const [practiceRequest, setPracticeRequest] = useState<PracticeRequest | null>(null);
  const [pendingResult, setPendingResult] = useState<PendingResult | null>(null);
  // セッションを開始し直すたびに変える。PracticeScreen を強制的に作り直すことで
  // missSeq（missCount）の単調性を保証する（t16 review-r1.md の確定契約。同じ key の
  // まま request だけを差し替えると items が更新されず onFinish も二度と発火しない）。
  const sessionKeyRef = useRef(0);

  const startPractice = useCallback((request: PracticeRequest) => {
    sessionKeyRef.current += 1;
    setPracticeRequest(request);
    setScreen('practice');
  }, []);

  const handleStart = useCallback(
    (request: PracticeRequest) => {
      // HomeScreen が生成済みの PracticeRequest をそのまま流す。ここで再生成しない
      // （t13 review-r1.md の契約: 再生成すると出題内容が別物になる）。
      startPractice(request);
    },
    [startPractice],
  );

  const handleNavigate = useCallback((target: ScreenName) => {
    setScreen(target);
  }, []);

  const handleFinish = useCallback(
    (summary: SessionSummary) => {
      if (!practiceRequest) {
        return;
      }
      const appDataBefore = appData;
      const { record, unlockedLevelId } = recordSession(summary);
      const nextLevelId = computeNextLevelId(practiceRequest.levelId, appDataBefore, unlockedLevelId);
      const result: SessionResult = {
        record,
        passAccuracy: practiceRequest.passAccuracy,
        passKpm: practiceRequest.passKpm,
        wpm: summary.wpm,
        unlockedLevelId,
        levelTitle: practiceRequest.title,
      };
      setPendingResult({ result, nextLevelId });
      setScreen('result');
    },
    [appData, practiceRequest, recordSession],
  );

  const handleQuit = useCallback(() => {
    // Escape で中断: PracticeScreen の契約どおり記録を残さずホームへ戻る
    // （onQuit は「記録を残さず中断」。t16 review-r1.md/report-r2.md 参照）。
    setPracticeRequest(null);
    setScreen('home');
  }, []);

  const handleRetry = useCallback(() => {
    if (!pendingResult) {
      return;
    }
    const { levelId } = pendingResult.result.record;
    const request =
      levelId === 'weakness' ? buildWeaknessRequest(appData) : buildLevelRequest(getLevel(levelId), appData);
    startPractice(request);
  }, [appData, pendingResult, startPractice]);

  const handleNextLevel = useCallback(() => {
    if (!pendingResult?.nextLevelId) {
      return;
    }
    const request = buildLevelRequest(getLevel(pendingResult.nextLevelId), appData);
    startPractice(request);
  }, [appData, pendingResult, startPractice]);

  const handleResultHome = useCallback(() => {
    setPendingResult(null);
    setScreen('home');
  }, []);

  const handleSettingsBack = useCallback(() => {
    setScreen('home');
  }, []);

  const handleResetAll = useCallback(() => {
    // t14 側で確認 UI 済み（削除する押下後にのみ呼ばれる）。ここで追加の確認ダイアログを
    // 挟むと二重確認になるため挟まない（CROSS-CUTTING §5 / t14 review-r1.md の契約）。
    resetAll();
    setScreen('home');
  }, [resetAll]);

  const onNextLevel = useMemo(
    () => (pendingResult?.nextLevelId ? handleNextLevel : null),
    [pendingResult, handleNextLevel],
  );

  return (
    <div className="app">
      <SaveStatusBanner status={saveStatus} />
      {screen === 'home' && <HomeScreen appData={appData} onStart={handleStart} onNavigate={handleNavigate} />}
      {screen === 'practice' && practiceRequest && (
        <PracticeScreen
          key={sessionKeyRef.current}
          request={practiceRequest}
          settings={appData.settings}
          onFinish={handleFinish}
          onQuit={handleQuit}
        />
      )}
      {screen === 'result' && pendingResult && (
        <ResultScreen
          result={pendingResult.result}
          onRetry={handleRetry}
          onNextLevel={onNextLevel}
          onHome={handleResultHome}
        />
      )}
      {screen === 'stats' && <StatsScreen appData={appData} onBack={handleSettingsBack} />}
      {screen === 'settings' && (
        <SettingsScreen
          settings={appData.settings}
          onChange={updateSettings}
          onResetAll={handleResetAll}
          onBack={handleSettingsBack}
          saveStatus={saveStatus}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <AppDataProvider>
      <AppShell />
    </AppDataProvider>
  );
}

export default App;
