#!/usr/bin/env bash
# Playwright 用に、空のデータベースで API と画面を起動する。
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build >/dev/null
cd apps/api
STATE=.wrangler/e2e
rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" >/dev/null
# 管理画面のテスト用アカウント(パスワードはすべて e2e-password-1234)
for r in admin:管理者 staff:受付 developer:製作者; do
  STAFF_PASSWORD=e2e-password-1234 node scripts/create-staff.mjs --email "${r%%:*}@example.com" --name "${r##*:}" --role "${r%%:*}" --persist-to "$STATE" >/dev/null
done
exec npx wrangler dev --local --port 8788 --persist-to "$STATE" --var ENVIRONMENT:test --var LINE_LOGIN_MOCK:1
