import type { DrillItem } from '../storage/schema';

/**
 * Lv7（実践 Shell）・Lv8（実践 Git）用のコマンドプール。
 *
 * 除外基準 (00-decisions.md §12 を機械的に適用):
 *   - 破壊的削除・上書き: rm（全般）、mv による上書き、リダイレクトによる上書き（> file）、
 *     truncate
 *   - 権限昇格: sudo を含むもの
 *   - ネットワーク越しの副作用: curl ... | sh / wget ... | bash など
 *   - 取り返しのつかない Git 操作: git push --force、git reset --hard、git clean -fd、
 *     git branch -D
 *
 * 採用方向性: 読み取り系（ls/grep/find/cat/head/git log/git diff/git status）、
 * ローカル完結の編集（mkdir/touch/chmod +x）、ステージング／コミット操作
 * （git add/git commit -m/git switch -c/git stash）。
 *
 * 設計書 §3.1 の例示コマンド（ls -la / cd ../src / grep -rn "foo" . / chmod +x run.sh /
 * git commit -m "fix: typo" / git rebase -i HEAD~3 / git push origin HEAD）は必ず含める。
 *
 * 除外基準の機械的な検証は commands.test.ts の禁止パターン正規表現テストで行う。
 */

export const SHELL_COMMANDS: DrillItem[] = [
  { text: 'ls -la', hint: 'カレントディレクトリの全ファイルを詳細表示する' },
  { text: 'ls -la ../', hint: '親ディレクトリの全ファイルを詳細表示する' },
  { text: 'cd ../src', hint: '一つ上の src ディレクトリへ移動する' },
  { text: 'cd ~/projects', hint: 'ホーム配下の projects ディレクトリへ移動する' },
  { text: 'pwd', hint: '現在の作業ディレクトリのパスを表示する' },
  { text: 'grep -rn "foo" .', hint: 'カレント以下を再帰的に検索し foo を含む行番号を表示する' },
  { text: 'grep -rn "todo" src', hint: 'src 配下から todo を含む行を検索する' },
  { text: 'grep -ril "error" logs', hint: 'logs 配下から error を含むファイル名だけを表示する' },
  { text: 'find . -name "*.ts"', hint: 'カレント以下から拡張子 ts のファイルを探す' },
  { text: 'find . -type d -name "test"', hint: 'カレント以下から test という名前のディレクトリを探す' },
  { text: 'cat package.json', hint: 'package.json の内容を表示する' },
  { text: 'cat -n notes.txt', hint: 'notes.txt を行番号付きで表示する' },
  { text: 'head -n 20 access.log', hint: 'access.log の先頭 20 行を表示する' },
  { text: 'tail -n 50 error.log', hint: 'error.log の末尾 50 行を表示する' },
  { text: 'tail -f server.log', hint: 'server.log への追記をリアルタイムで追跡する' },
  { text: 'less docs/design.md', hint: 'docs/design.md をページ送りで閲覧する' },
  { text: 'wc -l src/index.ts', hint: 'src/index.ts の行数を数える' },
  { text: 'diff old.txt new.txt', hint: '2 つのファイルの差分を表示する' },
  { text: 'mkdir -p src/utils', hint: 'src/utils ディレクトリを再帰的に作成する' },
  { text: 'touch .env.local', hint: '空の .env.local ファイルを作成する' },
  { text: 'chmod +x run.sh', hint: 'run.sh に実行権限を付与する' },
  { text: 'chmod 644 config.yml', hint: 'config.yml の権限を 644 に設定する' },
  { text: 'cp .env.example .env', hint: 'サンプル設定ファイルを実際の設定ファイルとしてコピーする' },
  { text: 'cp -r dist backup', hint: 'dist ディレクトリを backup へ再帰的にコピーする' },
  { text: 'which node', hint: 'node コマンドの実行パスを表示する' },
  { text: 'whoami', hint: '現在ログイン中のユーザー名を表示する' },
  { text: 'ps aux', hint: '実行中の全プロセスを一覧表示する' },
  { text: 'top -l 1', hint: '現在のシステム負荷を 1 回だけ表示する' },
  { text: 'df -h', hint: 'ディスクの空き容量を人間が読みやすい形式で表示する' },
  { text: 'du -sh node_modules', hint: 'node_modules ディレクトリの合計サイズを表示する' },
  { text: 'env', hint: '現在の環境変数を一覧表示する' },
  { text: 'uname -a', hint: 'OS の種類やカーネル情報を表示する' },
  { text: 'history | tail -20', hint: '直近 20 件のコマンド履歴を表示する' },
  { text: 'man grep', hint: 'grep コマンドのマニュアルを表示する' },
  { text: 'sort access.log | uniq -c', hint: 'access.log を集計してユニークな行の出現回数を数える' },
];

