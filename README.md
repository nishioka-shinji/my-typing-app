# my-typing-app

ブラウザだけで動くタイピング練習アプリ（React 19 + TypeScript + Vite）。
仕様の詳細は [`docs/design.md`](docs/design.md) を、実装方針の最終決定は
[`.claude/epics/typing-app/00-decisions.md`](.claude/epics/typing-app/00-decisions.md) を参照。
design.md と decisions.md が食い違う場合は decisions.md を優先する。

## セットアップ

Node は [mise](https://mise.jdx.dev/) で管理している（`mise.toml` で `node@24.19.0` に pin）。
シェルで `npm` / `node` を使う前に、mise の shim を PATH に通す。

```sh
export PATH="$HOME/.local/share/mise/shims:$PATH"
npm ci
```

## 開発

```sh
npm run dev        # 開発サーバー起動（http://localhost:5173 など）
npm run build       # 型チェック込みの本番ビルド（tsc --noEmit && vite build）
npm run preview     # ビルド成果物のプレビュー
```

## 検証

```sh
npm test            # vitest run（DOM テストは行わず、純粋関数のみをユニットテスト）
npm run test:watch  # vitest（watch モード）
npm run lint         # eslint .（--max-warnings 0。警告も失敗扱い）
npm run typecheck    # tsc --noEmit（src 用 / vite.config.ts 用の 2 つの tsconfig）
```

デプロイ・公開は本エピックのスコープ外（DECISIONS §14）。`npm run build` が
エラーなく完了することのみを担保する。

## データの永続化

すべてのデータは `localStorage` の単一キー `my-typing-app:v1` に保存される
（`src/storage/schema.ts` / `src/storage/storage.ts`）。壊れたデータ・スキーマ
不一致・容量超過のいずれでもクラッシュせず初期値にフォールバックし、復旧不能な
旧データは `my-typing-app:v1:backup` へ退避する（design.md §6.1）。

設定画面の「全データをリセット」から、保存データを初期状態に戻せる。
