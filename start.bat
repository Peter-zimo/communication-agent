@echo off
chcp 65001 >nul
echo ════════════════════════════════════════
echo   售前工程师 SOP 工作台 - 启动脚本
echo ════════════════════════════════════════
echo.
echo [配置] 模型地址：https://api.deepseek.com/chat/completions
echo [配置] 启动前必须设置 DeepSeek API Key：
echo   set DEEPSEEK_API_KEY=你的DeepSeek_API_Key
echo [配置] 可选环境变量：
echo   set MODEL_BASE_URL=https://api.deepseek.com/chat/completions
echo   set MODEL_NAME=deepseek-v4-flash
echo   set MODEL_TIMEOUT_MS=90000
echo.
echo [启动] 按任意键启动服务，或直接关掉窗口退出
echo.
pause
echo.
npm start
pause
