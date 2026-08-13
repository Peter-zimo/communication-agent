# 客户交流会议助手

单场景 Web 试用版售前智能体，使用压缩包中的 SOP、推荐问题、Skill 和输出模板作为内容源。

## 运行

```powershell
npm start
```

默认地址：`http://localhost:5173`

## 个人作品集（本地使用）

启动服务后，可在浏览器访问：

- `http://localhost:5173/portfolio.html`：公开作品集预览
- `http://localhost:5173/portfolio-admin.html`：本地作品集管理页

预览内容在点击“发布”前仅保存在本地。请勿发布管理页或任何环境变量、密钥等配置文件。

## 模型配置

后端默认使用 DeepSeek 官方 OpenAI Chat Completions 兼容接口。

默认值：

- `MODEL_BASE_URL=https://api.deepseek.com/chat/completions`
- `MODEL_NAME=deepseek-v4-flash`
- `MODEL_TIMEOUT_MS=90000`
- `DEEPSEEK_API_KEY=你的 DeepSeek API Key`（必填，不会写入代码）

启动前在 PowerShell 中设置密钥：

```powershell
$env:DEEPSEEK_API_KEY = '你的 DeepSeek API Key'
npm start
```

可通过环境变量覆盖接口地址、模型名和超时时间。不要把真实密钥提交到仓库或写入 `start.bat`。

## 测试

```powershell
npm test
```

## 一期边界

- 不接 CRM / ERP / 网盘 / 会议录音。
- 不持久保存客户信息和生成记录。
- 页面刷新后当前对话丢失。
- 后端统一拼接提示词、调用模型并映射错误提示。
