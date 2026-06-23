#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/mintradar
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
docker exec mintradar-postgres-1 pg_dump -U mintradar mintradar | gzip > $BACKUP_DIR/mintradar_$DATE.sql.gz
# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
echo "Backup completed: mintradar_$DATE.sql.gz"
