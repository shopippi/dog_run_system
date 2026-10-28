# 実装担当への共通の指示(フェーズ2〜4)

この文書は、並行して機能を実装する担当者(人でも AI でも)が最初に読むもの。各担当の範囲は、作業を割り当てるときに別に伝える。

## 最初に読むもの

1. `CLAUDE.md`(ルールとコマンド)
2. `docs/requirements.md` の、割り当てられた機能IDに関わる章。特に 3.2(権限)、8章(ポイント)、11章(データ)、12章(API)、13章(指標)、15.1(言葉と使いやすさ)、19.2(受け入れ基準)
3. `docs/design.md`(画面の作り方。部品・色・禁止事項)
4. 既存のコードの型と部品。とくに次のもの:
   - API: `apps/api/src/app.ts`(ルートの登録。**自分のルートのファイルだけ**を編集する)、`src/lib/errors.ts`、`src/lib/validate.ts`、`src/lib/staff-auth.ts`(`requireRole`)、`src/lib/settings.ts`、`src/services/audit.ts`(操作ログ)、`src/services/undo.ts`(元に戻す処理の登録口)、`src/services/points.ts`、`src/services/checkins.ts`、`src/services/dogs.ts`
   - 共通: `packages/shared/src/*`(型・入力チェック・ポイント計算)。自分の領域の `api-types-<領域>.ts` と `schemas/<領域>.ts` に書く
   - 管理画面: `apps/admin/src/components/*`(Layout、PageHead、Dialog、DogFace、Icon、ErrorNotice)、`pages/TodayPage.tsx` と `pages/SearchPage.tsx`(作り方の手本)、`styles.css`
   - お客さん向け: `apps/liff/src/components/*`、`pages/*`、`styles.css`
   - テスト: `apps/api/test/helpers.ts`(登録・チェックイン・ログインの補助)、`e2e/helpers.ts`、`e2e/admin.layout.spec.ts`、`e2e/contrast.spec.ts`

## 作業のルール

- 自分の作業場所(worktree)とブランチだけで作業する。ほかの作業場所は触らない。
- 最初に `pnpm install --frozen-lockfile` を実行する(作業場所ごとに node_modules が要る)。
- **1つの機能IDを1つのコミット**にする。コミットのタイトルは「A-03 ポイントの手動登録」のように機能IDで始める。本文に、何を作ったか・迷って決めたことを日本語で書き、最後に次の2行を付ける:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CeXocUtpkzvyuQwQbmjHXB
  ```
- 機能ごとに **Vitest(API)と Playwright(画面)のテスト**を付ける。要件定義書 19.2 の受け入れ基準に自分の機能があれば、必ずテストにする。境界値(19.3)も含める。
- 新しい画面を作ったら、見え方とコントラストのテストに加える。共有のファイルは触らず、自分の領域のファイルを作る:
  - 管理画面の見え方: `e2e/admin.<領域>-layout.spec.ts`(`e2e/admin.layout.spec.ts` の `checkScreen` と同じ確かめ方。1280×800・768×1024 の2つでよい)
  - お客さん向けの見え方: `e2e/liff.<領域>-layout.spec.ts`(`e2e/liff.layout.spec.ts` と同じ確かめ方。iPhone SE 375×603 と iPhone 16 393×759 の2つでよい)
  - コントラスト: `e2e/contrast-<領域>.spec.ts`(`e2e/contrast.spec.ts` の `lowContrast` をコピーして使う。ライトとダーク)
  - どれも `SHOT_DIR` があれば画面の写真を保存する(ファイル名は「M-06 おうちの詳細.png」のように画面IDつき)
- Playwright は、割り当てられたポートで動かす: `E2E_PORT=<ポート> pnpm test:e2e`。ほかの担当が別のポートで同時に動かしている。
- 共有のファイルを編集するときは、追加だけにして、既存の行を書き換えない:
  - `apps/api/src/app.ts`、`packages/shared/src/index.ts`、`apps/admin/src/App.tsx`、`apps/admin/src/components/Layout.tsx`、`apps/admin/src/components/Icon.tsx`、`apps/liff/src/App.tsx`、`apps/api/test/helpers.ts`、`e2e/helpers.ts`、`apps/admin/src/styles.css`、`apps/liff/src/styles.css`、`packages/shared/styles/tokens.css`
  - CSS は自分の領域の部品にだけ、末尾に追記する(クラス名に領域の接頭辞をつけるか、画面ごとの名前にして、ほかとぶつからないようにする)。
  - マイグレーションは割り当てられた番号(例: `0003_xxx.sql`)を使い、追加だけ(ALTER TABLE ADD COLUMN、CREATE TABLE、INSERT)。既存の列は変えない。
- データを物理削除しない。状態の変更と操作ログで扱う(CLAUDE.md)。管理画面でのすべての変更は `auditStatement` で操作ログに残す(誰が・いつ・変更前後・理由)。元に戻せる操作は `registerUndo` で戻し方を登録する。
- 権限は API 側で `requireRole` で確かめる。製作者(developer)は閲覧のみ(すでに `requireStaff` が変更系を 403 にする)。
- 画面の言葉は 15.1 に従う(IT 用語を出さない。エラーは「何が起きたか」と「次にどうするか」)。ボタンは画面に主ボタン1つ。確認が要る操作(ポイントの手動登録、統合、家族を外す)は、結果を見せてから確定する(`Dialog` を使う)。
- 日付と日時は日本時間(`@dr/shared` の `toJstDate`、`toJstIso`)。テストでは `x-debug-now`(`call`・`adminCall` の `now`)で時刻を指定できる。
- 新しい依存関係は入れない(割り当てで許可された場合を除く)。
- コマンドは絶対パスか `pnpm --filter` で実行する(`cd` で作業ディレクトリが変わることがある)。テストは長いので timeout を長め(最大 600000)にする。

## 納品

1. `pnpm typecheck`、`pnpm test`、`E2E_PORT=<ポート> pnpm test:e2e` がすべて通ること。
2. 画面の写真を `SHOT_DIR=<指定の場所> E2E_PORT=<ポート> npx playwright test <自分の layout のテスト>` で撮り、自分で開いて見て、`docs/design.md` 2章(やってはいけないこと)に当てはまるものや、文字の重なり・切れがないことを確かめる。
3. `git push -u origin <自分のブランチ>` まで行う。プルリクエストは作らない。
4. 最後に次を短く報告する: 機能IDごとに作ったもの(API・画面・テストの件数)、迷って決めたこと、仕様で不明だったことと自分で決めた内容、共有ファイルに加えた行、写真の保存先。
