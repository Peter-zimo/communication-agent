# 客户记忆（Markdown Frontmatter）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让售前智能体具备轻量客户记忆能力——每次会议结束后自动生成 Markdown 客户档案，下次同一客户开会时自动加载历史上下文，为人提供更完整的判断素材。

**Architecture:** 新增 `customerStore.js` 模块负责 Markdown 文件的读写（frontmatter 解析 + 正文生成），通过新增 API 端点暴露客户列表和历史加载能力，在会后流程中自动写入，在会前/对话流程中自动注入历史上下文。前端增加客户选择入口。

**Tech Stack:** Node.js 原生 fs、`gray-matter`（frontmatter 解析）、现有测试框架 `node:test`。

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 新建 | `src/customerStore.js` | 客户 Markdown 文件的 CRUD：列出、读取、写入、查找 |
| 新建 | `test/customerStore.test.js` | customerStore 的完整测试 |
| 修改 | `src/server.js` | 新增客户相关 API 路由 |
| 修改 | `src/promptBuilder.js` | 在对话 prompt 中注入客户历史上下文 |
| 修改 | `public/index.html` | 前端增加客户选择/历史加载入口（最小改动） |
| 新建 | `data/customers/` | 客户 Markdown 文件存储目录（运行时自动创建） |

---

## Global Constraints

- 零新依赖原则：frontmatter 解析自行实现（简单 YAML 子集），不引入 `gray-matter` 等外部包
- 文件命名规范：`{客户名}-{会议类型}-{日期}.md`，如 `XX集团-A-20260818.md`
- 客户名来源：intake 阶段的 `customerName` 字段
- 存储位置：项目根目录下 `data/customers/`
- 不做并发控制，不加锁——单用户本地工具，YAGNI
- Markdown 文件既是机器数据源也是人可读文档，保持格式整洁

---

### Task 1: 实现 customerStore.js 核心模块

**Files:**
- Create: `src/customerStore.js`
- Create: `test/customerStore.test.js`

**Interfaces:**
- Consumes: 无（独立模块）
- Produces:
  - `listCustomers()` → `Array<{ name, file, updatedAt }>`
  - `readCustomerHistory(customerName)` → `object | null`（frontmatter 结构化数据 + 正文）
  - `saveCustomerHistory(customerName, data)` → `void`
  - `buildCustomerMarkdown(data)` → `string`（生成 Markdown 文本）
  - `parseCustomerMarkdown(text)` → `object`（解析 Markdown 到结构化数据）

- [ ] **Step 1: 编写测试**

为以下场景编写测试：
- `parseCustomerMarkdown` 能从 frontmatter 解析出字段，正文保持完整
- `buildCustomerMarkdown` 生成的文件包含正确的 frontmatter 和正文结构
- `listCustomers` 返回 `data/customers/` 下所有 `.md` 文件，按更新时间排序
- `readCustomerHistory` 能读取指定客户名的最新文件，不存在时返回 null
- `saveCustomerHistory` 写入文件后可被 `readCustomerHistory` 读回
- 文件名包含客户名、会议类型和日期，文件名中的特殊字符被安全处理

- [ ] **Step 2: 实现 `parseCustomerMarkdown(text)`**
  - 解析 `---` 之间的 YAML frontmatter 为对象
  - `---` 之后的正文作为 `body` 字段返回
  - 简单 YAML 子集：只处理 `key: value` 键值对，不处理嵌套数组（用逗号分隔的字符串代替）

- [ ] **Step 3: 实现 `buildCustomerMarkdown(data)`**
  - 输入对象包含 frontmatter 字段和 `body` 正文
  - 输出格式：
    ```markdown
    ---
    客户: XX集团
    行业: 制造业
    会议类型: A
    阶段: 初步交流
    决策人: 张总
    上次交流: 2026-08-18
    ---
    ## 会后总结
    - ...
    ## 待办
    - [ ] ...
    ```

- [ ] **Step 4: 实现 `listCustomers()`**
  - 扫描 `data/customers/` 目录，返回所有 `.md` 文件
  - 按修改时间倒序排列
  - 返回格式：`[{ name: 'XX集团', file: 'XX集团-A-20260818.md', updatedAt: '...' }]`
  - 客户名从文件名中解析（去掉会议类型和日期后缀）
  - 同一客户有多个文件时，只返回最新的一个

- [ ] **Step 5: 实现 `readCustomerHistory(customerName)`**
  - 在 `data/customers/` 下查找该客户名的最新文件
  - 调用 `parseCustomerMarkdown` 解析并返回
  - 文件不存在时返回 null

- [ ] **Step 6: 实现 `saveCustomerHistory(customerName, data)`**
  - 自动生成文件名（客户名 + 会议类型 + 当天日期）
  - 调用 `buildCustomerMarkdown` 生成文本
  - 确保 `data/customers/` 目录存在后写入文件
  - 如果同名文件已存在，追加日期后缀避免覆盖（或更新已有文件，取决于设计选择：**推荐更新同客户同类型最新文件**）

- [ ] **Step 7: 运行测试，确保全部通过**

---

### Task 2: 新增客户相关 API 端点

**Files:**
- Modify: `src/server.js`
- Create: `test/customerRoutes.test.js`

**Interfaces:**
- Consumes: `customerStore.js` 的所有导出函数
- Produces:
  - `GET /api/customers` → 客户列表
  - `GET /api/customers/:name/history` → 指定客户的历史档案

- [ ] **Step 1: 编写路由测试**
  - `GET /api/customers` 返回客户列表数组
  - `GET /api/customers/{name}/history` 返回客户历史数据（或 404）
  - 空客户列表时返回空数组

