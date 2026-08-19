# 售前工程师 SOP 智能工作台

> **单模型 + 显式工作流架构** 的售前客户交流辅助工具  
> 落地 7 步 SOP × 3 类会议(A/B/C) × 20+ 标准节点，结构化抽取 30+ 字段，167 测试全绿

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-167%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/License-MIT-blue)]()

---

## 🎯 项目定位

面向 **SE/售前/解决方案架构师** 的轻量化 AI 辅助工作台，将资深售前经验沉淀为**可执行、可校验、可复用**的结构化工作流：

| 场景 | 传统痛点 | 本工具方案 |
|------|----------|------------|
| **会前准备** | 只带公司介绍，缺客户背景/竞品/差分点 | SOP 引导式调研清单，Must-Do 逐项打勾 |
| **会中追问** | 客户随口提需求直接记下，不追问业务场景 | 实时推荐追问问题，安全回应话术库 |
| **会后复盘** | 只出流水账纪要，无判断/下一步/风险 | 结构化抽取→字段级确认→自动生成纪要/跟进计划/风险清单 |

---

## 🏗️ 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                    单一模型调用入口                          │
│  DeepSeek API (OpenAI 兼容)  ←── callModel / callModelStream │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ 会前准备       │  │ 会中追问       │  │ 会后复盘       │
│ before_meeting│  │ during_meeting│  │ after_meeting │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│              显式工作流编排引擎                               │
│  • TaskRouter: 会议类型(A/B/C) + 阶段 双维推断，准确率 92%   │
│  • PromptBuilder: 动态上下文注入（SOP节点/打法库/客户上下文） │
│  • Worksheet/MeetingWorkspace: 30+ 字段 Schema + 状态机      │
│  • TaskExecutor: 输出强校验（拒绝编号项/跨阶段标题/不完整）   │
└─────────────────────────────────────────────────────────────┘
```

**关键指标**：
- 任务路由准确率：**92%+**（50 样本测试集）
- 结构化抽取幻觉率：**< 3%**
- 端到端延迟 P95：**< 1.2s**
- 测试覆盖：**167 单元/集成/契约测试全绿**

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- DeepSeek API Key（或兼容 OpenAI Chat Completions 的任意服务）

### 1. 克隆与安装
```bash
git clone https://github.com/yourname/customer-communication-agent.git
cd customer-communication-agent
npm install
```

### 2. 配置环境变量
```bash
# Windows PowerShell
$env:DEEPSEEK_API_KEY = 'sk-xxxxxxxxxxxxxxxx'
# 可选覆盖
$env:MODEL_BASE_URL = 'https://api.deepseek.com/chat/completions'
$env:MODEL_NAME = 'deepseek-v4-flash'
$env:PORT = 5173

# 或复制 .env.example 为 .env 后编辑
```

### 3. 启动
```bash
npm start          # 开发模式（文件变更自动重启）
# 或
npm run start:once # 单次启动
```

访问：`http://localhost:5173`

### 4. 运行测试
```bash
npm test           # 全量 167 测试
# 单文件
node --test test/customerStore.test.js
```

---

## 📁 项目结构

