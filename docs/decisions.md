# 実装上の決定事項 — design.md からの意図的な差分

`docs/design.md` は実装前のドラフトであり、実装時に **14 件の未確定事項・仕様矛盾**が見つかった。
本書はその決定と根拠の記録である。**design.md と本書が食い違う箇所では本書が優先する。**

決定日: 2026-08-27 / 決定者: ユーザー（4件）＋メインセッション判断（10件、いずれもレポートの推奨案を採用）

## ユーザー確認済み

### 1. TypeScript バージョン / 2. Lint 導入
**TypeScript 5.9 系 + ESLint 最小構成**を採用する。
- `typescript@~5.9`（TS7 は Compiler API 非公開のため不採用）
- `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks` の最小構成
- 理由: `react-hooks` ルールで useEffect 依存漏れ等を早期検知したい。16ms レイテンシ要件・キーイベント購読の不具合防止に直結する。
- `npm run lint` スクリプトを用意し、各 task-implementer は完了前に lint と test を通すこと。

### 4. Lv3 の charset / 5. `[ ] \ '` の配置
**Lv3 に `, . /` を含め、Lv5 に `[ ] \ '` を追加する。**
- Lv3 charset = 英字 26 文字すべて（ホーム段＋上段＋下段）＋ `,` `.` `/`
  - 設計書 §3.1 の「出題内容: 全英字ランダム」は表記ミスと判断し、「これまでの全習得キー＋下段記号からランダム」と解釈する。
