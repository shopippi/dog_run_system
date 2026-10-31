#!/usr/bin/env bash
# 本番の D1(写真もふくむ)を SQL に書き出し、合言葉(BACKUP_PASSPHRASE)で暗号化して、$1 のファイルに保存する。
# 配信の前(deploy.yml)と、毎晩のバックアップ(backup.yml)から使う。apps/api で、prepare-production.mjs のあとに動かす。
# リポジトリは公開なので、暗号化しないまま GitHub に置かない。合言葉がなければ何もしない。
set -euo pipefail
OUT="$1"
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "::warning title=バックアップ::Secrets に BACKUP_PASSPHRASE がないので、バックアップを取りません。docs/deploy.md の「バックアップと復元」を見て登録してください。"
  exit 0
fi
TMP="$(mktemp -d)"
pnpm exec wrangler d1 export DB --remote --env production --output "$TMP/dump.sql" >/dev/null
gzip -9 "$TMP/dump.sql"
gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$OUT" "$TMP/dump.sql.gz" 3<<<"$BACKUP_PASSPHRASE"
rm -rf "$TMP"
echo "バックアップを作りました($(du -h "$OUT" | cut -f1))"
echo "BACKUP_FILE=$OUT" >> "${GITHUB_ENV:-/dev/null}"
