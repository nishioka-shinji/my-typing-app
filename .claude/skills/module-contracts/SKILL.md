---
name: module-contracts
description: my-typing-app のモジュール間契約。engine / storage / hooks / data を変更するとき、または画面から呼ぶときに読む。コードを読むだけでは分からず、破ると静かに壊れる約束事（弱点キーの件数、レベル解放条件、sessions の並び順、Chart の系列、状態更新の同時実行）をまとめている。
when_to_use: src/engine, src/storage, src/hooks, src/data のいずれかを編集する / 画面からこれらを呼び出す / セッション記録やレベル解放の挙動を変える
---

各項目は**実装中に実際に壊れた（またはレビューで指摘された）もの**だけを載せている。

## 弱点分析

- **`getTopWeakKeys(sessions)` は相対順位でしか判定しないため、ノーミスのユーザーでも必ず 5 件返す。**
  「弱点なし」の判定は呼び出し側の責務。`computeWeakScores` の生スコアが全件 0 かを見て
  `no-data` / `no-weakness` / `ready` を分けること（`HomeScreen.tsx` が実装例）。
  これを怠ると初回起動のユーザーに「a s d f j が苦手です」と誤表示する。
- **弱点分析は `AppData.sessions` を重み付き再集計する**（直近 5 件 = 1.0、6〜20 件目 = 0.5）。
  `aggregateKeyStats` は**全期間累積・無重みで、統計画面のヒートマップ専用**。混同しないこと。
  `weakness.ts` は `aggregateKeyStats` を import してはいけない（静的テストで強制している）。
- 「ミスの多かったキー」を出すなら `topMissKeys`（metrics.ts）を使う。`getTopWeakKeys` を使うと
  ミス 0 のキーが苦手として並ぶ。

## レベル解放

- **`summarizeSession` の `passed` は「指標上の合否」であって「レベル解放の可否」ではない。**
  弱点特訓（`levelId === 'weakness'`）は design.md §3.6 によりレベル解放に影響しない。
  `passed` を無条件に解放条件へ使わず、必ず `levelId` で分岐する。
- 一度解放したレベルは以後ロックし直さない。Lv8 合格時は「次のレベル」が存在しないので
  クラッシュしないこと。
- 「次のレベルへ」ボタンの表示可否を `unlockedLevelId !== null` で判定してはいけない。
  **クリア済みレベルを再合格すると `unlockedLevelId` は `null` になる**ため、
  復習したユーザーが先に進めなくなる。実際の解放状態を見ること。

## storage / AppData

- **`sessions` は index 0 が最新。** 追加は先頭 `unshift`。逆にすると古い記録が残って新しい方が消える。
- `loadAppData` / `saveAppData` / `resetAppData` は**いずれも例外を投げない。** 呼び出し側の
  try/catch は不要。
- **`saveAppData` の戻り値 `SaveAppDataResult` を握りつぶさないこと。**
  `'degraded'` は容量超過で sessions が直近 5 件まで削られた状態（**データ損失あり**）、
  `'failed'` は保存できなかった状態。context の `saveStatus` として公開され、
  `App.tsx` の全画面バナーと設定画面が表示している。
- `saveStatus` は「直近の保存結果」でしかない。再保存が走ると `'ok'` に戻るため、
  通知は sticky にしないと一度見逃したら二度と出ない（`App.tsx` で sticky 化済み）。

## 状態更新

- **`recordSession` と `updateSettings` を同一 tick で呼んではいけない。**
  どちらも AppData 全体を書き戻すため、後勝ちで設定変更がサイレントに消える。

## 問題生成

- `generateItems` / `generateWeaknessItems` は **rng を外部注入できる**（既定 `Math.random`）。
  テストでは決定的な rng を渡すこと。`Math.random` を直接呼ぶ実装を足さないこと。
- `generateWeaknessItems` に渡す `charset` は **解放済みレベルの charset の和集合**にする。
  そうしないと未解放レベルの記号が特訓に出る。
- charset が 1 文字のとき「同一文字 3 連続を避ける」制約は原理的に満たせない。
  `pickChar` は候補が空なら制約を諦める実装で、無限ループしない。ここを「厳密化」しないこと。

## キー入力（useKeyboardInput / keyEventPolicy）

- **`typingReducer` は `key.length !== 1` しか見ない。** `Ctrl+A` は `event.key === 'a'` として
  正打鍵扱いで通ってしまう。`ctrlKey` / `metaKey` / `altKey` / `repeat` / `isComposing` の
  フィルタは**すべて hook 側の責務**。
- **`KeyDef.id` と `KeyboardEvent.code` は一様に対応しない。** `event.code` から逆引きしないこと。
  `event.key`（文字）を `findKeyForChar()` に渡す。
- **購読対象の要素を条件付きレンダーしないこと。** 後から `targetRef.current` に入れても
  effect が再実行されず、**購読が永久に始まらない**（無言で入力を受け付けなくなる）。

## タイピングエンジン

- `typingReducer` は純粋関数。**時刻は必ず `action.at` で外部注入**する。`Date.now()` を内部で呼ばない。
- ミス時に `keyStats` へ記録するのは「押されたキー」ではなく**「打つべきだった期待文字」**。
  弱点分析が「このキーが打てない」を判定するため。
- **各問題の 1 文字目は `totalLatencyMs` に加算しない**（`attempts` には加算する）。
  問題文を読む時間が混入して latency 統計が壊れるため。
- `startedAt` は初期値 `null` で、**最初の有効打鍵で確定**する（以後上書きしない）。
  KPM の分母から「問題を読む準備時間」を除くため。`null` のとき KPM/WPM は 0。

## Chart

- **単位の異なる系列を 1 つの Chart に混ぜるとスケールが潰れる。**
  KPM(50〜120) と正確率(0.96〜0.98) を同じ Chart に渡すと正確率側の Y 座標が 0.02px 差に圧縮され、
  直線に見える。**別々の Chart に分ける**か `yMin` / `yMax` を指定する（`StatsScreen.tsx` が実装例）。
- `values` に `NaN` / `Infinity` が混ざると polyline 座標が `NaN` になり、**例外を出さずに
  折れ線が 1 本まるごと消える**。独自計算値を渡すなら `Number.isFinite` で濾すこと。

## 数値の表示

- `bestKpm` は `correctCount / (durationMs / 60000)` の生値で、**実データではほぼ常に小数**。
  表示時に `Math.round` を忘れると `100.59518819683124 KPM` と出る（実際に起きた）。
  ダミーの整数値で動作確認すると再現しないので注意。
