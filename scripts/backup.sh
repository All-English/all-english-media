#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"

mkdir -p "${BACKUP_DIR}"

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
