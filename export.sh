#!/usr/bin/env bash
# Export subdomains and cookies from an XML file into Redis.
#
#   ./export.sh [-v] /path/to/xml
#
#   -v   print every key saved to Redis
#
# Starts Redis (if not already running) and runs the exporter container
# via docker compose. The XML file is mounted read-only into the container.
set -euo pipefail

usage() { echo "Usage: $0 [-v] /path/to/xml" >&2; exit 1; }

VERBOSE=""
XML_PATH=""
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE="-v" ;;
    -h|--help)    usage ;;
    -*)           echo "Unknown option: $arg" >&2; usage ;;
    *)            [ -z "$XML_PATH" ] || usage; XML_PATH="$arg" ;;
  esac
done
[ -n "$XML_PATH" ] || usage
[ -f "$XML_PATH" ] || { echo "Error: file not found: $XML_PATH" >&2; exit 1; }

# Absolute path is required for a Docker bind mount.
ABS_XML="$(cd "$(dirname "$XML_PATH")" && pwd)/$(basename "$XML_PATH")"

# Run compose from the project directory no matter where the script is called from.
cd "$(dirname "$0")"

docker compose up -d --wait redis >/dev/null
docker compose --profile cli run --rm --build \
  -v "$ABS_XML:/data/input.xml:ro" \
  app $VERBOSE /data/input.xml
