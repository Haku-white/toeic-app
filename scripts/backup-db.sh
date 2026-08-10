#!/usr/bin/env bash
# ローカルSupabase DBのpublicスキーマ(データのみ)を`backups/`にダンプする。
#
# `supabase db reset`はmigrations+seed.sqlのみを再生し、生成パイプライン
# (commitBatch.ts)が直接INSERTした本番反映済みコンテンツ(バックフィル済み
# grammar_questions/vocab_words等)はseed.sqlに含まれないため消え去る。
# 2026-08-12、db reset実行時にこれが原因で文法問題320問・語彙タグ拡張分が
# 消失する事故が発生した(DESIGN.md参照)。再発防止のため、db resetの前には
# 必ず本スクリプトでバックアップを取ること(CLAUDE.md「必ず立ち止まって
# 確認すること」参照)。
#
# 使い方:
#   ./scripts/backup-db.sh
#
# 復元(db reset後、マイグレーション適用直後に実行する):
#   docker exec -i supabase_db_toeic-app psql -U postgres < backups/<ファイル名>.sql

set -euo pipefail

CONTAINER="supabase_db_toeic-app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
OUTPUT="$BACKUP_DIR/toeic-app_${TIMESTAMP}.sql"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "エラー: ${CONTAINER} が起動していません。'supabase start' を先に実行してください。" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" pg_dump -U postgres --data-only --schema=public --inserts --column-inserts --disable-triggers \
  > "$OUTPUT"

echo "バックアップを書き出しました: $OUTPUT"
