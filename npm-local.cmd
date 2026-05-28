@echo off
set "ROOT=%~dp0"
set "NODE_DIR=%ROOT%.tools\node-v24.16.0-win-x64"

if not exist "%NODE_DIR%\node.exe" (
  echo Local Node.js was not found at "%NODE_DIR%\node.exe"
  exit /b 1
)

if not exist "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" (
  echo Local npm was not found at "%NODE_DIR%\node_modules\npm\bin\npm-cli.js"
  exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
"%NODE_DIR%\node.exe" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" %*
exit /b %ERRORLEVEL%
