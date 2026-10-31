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

## 予約のLINEのお知らせ(Messaging API)を使えるようにする

予約が確定したとき・お断りしたときに、お客さんのLINEにお知らせが届くようにします(要件定義書 21.6)。**この設定をしなくても予約は使えます**(お知らせが届かないだけで、お客さんは会員証の「預かり・お泊まりの予約」で状態を見られます)。費用はかかりません(無料のプランで月200通まで。上限は管理画面の「予約の設定」で決められ、超えた月は送りません)。

作業はパソコンのブラウザで行います。15分ほどです。

### 1. Messaging API のチャネルを用意する

1. LINE公式アカウントの管理画面(https://manager.line.biz/)にログインし、グリーンドームのアカウントを開く。
2. 右上の「設定」→ 左の「Messaging API」を開き、「Messaging APIを利用する」を押す。
3. 「プロバイダーを選択」では、**LINEログインのチャネル(LIFF があるチャネル)と同じプロバイダー**を選ぶ。
   - 違うプロバイダーにすると、お客さんの LINE のユーザーID が別のものになり、お知らせが届きません。
   - プロバイダーは、あとから変えられません。迷ったら製作者に確認してください。
4. 「OK」で進むと、LINE Developers(https://developers.line.biz/)に「Messaging API」のチャネルができます。

### 2. チャネルアクセストークンを発行する

1. LINE Developers にログインし、上のプロバイダー → できた「Messaging API」のチャネルを開く。
2. 「Messaging API設定」のタブを開き、いちばん下の「チャネルアクセストークン(長期)」の「発行」を押す。
3. 表示された長い文字列(トークン)をコピーする。**この文字列は合言葉と同じです。メールやチャットに貼らず、次の手順の GitHub にだけ入れてください。**
4. 同じ画面の「応答メッセージ」「あいさつメッセージ」は、今までどおり LINE公式アカウントの管理画面の設定のままで構いません。

### 3. LINE公式アカウントを LIFF につなぐ(友だち追加オプション)

お知らせは、お客さんが LINE公式アカウントを友だちに追加しているときだけ届きます。会員証を開いたときに友だち追加をすすめるようにします。

1. LINE Developers で、**LINEログインのチャネル**(LIFF があるチャネル)を開く。
2. 「チャネル基本設定」のタブの「リンクされたLINE公式アカウント」で、グリーンドームの公式アカウントを選んで「更新」。
3. 「LIFF」のタブで会員証の LIFF アプリを開き、「友だち追加オプション」を「On (Normal)」にして「更新」。
   - これで、はじめて会員証を開いた人に「友だち追加」の画面が出ます。

### 4. GitHub にトークンを入れて、配信し直す

1. GitHub のリポジトリを開き、「Settings」→ 左の「Environments」→「Secret」を開く。
2. 「Environment secrets」の「Add environment secret」を押す。
3. Name に `LINE_MESSAGING_TOKEN`、Secret に手順2でコピーしたトークンを貼って「Add secret」。
4. 「Actions」→ 左の「Deploy」→ 右の「Run workflow」で配信し直す(main に変更を入れたときも、自動で入ります)。
   - 配信の記録(Actions の実行の「Summary」の注釈)に「LINEのお知らせ: つながりました(グリーンドーム / @xxxx)」と出れば完了です。
   - 「LINE 公式アカウントにつながりませんでした(HTTP 401)」と出たときは、トークンが違います。手順2で発行し直して、手順4で入れ直してください。配信そのものは止まりません。

手で入れるときは、`printf '%s' '<トークン>' | pnpm --filter @dr/api exec wrangler secret put LINE_MESSAGING_TOKEN --env production`(コードやファイルには書かない)。

### 5. 確かめる

1. 管理画面の「システムの状態」を開き、「LINEのお知らせ」の行が「つながっています(公式アカウントの名前)」になっているかを見る(5分ほど覚えておくので、入れ直した直後は少し待つ)。今月送った数と上限(200通)も出ます。
2. 自分のLINEで会員証を開き、ワンちゃん(管理者の犬の編集で「預かり経験あり」に印を付けた子)を予約する。すぐ確定になり、LINEにお知らせが届けば完了。
3. 届かないときは、管理画面の予約の内容(予約カレンダーで日を押して予約を開く)の「LINEのお知らせ」に理由が出ます。
   - 「お客さんがLINEの友だちに追加していないため、届きませんでした」: 公式アカウントを友だちに追加してから、もう一度試す。
   - 「LINEのお知らせの設定がまだのため、送っていません」: 手順4のトークンが入っていない。
   - 「LINEに送れませんでした」: トークンが違う・発行し直して古くなった。手順2からやり直す。

local・テストの環境とブラウザだけで動くデモでは、LINE には送りません(送ったつもりで記録します)。

## 自動処理(Cron)

`wrangler.toml` の `crons` で、毎日2回動く(UTC で書く)。処理の結果は `system_jobs` テーブルに残り、管理画面の「システムの状態」(M-17)で確かめられる。

| cron(UTC) | 日本時間 | 処理 |
| --- | --- | --- |
| `10 18 * * *` | 毎日 3:10 | 日別集計の再計算(過去400日)、有効期限の処理、バックアップ、移行期間終了後の画像削除。2月1日(と、祝日をまだ取り込めていないとき)は祝日の取り込みも |
| `10 20 * * *` | 毎日 5:10 | 前日の天気の取得(取れていない日があれば、過去7日分まで取り直す) |

ローカルで手動で動かすには、`--test-scheduled` を付けて起動し、cron の文字列を指定して呼ぶ(wrangler 4.154 で確認)。

```sh
pnpm build
pnpm --filter @dr/api exec wrangler dev --local --port 8787 --test-scheduled
# 別の端末で
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=10+18+*+*+*"   # 3:10 の処理
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=10+20+*+*+*"   # 5:10 の処理
```

- `/__scheduled?cron=...` と `/cdn-cgi/handler/scheduled?cron=...` でも同じように呼べる。
- 結果は `system_jobs` に残る: `pnpm --filter @dr/api exec wrangler d1 execute DB --local --command "SELECT * FROM system_jobs ORDER BY id DESC LIMIT 10"`
- 管理画面の「システムの状態」の「今すぐ実行」からも、天気・祝日・バックアップ・集計を動かせる(管理者のみ)。

## バックアップと復元

写真を R2 ではなく D1 に入れている(R2 を使わない。月額0円)ため、バックアップは次の3つ。どれもデータベースに入っている写真もふくむ。

1. **D1 のタイムトラベル**: 無料プランで過去7日間の、どの時点にも戻せる。設定は要らない。
2. **配信の前のバックアップ**: 配信(deploy.yml)のたびに、マイグレーションを当てる前のデータベースを書き出し、暗号化して GitHub の Actions の「Artifacts」に30日残す。
3. **毎晩のバックアップ**: backup.yml が毎日 日本時間 3:40 に同じものを残す(30日)。GitHub の決まりで、予定の実行は main に入ってから動く。それまでは Actions の画面の「Backup」→「Run workflow」で手で動かせる。

アプリの中の夜間のバックアップ(B-04、R2 に JSON を置く)は、R2 を使うときだけ動く。いまは「システムの状態」に「スキップしました(写真の保存先 R2 を使っていないため…)」と出る。

### 合言葉を登録する(はじめに1回)

リポジトリは公開なので、バックアップは必ず暗号化してから GitHub に置く。合言葉がないとバックアップは取らない(配信は続く)。

1. 長い合言葉を決める(例: パスワード管理アプリで 30 文字以上を作る)。**なくすとバックアップを戻せない**ので、依頼主と製作者の両方で控える
2. GitHub の Settings → Environments →「Secret」→「Add environment secret」で、名前 `BACKUP_PASSPHRASE`、値に合言葉を入れて保存する
3. Actions の「Backup」→「Run workflow」で一度動かし、終わった画面の下の「Artifacts」に `backup-…` ができていることを確かめる

### 戻す

- まず、タイムトラベルで足りるか考える: `pnpm --filter @dr/api exec wrangler d1 time-travel restore DB --env production --timestamp=<日時>`
- 7日より前、またはデータベースを作り直すとき:
  1. Actions の該当の実行の「Artifacts」から `backup-…` か `before-deploy-…` をダウンロードして展開する(中身は `*.sql.gz.gpg`)
  2. 復号して展開する: `gpg --decrypt backup.sql.gz.gpg > backup.sql.gz && gunzip backup.sql.gz`(合言葉を聞かれる)
  3. 空のデータベースに流し込む: `pnpm --filter @dr/api exec wrangler d1 execute DB --env production --remote --file backup.sql`(作り直したデータベースには、先にマイグレーションを当てない。書き出しにはテーブルの作成もふくまれる)