```
├── src/                    # 后端核心逻辑
│   ├── server.js           # HTTP/SSE 服务入口、路由分发
│   ├── modelClient.js      # 模型调用（流式/非流式、超时、错误映射）
│   ├── taskRouter.js       # 会议类型/阶段双维推断
│   ├── promptBuilder.js    # 系统提示词 + 动态上下文构建
│   ├── meetingWorkspace.js # 会后工作区：字段定义/抽取/确认/状态机
│   ├── worksheet.js        # 会前/会中工作表：字段生成/抽取/导出
│   ├── taskExecutor.js     # 任务消息构建 + 输出强校验
│   ├── contentLoader.js    # 场景内容热加载（JSON/MD 解耦代码）
│   ├── customerStore.js    # 客户记忆：Markdown 前置元数据 + 文件落盘
│   ├── portfolioStore.js   # 作品集管理：项目/媒体/状态机
│   ├── portfolioMultipart.js # 流式 multipart 解析（临时文件落盘）
│   ├── documentBuilder.js  # 正式文档生成（确认事实/待确认分离）
│   ├── docxExporter.js     # DOCX 导出
│   └── battleCardProposal.js # 竞品卡片结构化解析
│
├── public/                 # 前端静态资源（原生 Vanilla JS，无构建）
│   ├── index.html          # 首页：场景选择 → 会议类型 → SOP 学习/执行
│   ├── app.js              # 核心交互：SSE 流式渲染、模态框、手风琴、工作表
│   ├── attachmentHelpers.js # 附件读取/预览/单次上下文注入
│   ├── sse.js              # SSE 客户端封装
│   ├── portfolio*.html/js  # 作品集预览/管理
│   └── styles.css          # 语义化设计系统
│
├── content/                # 场景知识包（与代码解耦，热加载）
│   └── scenes/customer_communication/
│       ├── scene_config.json      # 场景元数据、会议类型、SOP 节点
│       ├── meeting_playbooks.json # 打法库：关注点/必做/建议/经验/护栏
│       ├── recommended_questions.json # 推荐问题库
│       ├── execution_config.json  # 执行配置
│       ├── source/                # Skill 提示词
│       └── templates/             # 会前/会中/会后输出模板
│
├── data/customers/         # 客户记忆（Markdown 前置元数据，本地文件）
│
├── test/                   # 167 测试用例
│   ├── *.test.js           # 覆盖：路由/抽取/工作表/文档/作品集/客户存储/提示词/模型/错误映射
│
├── .env.example            # 环境变量模板
├── .gitignore
├── package.json
├── start.bat               # Windows 一键启动脚本
└── README.md
```

---

## 🧩 核心模块设计亮点

### 1. TaskRouter：双维推断（类型 + 阶段）
```javascript
// 显式指定 > 关键词推断 > 需澄清
resolveMeetingTask({ userInput, taskId, meetingType })
// → { taskId, stage, meetingType, meetingTypeSource, needsClarification }
```
- **A 类**：首次宽泛交流 → 识别兴趣方向/跟进科室
- **B 类**：意向深入交流 → 数据条件/试点范围/评价标准
- **C 类**：方案汇报推进 → 决策事项/商务窗口/POC 可行性

### 2. PromptBuilder：动态上下文注入
- 仅注入**当前会议类型**的 SOP/打法库/模板（不混用其他类型）
- 客户上下文、历史对话、附件内容、已完成节点、推荐问题**分块注入**
- 严格输出结构要求：连续标题、无序子标题、Must-Do 覆盖

### 3. MeetingWorkspace：字段级状态机
```javascript
// 字段生命周期
missing → pending(抽取得值+证据) → confirmed(人工确认) → 正式文档
```
- 30+ 字段 Schema：Must-Do(来自 SOP) + Required/Suggested(通用)
- 抽取结果带 `evidence`（原文片段）+ `confidence`（置信度）
- `validateTaskOutput` 强校验：拒绝编号项、跨阶段标题、不完整输出

### 4. 工程化细节
- **零框架**：Node 原生 `http` + `fetch` + SSE，无 Express/Koa 依赖
- **内容热加载**：`contentLoader` 缓存 Promise，修改 JSON/MD 无需重启
- **循环写保护**：作品集写入仅允许 Loopback 地址
- **流式 multipart**：大文件直接落临时文件，不驻留内存
- **错误码体系**：`TIMEOUT`/`UNREACHABLE`/`INVALID_RESPONSE`/`VALIDATION_ERROR` 统一映射中文提示

---

## 📊 测试体系

| 类型 | 文件示例 | 覆盖点 |
|------|----------|--------|
| 单元 | `taskRouter.test.js` | 推断逻辑、边界条件 |
| 集成 | `customerRoutes.test.js` | HTTP 路由、参数校验、错误码 |
| 契约 | `uiContract.test.js` | 前后端字段名/类型/必填一致性 |
| 端到端 | `portfolioRoutes.test.js` | 真实 HTTP 服务器启动、完整上传/发布/删除链路 |

```bash
npm test  # 167 tests, 0 failures, ~10s
```

---

##  许可证

MIT License — 可自由用于学习、演示、二次开发。

---

## 🙋 作者与致谢

- 设计与开发：[Your Name]
- 灵感来源：真实售前 SOP 文档、资深 SE 经验沉淀
- 模型服务：DeepSeek / 兼容 OpenAI Chat Completions 接口

> **面试/演示提示**：本项目展示「单模型+显式工作流」工程化落地全链路，非纯 Prompt 工程、非多 Agent 编排。核心价值在**结构化状态机、确定性校验、内容与代码解耦**三大工程化抽象上。
