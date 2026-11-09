#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"

mkdir -p "${BACKUP_DIR}"

DATE_STR="$(date +%Y-%m-%d)"
BACKUP_FILE="${BACKUP_DIR}/convex-production-backup-${DATE_STR}.zip"

echo "[Convex Backup] Exporting production snapshot to ${BACKUP_FILE}..."
cd "${ROOT_DIR}"
npx convex export --prod --include-file-storage --path "${BACKUP_FILE}"

echo "[Convex Backup] Done. Backup saved to ${BACKUP_FILE}"