- Lv5 charset = `0-9` `-` `=` `/` `.` `,` `;` に加えて `[` `]` `\` `'` を追加
  - 理由: いずれも Shift 不要の基本記号。`'...'` クオートと `\` エスケープは Lv7/Lv8 のコマンドで頻出するため、到達前に単独練習を必ず 1 回踏ませる。
- Lv6 の記号一覧は設計書 §3.1 のまま（Shift 系のみ）で変更しない。

### 9. `durationMs` の計測起点
**セッション内の最初の有効打鍵（KEY_PRESS）時刻から計測する。**
- `TypingState.startedAt` は初期値 `null`（または `0`）とし、初回 KEY_PRESS 受信時に確定させる。型定義を `startedAt: number | null` とする。
- 終了点はセッション最終問題の最終確定打鍵時刻。
- 理由: 問題文を読む準備時間を KPM の分母から除外し、Lv7/Lv8 の長いコマンドで不利にならないようにする。
- `startedAt` が `null` のまま（＝1打鍵もしていない）でセッションを終えた場合、KPM は 0 とし、ゼロ除算を発生させないこと。

### 13. 効果音（2026-08-28 更新: always-on-sound エピックによりトグル廃止・常時再生に変更）
**Web Audio API による音声合成で実装済み。音声ファイルは持たない。効果音は常に鳴り、ON/OFF の選択肢は無い。**
- `Settings.soundEnabled` は**データモデルから削除済み**。設定画面にも効果音のトグルは存在しない。
- 鳴らす場面は**正解打鍵とミス打鍵の 2 種類のみ**（変更なし）。セッション合格・不合格音、レベル解放音は鳴らさない。
- 音量調整 UI は無く、実装側の固定値（控えめな gain）で再生する（変更なし）。
- 実装箇所: `src/engine/soundParams.ts`（イベント種別→音パラメータの純粋関数、変更なし）、
  `src/hooks/useSoundEffects.ts`（AudioContext 生成・再生。`useSoundEffects()` は**引数を取らず**
  `(kind: SoundKind) => void` を返す。ON/OFF 判定が無くなっただけで、AudioContext の module singleton /
  lazy 生成という仕組み自体は変わらない）、`src/screens/PracticeScreen.tsx`（打鍵ハンドラからの呼び出し）。

**廃止の理由**: Cloudflare Pages への公開後、「効果音が鳴らない」という体験が生じた。原因はバグではなく、
(1) `Settings.soundEnabled` の初期値が `false` だったことと、(2) `localStorage` はオリジン単位で保存されるため、
ローカル開発環境（`localhost`）で ON にしていた設定がデプロイ先（`*.pages.dev`）には引き継がれず、
初期値 `false` のまま再生されなかったこと、の組み合わせによる。バグではなかったが、ユーザー判断でトグル自体を
廃止し、常時再生に変更することで根本解消した（決定日 2026-08-28）。

**既知の懸念**: アプリ内のミュート手段が完全に無くなる。職場・図書館・カフェ等の静かな環境で使う場合、
ブラウザのタブミュート等、アプリ外の手段に頼るしかない。将来 UI でのミュート機能を再検討する場合はこの節を参照すること。

過去の決定記録として `.claude/epics/sound-effects/00-decisions.md`（AudioContext の module singleton /
lazy 生成、音のキャラクター、テストの線引きなどの実装詳細）も参照できるが、`soundEnabled` に関する記述は
本節（2026-08-28 更新分）で上書きされている。

---

## メインセッション判断（レポート推奨案をそのまま採用）

### 3. CSS 構成方式
**`src/styles/theme.css` はデザイントークン（CSS 変数）専用とし、コンポーネント／画面は個別の同居 `.css` ファイルを持つ。**
- 理由: 単一 CSS だと並列実装タスクが全部同じファイルを編集して衝突する。
- `theme.css` は設計書 §10.1 のカラートークン＋タイポグラフィ変数＋共通リセットのみ。**このファイルは初期スキャフォールドタスクで確定させ、以後は原則追記のみ**とする。
- コンポーネント側は `Keyboard.tsx` + `Keyboard.css` のように同ディレクトリに配置し、クラス名は `.keyboard__key` のようにコンポーネント名を prefix して衝突を避ける（CSS Modules は導入しない＝設定を増やさない）。

### 6. `guideMode: 'auto'` の解決順序
**`'auto'` は「ユーザー未選択」を意味する sentinel 値として扱う。**
- `Settings.guideMode === 'auto'` → 実効値は `LevelDef.defaultGuideMode`（レベル連動）
- ユーザーが `'always' | 'onMiss' | 'never'` を明示選択 → 以後どのレベルでもその値を優先（レベル遷移で上書きしない）
- 設定画面には「レベル連動（自動）」を選択肢として提示し、それが `'auto'` に対応する。
- 解決ロジックは純粋関数として切り出し（例: `resolveGuideMode(settings, levelDef): GuideMode`）、単体テスト対象にする。

### 7. 弱点分析の減衰重みとデータモデルの整合
**弱点分析は `AppData.sessions`（直近 20 件）を都度走査して重み付き再集計する。`aggregateKeyStats` は弱点分析に使わない。**
- 重み: 新しい順に 1〜5 件目 = 1.0、6〜20 件目 = 0.5
- 各 `SessionRecord.keyStats` から `missRate(k)` / 平均 `latency(k)` を重み付きで再計算する。
- `aggregateKeyStats`（全期間累積・無重み）は **統計画面のキー別ヒートマップ表示専用**とし、役割を分離する。
- 試行回数（重み付き `attempts` 合計）5 回未満のキーは弱点判定から除外する（設計書 §3.6 準拠）。

### 8. 「生ログ」概念
**実装しない。**
- 設計書 §4 の「生ログは直近 5 セッション分に限定」という記述は、対応する型が §6 のデータモデルに存在しないため、本リリースでは見送りと解釈する。
- `SessionRecord`（集計済み `keyStats` を持つ）を直近 20 件保持する設計のみとし、これで `weakScore` の latency 成分は算出可能。

### 10. `lastKeyAt` と latency 統計
**各問題の 1 文字目は `totalLatencyMs` に加算しない（`attempts` には加算する）。**
- 理由: 問題切り替え直後の 1 打鍵目には「次の問題文を読む時間」が混入し、latency 統計を一様に押し上げて弱点スコアの信頼性を下げる。
- reducer 側で「その問題で初めての打鍵か（`cursor === 0` かつ未ミス、あるいは `lastKeyAt === null`）」を判定して分岐する。
- ミスの場合も同様に、その問題の 1 文字目の試行では latency を加算しない。

### 11. Lv4 英単語リスト
**一般的な基礎英単語 300 語程度を自前で用意し `src/data/words.ts` にハードコードする。**
- 選定基準（実装者はこれを機械的に適用すること）:
  - すべて小文字の a-z のみ。記号・数字・大文字・アクセント記号を含まない
  - 長さ 3〜8 文字
  - 一般的な基礎語彙（例: `file`, `data`, `code`, `make`, `have`, `open`, `list`, `time`）
  - 除外: 固有名詞、専門用語、スラング、攻撃的・差別的語彙、著作権のあるコーパスからの逐語コピー
- 重複なし。アルファベット順またはカテゴリ順に整理し、可読性を保つ。

### 12. Lv7/Lv8 コマンド集
**Lv7（Shell）・Lv8（Git）それぞれ 30〜40 件のプールを用意する。** 各件に設計書 §6 の `DrillItem.hint`（日本語 1 行の意味説明）を必ず付ける。
- `fixedList` ジェネレータはプールをシャッフルして先頭 `questionCount` 件を使うため、プールが問題数（20）より十分多いことが反復練習の飽き防止に必要。
- **除外基準**（実装者はこれを機械的に適用すること）:
  - 破壊的削除・上書き: `rm`（全般）、`mv` による上書き、`> file` によるリダイレクト上書き、`truncate`
  - 権限昇格: `sudo` を含むもの
  - ネットワーク越しの副作用: `curl ... | sh`、`wget ... | bash` など
  - 取り返しのつかない Git 操作: `git push --force`、`git reset --hard`、`git clean -fd`、`git branch -D`
- 採用してよい方向性: 読み取り系（`ls`, `grep`, `find`, `cat`, `head`, `git log`, `git diff`, `git status`）、ローカル完結の編集（`mkdir`, `touch`, `chmod +x`）、ステージング／コミット操作（`git add`, `git commit -m`, `git switch -c`, `git stash`）。
- 設計書 §3.1 の例示（`ls -la`, `cd ../src`, `grep -rn "foo" .`, `chmod +x run.sh`, `git commit -m "fix: typo"`, `git rebase -i HEAD~3`, `git push origin HEAD`）は必ずプールに含める。

### 14. デプロイ・公開
**Cloudflare Workers（Static Assets）に静的サイトとして公開する。**（2026-08-28 に方針変更。当初は
設計書 §13-5 の結論どおり本エピックのスコープ外としていた。同日、Pages ではなく Workers を使う
形に再修正した — Cloudflare は新規プロジェクトを Workers に一本化しており、ダッシュボードの
作成フローも Workers Builds に統合されているため）

- 成立根拠: 外部通信（`fetch` / 外部 URL）・環境変数参照が一切なく、永続化は `localStorage` のみ。
  ルータライブラリを使わず `App.tsx` の `useState<ScreenName>` による状態ルーティングのため、
  URL が `/` から変化せず **SPA fallback（`assets.not_found_handling` の設定）は不要**。
- **リポジトリ直下の `wrangler.jsonc` が唯一のデプロイ設定。** `main`（Worker スクリプト）を持たない
  アセット専用 Worker として `assets.directory: "./dist"` のみを指定する。
  **`name`（`my-typing-app`）は Cloudflare ダッシュボードのプロジェクト名と一致していなければ
  ビルドが失敗する。**
- Workers Builds の設定: Build command = `npm run build` / Deploy command = `npx wrangler deploy` /
  非本番ブランチの Deploy command = `npx wrangler versions upload`（空ならこの既定値）/
  Root directory（パス）= `/`。`npm run build` は `typecheck` を含むため型エラーもビルドで検出される。
- **Node のバージョン固定にリポジトリ直下の `.node-version`（`24.19.0`）を使う。**
  Cloudflare は `mise.toml` を読まないため、これが無いと既定の古い Node が使われ
  Vite 8（Node 20.19+ を要求）のビルドが失敗する。`mise.toml` と値を揃えて維持すること。
- サブパス配信（`example.com/typing/` 等）にする場合のみ `vite.config.ts` に `base` の指定が必要。
  `*.workers.dev` のルート配信では不要。
- バックエンドを持たないため、公開しても記録は各ブラウザの `localStorage` に留まり、
  端末間で共有・同期されない点は変わらない。

---

## 全タスク共通の前提

- **Node は mise 管理**。シェルから npm/node を使う前に `export PATH="$HOME/.local/share/mise/shims:$PATH"` が必要（`mise.toml` で `node@24.19.0` に pin 済み）。素の `node` は PATH に存在しない。
- 想定バージョン: `vite@8` 系 / `react@19` 系 / `vitest@4` 系 / `typescript@~5.9`
- 設計書 §7.2 のディレクトリ構成に従う（`src/styles/theme.css` の扱いのみ上記 §3 で拡張）。
- 各タスクは完了前に `npm run lint` と `npm test` を通すこと。
