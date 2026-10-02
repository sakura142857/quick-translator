@echo off
rem 双击启动「快捷翻译」，不保留终端窗口
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行需要先安装依赖，请稍候...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .
