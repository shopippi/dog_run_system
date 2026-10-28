# ドッグラン LINE会員・分析システム

LINE公式アカウントの標準ショップカードを置き換える、LINEミニアプリ(LIFF)と管理画面のシステム。仕様は `docs/requirements.md` が正。実装の前に必ず該当する章を読むこと。

## 仕様の扱い

- 仕様は `docs/requirements.md` を正とする。矛盾や不明点があれば、推測で実装せず、実装前に質問する。
- 機能ID(C-04、A-07 など)を単位に作業する。1つの機能IDを1つのプルリクエストにし、テストを必ず付ける。
- `docs/requirements.md` の「20. 未決事項」に関わる値は、初期案で実装し、管理画面の設定(settings テーブル)から変えられるようにする。
- 画面の見た目は `docs/design.md` に従う(色・文字・間隔・部品の仕様と、やってはいけないこと)。操作の流れはブラウザで動くデモ(`apps/demo`、`docs/demo.md`)を参考にする(`docs/demo.html` は初期の模型で、いまの見た目とは違う)。新しい画面を作ったら、e2e の layout と contrast のテストに加える。

## 技術構成

- TypeScript。API は Cloudflare Workers + Hono、DB は Cloudflare D1、写真は Cloudflare R2。
- 画面は React + Vite。お客さん向け(apps/liff)と管理画面(apps/admin)は別アプリ。LIFF SDK を使う。
- 入力チェックは zod。型・入力チェック・ポイント計算・統合のロジックは packages/shared に置き、API と画面で共有する。
- スキーマの変更は wrangler のマイグレーションで管理する。
- テストは Vitest(API とロジック)、Playwright(画面の通し操作。LIFF はモック)。
- 月額0円で運用する。有料プランや、無料プランで商用利用できないサービス(Vercel の無料プランなど)を使わない。

## 守るルール

- ポイントや来場は、必ず「おうち(households / 会員ID)」に付ける。家族(family_members / LINEアカウント)には付けない。
- ポイントと無料券の残高は、必ず台帳(point_ledger、tickets)から計算する。残高の列を作って直接更新しない。
- ポイントは、おうちごとに1日1ポイント。日付は日本時間(Asia/Tokyo)で判定する。
- データを物理削除しない。状態の変更と操作ログ(audit_log)で扱い、元に戻せるようにする。例外は、退会時の個人情報の削除のみ。
- 権限チェックは必ず API 側で行う。画面で隠すだけにしない。製作者のアカウントは閲覧のみで、変更系の API はすべて 403 を返す。
- お客さん向け API は、LINE の ID トークンを毎回サーバー側で検証する。
- 犬の写真は、誰でも開ける URL にしない。必ず認証つきの API 経由で返す。
- 管理画面の言葉は、要件定義書 15.1 の基準に従う。IT 用語を画面に出さない。エラーは「何が起きたか」と「次に何をすればよいか」を日本語で表示する。
- 秘密情報(LINE のチャネルシークレットなど)はコードに書かず、wrangler の secret で管理する。

## コマンド

pnpm のワークスペース(apps/api、apps/liff、apps/admin、packages/shared)。リポジトリの直下で実行する。

```sh
pnpm install                 # 依存関係を入れる
pnpm db:migrate:local        # ローカルのデータベースにマイグレーションを当てる
pnpm dev                     # 画面をビルドして http://localhost:8787 で起動(/liff/ と /admin/)
pnpm typecheck               # 型チェック
pnpm test                    # Vitest(packages/shared のロジックと apps/api の API)
pnpm test:e2e                # Playwright(画面の通し操作。空のデータベースで起動し直す)
pnpm --filter @dr/api exec wrangler d1 migrations create DB <名前>   # マイグレーションを追加する
STAFF_PASSWORD=... pnpm --filter @dr/api staff:create --email <メール> --name <名前> --role admin   # 管理画面のアカウントを作る(ローカル)
```

- 画面は Worker の静的アセット配信で、API と同じドメインから出す(`/liff/`、`/admin/`、`/api/*`、`/admin/api/*`)。
- `VITE_LIFF_ID` を付けずにビルドした LIFF 画面はモックで動く(`?mockUser=U001:パパ` で LINE ユーザーを切り替えられる)。API 側のモックは `ENVIRONMENT` が local / test で `LINE_LOGIN_MOCK=1` のときだけ有効。
- テストと開発では `x-debug-now` ヘッダーで現在時刻を指定できる(本番では無視される)。
- Playwright 用のアカウントは `admin@example.com`・`staff@example.com`・`developer@example.com`(パスワード `e2e-password-1234`)。e2e/start-server.sh が作る。
- デプロイの手順は `docs/deploy.md` を参照。
