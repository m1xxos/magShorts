#!/usr/bin/env bash
set -euo pipefail

# Local vulnerability scanner script for magShorts
# Runs Trivy (via local binary or Docker) and generates an interactive HTML report.

TRIVY_VERSION="${TRIVY_VERSION:-0.76.1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_JSON="${ROOT_DIR}/trivy-results.json"
OUTPUT_HTML="${ROOT_DIR}/vulnerability-report.html"

echo "🔍 Running vulnerability scan for magShorts..."

if command -v trivy &> /dev/null; then
  echo "Using locally installed Trivy..."
  trivy fs \
    --quiet \
    --scanners vuln \
    --skip-dirs "node_modules,.next,data" \
    --format json \
    --output "${OUTPUT_JSON}" \
    "${ROOT_DIR}"
elif command -v docker &> /dev/null && docker info &> /dev/null; then
  echo "Using Trivy via Docker (aquasec/trivy:${TRIVY_VERSION})..."
  docker run --rm \
    -v "${ROOT_DIR}:/src" \
    "aquasec/trivy:${TRIVY_VERSION}" fs \
    --quiet \
    --scanners vuln \
    --skip-dirs "node_modules,.next,data" \
    --format json \
    /src > "${OUTPUT_JSON}"
else
  echo "⚠️ Neither Trivy CLI nor Docker daemon is available."
  echo "Falling back to 'npm audit'..."
  npm audit || true
  exit 0
fi

if [ -f "${OUTPUT_JSON}" ]; then
  echo ""
  echo "📊 Generating report..."
  node "${ROOT_DIR}/scripts/generate-vulnerability-report.mjs" \
    --input "${OUTPUT_JSON}" \
    --title "Local Dependency Vulnerability Scan" \
    --html "${OUTPUT_HTML}" \
    --summary

  echo ""
  echo "✅ Vulnerability scan complete!"
  echo "📄 Interactive HTML report: ${OUTPUT_HTML}"

  if [[ "${1:-}" == "--open" ]] || [[ "${OPEN:-false}" == "true" ]]; then
    if command -v open &> /dev/null; then
      open "${OUTPUT_HTML}"
    elif command -v xdg-open &> /dev/null; then
      xdg-open "${OUTPUT_HTML}"
    fi
  fi
fi
