# デプロイの手順(製作者向け)

API・お客さん向け画面(LIFF)・管理画面は、1つの Cloudflare Worker から配信します。月額0円の無料プランで動きます。

## はじめて用意するもの

1. **Cloudflare**
   - `pnpm --filter @dr/api exec wrangler d1 create dog-run-production` でデータベースを作り、表示された `database_id` を `apps/api/wrangler.toml` の `[env.production]` に書く。
   - `pnpm --filter @dr/api exec wrangler r2 bucket create dog-run-production-media` で写真の保存先を作る(公開設定にはしない)。
2. **LINE Developers**
   - LINEログインのチャネルを作り、チャネルIDを `wrangler.toml` の `LINE_CHANNEL_ID` に書く(チャネルIDは公開してよい値)。
   - そのチャネルに LIFF アプリを追加する。サイズは Full、エンドポイントURLは `https://<Workerのドメイン>/liff/`、スコープは `openid` と `profile`。シェアターゲットピッカーを有効にする。
   - LIFF ID を、ビルド時の環境変数 `VITE_LIFF_ID` に入れる。

## デプロイ

```sh
pnpm install
VITE_LIFF_ID=<LIFF ID> pnpm build
pnpm --filter @dr/api exec wrangler d1 migrations apply DB --remote --env production
pnpm --filter @dr/api exec wrangler deploy --env production
```

- `VITE_LIFF_ID` を付けずにビルドすると、LIFF 画面がモックで動いてしまう。本番では必ず付ける。
- 本番の `LINE_LOGIN_MOCK` は `"0"`。`ENVIRONMENT` が `production` のときは、設定に関係なくモックは無効になる。

## 受付の固定QRコード

チェックイン用のQRコードには、`https://liff.line.me/<LIFF ID>/checkin?k=<合言葉>` を入れる。合言葉は管理画面のルールの設定(settings の `checkin_passphrase`)にあり、変えると古いQRコードは使えなくなる。

## 最初の管理者と、製作者のアカウント

管理画面のアカウントは、最初の1つだけコマンドで作る。受付スタッフのアカウントは、管理画面のスタッフの管理(A-13)から作る。

```sh
cd apps/api
STAFF_PASSWORD='<10文字以上>' pnpm staff:create --email owner@example.com --name 管理者 --role admin --remote --env production
STAFF_PASSWORD='<10文字以上>' pnpm staff:create --email dev@example.com --name 製作者 --role developer --remote --env production
```

- `--role` は `admin`(管理者)・`staff`(受付スタッフ)・`developer`(製作者・見るだけ)。
- 同じメールアドレスで実行し直すと、パスワードを再設定し、ロックを解除する(管理者がパスワードを忘れたとき)。

## 自動処理(Cron)

`wrangler.toml` の `crons` で、毎日2回動く(UTC で書く)。処理の結果は `system_jobs` テーブルに残り、管理画面の「システムの状態」(M-17)で確かめられる。

| cron(UTC) | 日本時間 | 処理 |
| --- | --- | --- |
| `10 18 * * *` | 毎日 3:10 | 日別集計の再計算(過去400日)、有効期限の処理、バックアップ、移行期間終了後の画像削除。2月1日(と、祝日をまだ取り込めていないとき)は祝日の取り込みも |
| `10 20 * * *` | 毎日 5:10 | 前日の天気の取得(取れていない日があれば、過去7日分まで取り直す) |

ローカルで手動で動かすには、`--test-scheduled` を付けて起動し、cron の文字列を指定して呼ぶ。

```sh
pnpm build
pnpm --filter @dr/api exec wrangler dev --local --port 8787 --test-scheduled
# 別の端末で
curl "http://localhost:8787/__scheduled?cron=10+18+*+*+*"   # 3:10 の処理
curl "http://localhost:8787/__scheduled?cron=10+20+*+*+*"   # 5:10 の処理
```

- 新しい wrangler では `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=10+18+*+*+*"` でも呼べる(`--test-scheduled` は要らない)。古い案内にある `/cdn-cgi/local/scheduled` は、使っている wrangler の版で動かなければ上のどちらかを使う。
- 管理画面の「システムの状態」の「今すぐ実行」からも、処理ごとに動かせる(管理者のみ)。

## バックアップと復元

- D1 のタイムトラベル(無料プランでは過去7日間)に加え、毎晩 3:10 に全テーブルを JSON にして R2 の `backups/<日付>.json` に保存する(B-04)。今日を含めて30日分を残し、それより前は自動で消す。
- 管理画面の「システムの状態」から、管理者が手動でも保存できる(`POST /admin/api/system/backup`)。
- 中身は `{ format: "dog-run-backup", version: 1, createdAt, tables: { 表の名前: { columns: [...], rows: [[...], ...] } } }`。
- 取り出し: `pnpm --filter @dr/api exec wrangler r2 object get dog-run-production-media/backups/2026-10-28.json --file backup.json --remote`
- 復元は、まずタイムトラベル(`wrangler d1 time-travel restore DB --timestamp=...`)を使う。7日より前に戻すときは、空のデータベースにマイグレーションを当ててから、JSON の各表の行を INSERT する(表の順番は、外部キーの参照先から: staff_users・households・breeds → family_members・dogs → visits → ほか)。
