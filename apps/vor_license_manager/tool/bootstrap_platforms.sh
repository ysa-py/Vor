#!/usr/bin/env bash
# Vor License Manager — platform scaffold bootstrap (same pattern as client).
set -euo pipefail
cd "$(dirname "$0")/.."
flutter config --no-cli-animations
flutter create --platforms="${PLATFORMS:-android,windows}" --org ir.vor --project-name vor_license_manager .
echo "==> manager scaffolds ready"
