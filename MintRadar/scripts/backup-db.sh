#!/bin/bash
set -euo pipefail
# Backups hold the whole database: everything created here is private to the
# owner (dir 700, files 600). Must come before anything is created.
umask 077
BACKUP_DIR=/var/backups/mintradar
DATE=$(date +%Y%m%d_%H%M%S)
FINAL_FILE="$BACKUP_DIR/mintradar_$DATE.sql.gz"
# Same directory as the final file so the mv below is an atomic rename. The
# name does not end in .sql.gz, so the retention find never sees it as a backup.
TMP_FILE="$BACKUP_DIR/.mintradar_$DATE.sql.gz.tmp"
install -d -m 700 "$BACKUP_DIR"
# A failed or interrupted run must not leave a half-written file behind.
trap 'rm -f "$TMP_FILE"' EXIT
if ! docker exec mintradar-postgres-1 pg_dump -U mintradar mintradar | gzip > "$TMP_FILE"; then
  echo "Backup FAILED: pg_dump or gzip returned an error" >&2
  exit 1
fi
# gzip turns an empty dump into a small valid file, so check the decompressed size.
if ! BYTES=$(gzip -dc "$TMP_FILE" | wc -c) || [ "$BYTES" -eq 0 ]; then
  echo "Backup FAILED: dump is empty or not a valid gzip stream" >&2
  exit 1
fi
chmod 600 "$TMP_FILE"
mv -f "$TMP_FILE" "$FINAL_FILE"
# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
# Temp files left by a killed run (SIGKILL, power loss) would otherwise stay forever
find "$BACKUP_DIR" -name ".mintradar_*.sql.gz.tmp" -mtime +1 -delete
echo "Backup completed: mintradar_$DATE.sql.gz"
