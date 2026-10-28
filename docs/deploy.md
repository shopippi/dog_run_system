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
