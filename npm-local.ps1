param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $NpmArgs
)

$root = $PSScriptRoot
$nodeDir = Join-Path $root ".tools\node-v24.16.0-win-x64"
$node = Join-Path $nodeDir "node.exe"
$npm = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"

if (-not (Test-Path $node)) {
  Write-Error "Local Node.js was not found at $node"
  exit 1
}

if (-not (Test-Path $npm)) {
  Write-Error "Local npm was not found at $npm"
  exit 1
}

$env:PATH = "$nodeDir;$env:PATH"
& $node $npm @NpmArgs
exit $LASTEXITCODE
