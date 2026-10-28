# dog_run_system

ドッグランのLINE会員証(ポイントカード)と、分析ダッシュボードのシステム。

- 仕様:[docs/requirements.md](docs/requirements.md)
- 画面のデモ:[docs/demo.html](docs/demo.html)(ブラウザで開くと操作できる)
- 開発ルールとコマンド:[CLAUDE.md](CLAUDE.md)
- デプロイの手順:[docs/deploy.md](docs/deploy.md)

```
apps/api         Cloudflare Workers + Hono(API・自動処理・画面の配信)
apps/liff        お客さん向け画面(LINE の中で開く LIFF アプリ)
apps/admin       受付・管理者向け画面
packages/shared  型・入力チェック・ポイント計算と統合のロジック
docs/            要件定義書、手順書
e2e/             Playwright による画面の通し操作のテスト
```
