#!/usr/bin/env bash
# Scrape all F1 data (races, drivers, teams, awards, race results) into traf1/data/f1.sqlite.
# Run from repo root or from traf1: ./scripts/scrape_all.sh [--start YEAR] [--end YEAR]

set -e
cd "$(dirname "$0")/.."
SCRIPT_DIR="$(pwd)"

if ! command -v python3 &>/dev/null; then
  echo "python3 not found"
  exit 1
fi

# Use venv if present
if [ -d ".venv" ]; then
  . .venv/bin/activate
fi

# Default: 1950–2025. Override with --start / --end
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --start) EXTRA_ARGS+=(--start "$2"); shift 2 ;;
    --end)   EXTRA_ARGS+=(--end "$2");   shift 2 ;;
    --year)  EXTRA_ARGS+=(--year "$2");  shift 2 ;;
    --db)    EXTRA_ARGS+=(--db "$2");    shift 2 ;;
    *)       echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "Scraping all data (races, drivers, teams, awards, race results)..."
echo "Database: ${SCRIPT_DIR}/data/f1.sqlite"
echo ""

python3 -m f1data.cli scrape-all "${EXTRA_ARGS[@]}"

echo ""
echo "Done. Start the web UI with: python3 -m f1data.cli serve"
