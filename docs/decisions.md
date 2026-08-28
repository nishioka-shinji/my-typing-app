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

### 13. 効果音
**設定項目のみ用意し、音声再生ロジックは実装しない。**
- `Settings.soundEnabled` はデータモデル・設定画面のトグルとして存在させる（初期値 `false`）。
- 実際の再生処理は本エピックのスコープ外。トグルを ON にしても音は鳴らない。
- 設定画面のラベルに「（未実装）」等の注記を添え、ユーザーが壊れていると誤認しないようにすること。

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
**本エピックのスコープ外。** 設計書 §13-5 の結論どおり、Vercel 等への配置は行わない。`npm run build` が通ることのみ担保する。

---

## 全タスク共通の前提

- **Node は mise 管理**。シェルから npm/node を使う前に `export PATH="$HOME/.local/share/mise/shims:$PATH"` が必要（`mise.toml` で `node@24.19.0` に pin 済み）。素の `node` は PATH に存在しない。
- 想定バージョン: `vite@8` 系 / `react@19` 系 / `vitest@4` 系 / `typescript@~5.9`
- 設計書 §7.2 のディレクトリ構成に従う（`src/styles/theme.css` の扱いのみ上記 §3 で拡張）。
- 各タスクは完了前に `npm run lint` と `npm test` を通すこと。