- [ ] **Step 2: 在 server.js 中添加路由**
  - `GET /api/customers`：调用 `listCustomers()`，返回 JSON
  - `GET /api/customers/{name}/history`：URL 解码客户名，调用 `readCustomerHistory()`，有数据返回 200，无数据返回 404
  - 文件名中的中文需支持 URL 编码（`encodeURIComponent`）

- [ ] **Step 3: 运行测试，确保全部通过**

---

### Task 3: 会后流程自动保存客户档案

**Files:**
- Modify: `src/server.js`（会后执行端点增加保存逻辑）
- Modify: `test/customerRoutes.test.js`（增加保存相关的测试）
- Create: `test/customerSaveOnComplete.test.js`

**Interfaces:**
- Consumes: `customerStore.saveCustomerHistory()`、现有的 `workspace` 数据结构
- Produces: 会后生成文档时自动保存 Markdown 文件到 `data/customers/`

- [ ] **Step 1: 编写测试**
  - 当 workspace 中有确认的会议数据时，调用 `/api/scenes/customer_communication/execution/generate` 后会自动保存客户文件
  - 保存的文件 frontmatter 包含：客户名、会议类型、阶段、决策人、日期
  - 保存的文件正文包含：会后总结、待办项（从 workspace fields 中提取）

- [ ] **Step 2: 实现提取逻辑**
  - 从 `workspace` 中提取客户名（查找 `customerName` 或 intake 字段）
  - 从 workspace fields 中提取已确认的关键信息生成正文
  - 提取待办项（`internal_actions`、`customer_actions`、`next_step` 等字段）

- [ ] **Step 3: 在 server.js 的 generate 端点中添加保存调用**
  - 生成文档后，自动调用 `saveCustomerHistory`
  - 保存失败不应阻断文档生成流程（try-catch 静默处理）

- [ ] **Step 4: 运行测试，确保全部通过**

---

### Task 4: 对话 prompt 注入客户历史上下文

**Files:**
- Modify: `src/promptBuilder.js`
- Modify: `test/promptBuilder.test.js`

**Interfaces:**
- Consumes: 客户历史数据（通过 request 参数传入）
- Produces: 对话 prompt 中增加客户历史上下文块

- [ ] **Step 1: 编写测试**
  - 当 `request.customerHistory` 存在时，prompt 中包含历史上下文块
  - 历史上下文块的格式为：`【客户历史背景】` 标题 + frontmatter 字段 + 正文摘要
  - 当 `request.customerHistory` 为 null 或不存在时，prompt 不受影响
  - 历史上下文不超过 2000 字符，超出时截断正文并标注"（内容已精简）"

- [ ] **Step 2: 在 buildChatMessages 中注入历史上下文**
  - 检查 `request.customerHistory` 是否存在
  - 如果存在，构建历史上下文块，插入到 system prompt 的合适位置（在场景 SOP 之前）
  - 格式：
    ```
    【客户历史背景（来自上次交流）】
    客户: XX集团
    行业: 制造业
    上次交流: 2026-08-10
    阶段: 方案深入
    
    ## 上次会后总结
    - 客户对准确率有顾虑...
    ## 待办
    - [x] 已提交 PoC 方案
    - [ ] 等待客户反馈
    ```

- [ ] **Step 3: 修改 chat-stream 端点传递客户历史**
  - 在 `server.js` 的 chat-stream 和 chat 路由中，如果请求包含 `customerName`，自动查询客户历史并注入到 request 中

- [ ] **Step 4: 运行测试，确保全部通过**

---

### Task 5: 前端最小改动——客户选择入口

**Files:**
- Modify: `public/index.html`
- Create: `test/uiContract.test.js`（追加客户选择相关的 UI 断言）

**Interfaces:**
- Consumes: `GET /api/customers` 和 `GET /api/customers/:name/history`
- Produces: 首页展示客户列表，选择后自动填充 intake 表单并加载历史上下文

- [ ] **Step 1: 编写 UI 断言测试**
  - 首页渲染时显示"选择已有客户"区域
  - 客户列表从 `/api/customers` 获取
  - 选择客户后，`customerName` 字段自动填充
  - 选择客户后，请求 `/api/customers/{name}/history` 获取历史

- [ ] **Step 2: 在 index.html 中添加客户选择区域**
  - 在 intake 表单上方添加一个紧凑的下拉框或列表
  - 页面加载时调用 `GET /api/customers` 填充列表
  - 选择客户后自动填充 `customerName` 字段
  - 同时将历史数据存入 `sessionStorage`，后续对话请求携带

- [ ] **Step 3: 对话请求携带 customerHistory**
  - 在 AI 对话发送时，如果当前有选中的客户，从 sessionStorage 读取历史数据附加到请求体

- [ ] **Step 4: 运行测试，确保全部通过**

---

### Task 6: 集成验证与清理

**Files:**
- Modify: `test/customerStore.test.js`（补充边界用例）
- Modify: `test/customerRoutes.test.js`（补充边界用例）

- [ ] **Step 1: 运行全部测试**
  ```powershell
  npm test
  ```

- [ ] **Step 2: 手动验证端到端流程**
  1. 启动服务：`npm start`
  2. 打开首页，选择一个客户名（如"测试客户"），填写 intake 信息
  3. 进入工作台，进行 AI 对话
  4. 完成会后流程，生成文档
  5. 确认 `data/customers/` 下生成了对应的 `.md` 文件
  6. 刷新页面，选择同一个客户，确认 intake 自动填充
  7. 开始新对话，确认 AI 能看到上次的历史上下文

- [ ] **Step 3: 检查 .gitignore**
  - 确认 `data/customers/` 已加入 `.gitignore`（客户数据不应提交到代码仓库）

- [ ] **Step 4: 更新 README.md**
  - 补充客户记忆功能的使用说明
  - 说明文件存储位置和格式
