#!/bin/sh
# Opt-in build of the Registry Web UI (ADR-0029 §9/§10, amendment C-089);
# not part of the gate. Needs node >= 22.12 with npm and, once, the npm
# registry (or a filled npm cache):
#   1. npm ci --ignore-scripts – exactly package-lock.json, no install scripts
#   2. npm run build           – tsc --noEmit, vite build → ui/dist/
#   3. go run ./internal/uipolicy/cmd/uigen (from oec/registry) – writes the
#      stamp ui/build.stamp and the Rust table src/ui_assets.rs, then checks
#      the npm policy, the licenses, the CSP rules of dist/ and both files
#   4. go test ./internal/uipolicy – the gate test of the UI
# Commit ui/dist/, ui/build.stamp and src/ui_assets.rs with the sources;
# never commit ui/node_modules/.
set -eu
ui="$(cd "$(dirname "$0")" && pwd)"
registry="$(cd "$ui/.." && pwd)"
command -v npm >/dev/null || { echo "build.sh: npm missing (node >= 22.12)" >&2; exit 1; }
cd "$ui"
echo "ui: npm ci --ignore-scripts"
npm ci --ignore-scripts --no-audit --no-fund
echo "ui: npm run build"
npm run build
cd "$registry"
echo "ui: stamp and table"
GOTOOLCHAIN="${GOTOOLCHAIN:-auto}" go run ./internal/uipolicy/cmd/uigen
GOTOOLCHAIN="${GOTOOLCHAIN:-auto}" go test -count=1 ./internal/uipolicy
echo "ui: ok"
