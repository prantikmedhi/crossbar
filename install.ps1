# Crossbar installer for Windows (PowerShell).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Crossbar needs Node.js 22.13 or newer: https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)"; exit 1
}
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Node "+process.versions.node+" is too old: Crossbar needs 22.13+"); process.exit(1) }'
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Installing Crossbar..."
npm install --no-audit --no-fund
npm install -g . --no-audit --no-fund
crossbar setup
$ans = Read-Host "Sign in now (imports your x.com sign-in from your browser)? [Y/n]"
if ($ans -notmatch '^[nN]') { crossbar login; if ($LASTEXITCODE -ne 0) { Write-Host "Try: crossbar login --window" } }
else { Write-Host "Later: crossbar login" }
