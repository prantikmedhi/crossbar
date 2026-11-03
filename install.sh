#!/usr/bin/env sh
# Crossbar installer for macOS and Linux.
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Crossbar needs Node.js 22.13 or newer: https://nodejs.org (or: brew install node / your package manager)"; exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Node "+process.versions.node+" is too old: Crossbar needs 22.13+"); process.exit(1) }'
echo "Installing Crossbar..."
npm install --no-audit --no-fund
npm install -g . --no-audit --no-fund || { echo "Global install needs permission. Retrying with sudo..."; sudo npm install -g . --no-audit --no-fund; }
crossbar setup
echo
printf "Sign in now (imports your x.com sign-in from your browser)? [Y/n] "
read -r ans || ans=""
case "$ans" in n|N) echo "Later: crossbar login" ;; *) crossbar login || echo "Try: crossbar login --window" ;; esac
