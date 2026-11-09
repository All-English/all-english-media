#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"

mkdir -p "${BACKUP_DIR}"

# Check if running in scheduled mode for the first Monday of the month
if [[ "${1:-}" == "--only-first-monday" ]]; then
  DOW="$(date +%u)" # 1 = Monday, 7 = Sunday
  DOM="$(date +%-d)" # Day of month 1-31
  if [ "$DOW" -ne 1 ] || [ "$DOM" -gt 7 ]; then
    echo "[Convex Backup] Today is not the first Monday of the month (day ${DOM}, weekday ${DOW}). Skipping."
    exit 0
  fi
fi

DATE_STR="$(date +%Y-%m-%d)"
BACKUP_FILE="${BACKUP_DIR}/convex-production-backup-${DATE_STR}.zip"

# Convex export requires an unoccupied path. If a backup already exists for today, append timestamp.
if [ -f "${BACKUP_FILE}" ]; then
  TIME_STR="$(date +%H%M%S)"
  BACKUP_FILE="${BACKUP_DIR}/convex-production-backup-${DATE_STR}_${TIME_STR}.zip"
fi

echo "[Convex Backup] Exporting production snapshot to ${BACKUP_FILE}..."
cd "${ROOT_DIR}"
npx convex export --prod --include-file-storage --path "${BACKUP_FILE}"
echo "[Convex Backup] Done. Backup saved to ${BACKUP_FILE}"

# Retention policy: Keep only the 3 most recent backups
echo "[Convex Backup] Applying retention policy (keeping last 3 backups)..."
cd "${BACKUP_DIR}"
ls -t convex-production-backup-*.zip 2>/dev/null | tail -n +4 | while read -r old_backup; do
  if [ -n "${old_backup}" ] && [ -f "${old_backup}" ]; then
    echo "[Convex Backup] Pruning old backup: ${old_backup}"
    rm -f "${old_backup}"
  fi
done

echo "[Convex Backup] Backups currently retained:"
ls -lh convex-production-backup-*.zip
