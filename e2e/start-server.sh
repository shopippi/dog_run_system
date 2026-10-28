#!/usr/bin/env bash
# Playwright 用に、空のデータベースで API と画面を起動する。
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build >/dev/null
cd apps/api
STATE=.wrangler/e2e
rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" >/dev/null
exec npx wrangler dev --local --port 8788 --persist-to "$STATE" --var ENVIRONMENT:test --var LINE_LOGIN_MOCK:1