export const GIT_COMMANDS: DrillItem[] = [
  { text: 'git status', hint: '作業ツリーとステージの状態を確認する' },
  { text: 'git status -s', hint: '状態を短縮形式で確認する' },
  { text: 'git log', hint: 'コミット履歴を表示する' },
  { text: 'git log --oneline', hint: 'コミット履歴を 1 行ずつ簡潔に表示する' },
  { text: 'git log --oneline -10', hint: '直近 10 件のコミット履歴を表示する' },
  { text: 'git log --graph --oneline', hint: 'ブランチの分岐をグラフ付きで表示する' },
  { text: 'git diff', hint: '未ステージの変更差分を表示する' },
  { text: 'git diff --staged', hint: 'ステージ済みの変更差分を表示する' },
  { text: 'git diff HEAD~1', hint: '直前のコミットとの差分を表示する' },
  { text: 'git show HEAD', hint: '直近のコミット内容を表示する' },
  { text: 'git show --stat HEAD', hint: '直近コミットの変更統計を表示する' },
  { text: 'git blame src/index.ts', hint: 'src/index.ts の各行の変更者を表示する' },
  { text: 'git branch', hint: 'ローカルブランチの一覧を表示する' },
  { text: 'git branch -a', hint: 'リモート含む全ブランチを表示する' },
  { text: 'git switch -c feature/login', hint: 'feature/login ブランチを新規作成して切り替える' },
  { text: 'git switch main', hint: 'main ブランチに切り替える' },
  { text: 'git checkout -b hotfix/bug123', hint: 'hotfix/bug123 ブランチを新規作成して切り替える' },
  { text: 'git add .', hint: '変更を全てステージに追加する' },
  { text: 'git add src/index.ts', hint: '指定したファイルをステージに追加する' },
  { text: 'git add -p', hint: '変更内容を対話的に選んでステージに追加する' },
  { text: 'git commit -m "fix: typo"', hint: '「fix: typo」というメッセージでコミットする' },
  { text: 'git commit -am "update deps"', hint: '変更済みファイルをまとめてコミットする' },
  { text: 'git commit --amend --no-edit', hint: '直前のコミットにメッセージを変えず追加変更を反映する' },
  { text: 'git stash', hint: '作業中の変更を一時退避する' },
  { text: 'git stash list', hint: '退避した変更の一覧を表示する' },
  { text: 'git stash pop', hint: '退避した変更を元の状態に戻す' },
  { text: 'git fetch', hint: 'リモートの最新情報を取得する' },
  { text: 'git fetch origin', hint: 'origin リモートの最新情報を取得する' },
  { text: 'git pull', hint: 'リモートの変更を取得してマージする' },
  { text: 'git pull --rebase', hint: 'リモートの変更をリベースで取り込む' },
  { text: 'git rebase -i HEAD~3', hint: '直近 3 件のコミットを対話的に整理する' },
  { text: 'git merge feature/login', hint: 'feature/login ブランチを現在のブランチにマージする' },
  { text: 'git push origin HEAD', hint: '現在のブランチをそのままリモートへ push する' },
  { text: 'git push -u origin feature/login', hint: 'feature/login をリモートへ追跡設定つきで push する' },
  { text: 'git tag v1.0.0', hint: 'v1.0.0 というタグを付ける' },
  { text: 'git remote -v', hint: '登録済みリモートの一覧を表示する' },
  { text: 'git cherry-pick abc1234', hint: '指定したコミットを現在のブランチに取り込む' },
  { text: 'git config --list', hint: 'git の設定一覧を表示する' },
];
