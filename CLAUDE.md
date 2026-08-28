# my-typing-app

タッチタイピング練習アプリ（1 人用・ローカル完結）。仕様は @docs/design.md、
**design.md からの意図的な差分は @docs/decisions.md**（食い違う箇所は decisions.md が優先）。

## 環境（最重要）

**Node は mise 管理で、素の `node` は PATH にない。** シェルで node/npm を使う前に必ず実行する:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
```

`node -v` が v24.19.0 になれば正常。これを忘れると `command not found: node` で全コマンドが失敗する。

## コマンド

| | |
|---|---|
| `npm run dev` / `build` / `preview` | Vite |
| `npm test` | Vitest（**watch なし**で終了する） |
| `npm run lint` | `eslint . --max-warnings 0` — **警告 1 件でも失敗**する |
| `npm run typecheck` | `tsc --noEmit` を 2 つの tsconfig で連続実行 |

変更後はこの 4 つを通すこと。

## このリポジトリ固有の制約

- **jsdom は未導入**（`vite.config.ts` は `environment: 'node'` 固定）。**React コンポーネントの
  レンダリングテストは書けない。** 判定・整形ロジックを純粋関数に切り出して単体テストし、
  見た目は `npm run dev` でブラウザ確認する。この分担が全画面で徹底されている。
- **`src/storage/schema.ts` は全モジュールが依存する共有型定義。** ここを変えると広範囲に波及する。
- **`src/styles/theme.css` はデザイントークン（CSS 変数）専用。** コンポーネント固有のスタイルは
  同居の `.css` に置き、クラス名を `.keyboard__key` のようにコンポーネント名で prefix する。
  CSS Modules は使わない。
- 依存は追加しない方針（グラフも SVG 自前描画）。状態管理ライブラリも入れない（`useReducer` + Context）。

## モジュールをまたぐ規約と既知の落とし穴

コードを読むだけでは分からない契約（`getTopWeakKeys` はノーミスでも 5 件返す、`passed` は
レベル解放の可否ではない、など）と、実装中に実際に踏んだ UI のバグパターンは
`/module-contracts` と `/ui-verification` にまとめてある。**engine・storage・hooks を変更するとき、
または UI を変更するときは先に読むこと。**
