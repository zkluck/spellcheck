# AI 中文文本检测系统

这是一个基于 Next.js 和 LangChain 多阶段（Basic（含 Fluency）+ Reviewer）架构构建的 AI 中文文本检测系统，可以帮助用户检测并修正文本中的语法、拼写、标点和流畅（表达优化）问题。

## 功能特点

- **多阶段检测**：系统按阶段执行（Basic、Fluency〈并入 Basic〉、Reviewer），分别负责检测不同类型的文本问题（是否执行 Reviewer 由后端 `WORKFLOW_PIPELINE` 决定；Fluency 为 Basic 的内置子流程，不出现在 pipeline 中）

  - 基础错误智能体（BasicErrorAgent）：检测拼写、标点、基础语法等客观错误
  - 流畅阶段（Fluency，Basic 内置）：检测语义通顺、冗余重复与表达优化问题
  - 顺序编排（CoordinatorAgent）：先运行 Basic 并对原文做临时修复与索引映射，再在修复文本上执行 Basic 内置的 Fluency 阶段，将 Fluency 结果安全映射回原文索引；合并后可交由 Reviewer 审阅。

- **结果保全与来源标记**：同时保留 Basic 与 Fluency 的全部错误候选，供用户选择；每条错误都带有 `metadata.source`（`basic`/`fluent`）。

- 兼容说明：`fluent` 仅为来源标签（为保证日志与 SSE 兼容而保留），并非独立 Agent；Fluency 为 Basic 的内置子阶段。

- 审阅阶段由后端工作流配置控制：通过环境变量 `WORKFLOW_PIPELINE` 决定是否执行 Reviewer。前端不提供开关。

- **实时编辑**：用户可以在编辑器中直接输入文本，并获得即时的检测结果

- **一键修正**：对于检测到的问题，系统会提供修正建议，用户可以一键应用

- **高亮显示**：在编辑器中直接高亮显示存在问题的文本，方便用户定位

- **流式回调**：后端在 `analyzeText()` 中支持流式回调，按阶段推送 `basic`、`fluent`、`reviewer` 的结果片段，便于前端分栏实时渲染。

## 技术栈

- **前端**：Next.js 14 + React 18 + TypeScript 5 + SCSS（BEM 规范，无 & 嵌套）
- **后端**：Next.js App Router API Routes（Node 环境）
- **AI**：LangChain 0.1.x 多阶段串联（Basic〈含 Fluency 子阶段〉→ Reviewer，是否执行 Reviewer 由 `WORKFLOW_PIPELINE` 决定），统一 LLM 保护调用（`guardLLMInvoke`），令牌桶限流（`llm-guard.ts`）
- **运行时校验**：Zod（API 入参与出参严格校验）
- **日志**：结构化 logger（`src/lib/logger.ts`）
- **配置**：统一配置模块（`src/lib/config.ts`，支持 .env）
- **测试**：Vitest（单元 tests/unit 与集成 tests/integration）
- **质量**：Husky + lint-staged（提交前 lint 和类型检查）

## 安装与运行

### 前提条件

- Node.js 18.0.0 或更高版本
- npm 或 yarn 包管理器
- OpenAI API 密钥（用于 LangChain 智能体）

### 安装步骤

1. 克隆仓库

```bash
git clone <仓库地址>
cd spellcheck
```

2. 安装依赖

```bash
npm install
# 或
yarn install
```

3. 配置环境变量

创建`.env.local`文件并添加以下内容：

```
# OpenAI / 第三方 API（必需）
OPENAI_API_KEY=your_openai_api_key
# 若使用第三方网关，可设置 Base URL
OPENAI_BASE_URL=your_openai_base_url

# 后端分析
ANALYZE_TIMEOUT_MS=8000    # analyzeText 超时（毫秒）

# 前端公开配置（浏览器可读，勿放敏感信息）
NEXT_PUBLIC_MAX_RETRIES=3
NEXT_PUBLIC_SSE_IDLE_MS=20000
NEXT_PUBLIC_BASE_DELAY_MS=600
NEXT_PUBLIC_TOTAL_TIMEOUT_MS=60000
NEXT_PUBLIC_BACKOFF_MIN_MS=400
NEXT_PUBLIC_BACKOFF_MAX_MS=8000

# E2E 测试（本地/CI 使用；生产请勿开启）
E2E_ENABLE=0
```

## 环境变量说明

- **后端**（`src/lib/config.ts`）

  - `ANALYZE_TIMEOUT_MS`：`analyzeText` 超时时间（毫秒）。
  - `E2E_ENABLE`：启用 E2E 场景模拟的后端分支，仅供本地/CI。
  - `MERGE_CONFIDENCE_FIRST`：合并时是否优先高置信度（`true|false`，默认 `true`）。对应 `config.langchain.merge.confidenceFirst`。
  - `WORKFLOW_PIPELINE`：多智能体顺序与次数配置（Fluency 已并入 Basic，不在 pipeline 中）。语法示例：`"basic*2, reviewer*1"`；可用 agent：`basic | reviewer`；省略 `*n` 等同 `*1`。默认：`basic*1,reviewer*1`。
  - 日志相关（`src/lib/logger.ts`）：`LOG_TO_FILE`（默认 Node 环境为 `true`）、`LOG_DIR`（默认 `logs`）、`LOG_FILE_PREFIX`（默认 `app`）、`LOG_FILE_LEVEL`（`debug|info|warn|error`，默认 `info`）。
  - 日志负载开关（`src/lib/config.ts`）：`LOG_ENABLE_PAYLOAD`（是否输出示例内容，如错误样例与建议；默认 `false`，生产建议保持关闭）。

- **模型/LLM**（`src/lib/langchain/models/llm-config.ts`）

  - 通用模型：`OPENAI_MODEL`、`OPENAI_TEMPERATURE`、`OPENAI_MAX_TOKENS`、`OPENAI_TIMEOUT_MS`、`OPENAI_MAX_RETRIES`。
  - 轻量模型：`OPENAI_LIGHT_MODEL`、`OPENAI_LIGHT_TEMPERATURE`、`OPENAI_LIGHT_MAX_TOKENS`、`OPENAI_LIGHT_TIMEOUT_MS`、`OPENAI_LIGHT_MAX_RETRIES`。
  - 公共：`OPENAI_API_KEY`（必填）、`OPENAI_BASE_URL`（可选第三方网关）。

- **前端公开配置**（`src/lib/feConfig.ts`）

  - `NEXT_PUBLIC_MAX_RETRIES`、`NEXT_PUBLIC_SSE_IDLE_MS`、`NEXT_PUBLIC_BASE_DELAY_MS`、`NEXT_PUBLIC_TOTAL_TIMEOUT_MS`、
    `NEXT_PUBLIC_BACKOFF_MIN_MS`、`NEXT_PUBLIC_BACKOFF_MAX_MS`。

- 提示
  - 生产环境不要启用 `E2E_ENABLE`。
  - 完整清单与默认值见 `.env.example`。

4. 启动开发服务器

```bash
npm run dev
# 或
yarn dev
```

5. 打开浏览器访问 `http://localhost:3000`

## 使用方法

1. **输入文本**：在左侧编辑器区域输入或粘贴需要检查的中文文本
2. **开始检测**：点击"检查文本"按钮，系统将开始分析文本
3. **查看结果**：右侧面板将显示检测到的问题列表，包括问题类型、描述和修正建议
4. **应用修正**：
   - 点击右侧面板中的问题可以在编辑器中高亮显示对应文本
   - 点击"应用"按钮可以自动应用修正建议
   - 也可以在编辑器中直接修改文本

## 快捷键

- `Ctrl + Enter`：开始文本检测
- `Tab`：在检测结果之间切换
- `Enter`：应用当前选中的修正建议

## API 契约

- 路径：`POST /api/check`
- 请求体（Zod 校验）：

```json
{
  "text": "需要检查的文本",
  "options": {
    "enabledTypes": ["grammar", "spelling", "punctuation", "fluency"]
  }
}
```

- 成功响应：

```json
{
  "errors": [
    {
      "id": "string",
      "start": 0,
      "end": 5,
      "text": "错误片段",
      "suggestion": "建议",
      "type": "grammar",
      "explanation": "可选解释",
      "metadata": { "source": "basic" } // 来源标记：basic/fluent
    }
  ],
  "meta": {
    "elapsedMs": 123,
    "enabledTypes": ["grammar", "spelling"]
  }
}
```

- 失败响应示例（参数不合法）：

```json
{
  "error": "请求参数不合法",
  "details": {}
}
```

### SSE 流式协议

- 当请求头 `Accept: text/event-stream` 时，后端返回 SSE 流。
- 事件格式：

```text
:ready                      # 首个注释，帮助代理尽快建立流
:keep-alive                 # 每 15s 心跳一次
data: {"type":"chunk","agent":"basic","errors":[...]}
data: {"type":"chunk","agent":"fluent","errors":[...]}
data: {"type":"chunk","agent":"reviewer","errors":[...]}
data: {"type":"warning","agent":"reviewer","message":"..."}
data: {"type":"final","errors":[...],"meta":{"elapsedMs":123,"enabledTypes":[...]}}
data: {"type":"error","code":"aborted|internal","message":"...","requestId":"..."}
```

- 注意：所有 `errors` 元素已按 `ErrorItemSchema` 进行二次校验与清洗。

### Schema 统一（Zod）

- 公共 Schema 集中于 `src/types/schemas.ts`：
  - 基础：`EnabledTypeEnum`、`AnalyzeOptionsSchema`、`AnalyzeRequestSchema`、`CoordinatorAgentInputSchema`。
  - Agent 通用：`AgentPreviousSchema`、`AgentInputWithPreviousSchema`。
  - Reviewer：`ReviewerCandidateSchema`、`ReviewerInputSchema`、`ReviewDecisionSchema`。
- 错误项 Schema：`src/types/error.ts` 导出 `ErrorItemSchema` 与 `ErrorItem` 类型。
- 复用范围：
  - API 路由 `src/app/api/check/route.ts` 与 `CoordinatorAgent` 统一复用公共 Schema。
  - `BasicErrorAgent.ts`（含 Fluency 子阶段）输入复用 `AgentInputWithPreviousSchema`；
  - `ReviewerAgent.ts` 输入/裁决复用 `ReviewerInputSchema` / `ReviewDecisionSchema`；
  - `CoordinatorAgent.ts` 构造传给各 Agent 的参数均为强类型（无 `any`），传 Reviewer 的 candidates 结构与共享类型保持一致。
- 前端/共享类型：`src/types/agent.ts` 的 `AnalyzeOptions` 直接引用 `EnabledType`，与 Zod 枚举保持一致。
- Reviewer 开关已完全移除：是否执行 Reviewer 仅由 `WORKFLOW_PIPELINE` 及 `enabledTypes` 决定。

### API 契约导出（JSON Schema）

- 我们提供 `zod` → `JSON Schema` 的一键导出脚本，便于前端/第三方对接与文档同步：

```bash
# 安装（仅一次）
npm i -D tsx zod-to-json-schema

# 生成所有公共契约
npm run gen:schema
```

- 输出路径：`schemas/json/*.schema.json`
  - 覆盖：`AnalyzeRequest`、`CoordinatorAgentInput`、`AgentInputWithPrevious`、`ReviewerInput`、`ReviewDecision`、`ErrorItem`、`AgentResponse` 等。
  - 生成脚本：`scripts/generate-schemas.ts`
- 建议在 CI 中加入校验步骤，确保 PR 未遗漏契约更新：

```bash
npm run gen:schema
git diff --exit-code schemas/json || (echo "Schemas changed. Commit generated schemas." && exit 1)
```

## 日志与可观测性

- **统一日志**：后端统一使用 `src/lib/logger.ts` 的结构化日志；API 路由与多智能体均输出到控制台与可选文件。
- **请求关联 ID**：
  - 支持读取请求头 `X-Request-Id`，若无则自动生成；在响应头也会回传。
  - 日志中字段为 `reqId`，可用于跨层追踪（API → analyze → agents）。
- **事件命名规范（点分式）**：
  - API 路由（`src/app/api/check/route.ts`）
    - `api.check.request.received`、`api.check.request.bad_request`、`api.check.pipeline`、`api.check.e2e.scenario.detected`
    - `api.check.json.start`、`api.check.json.done`
    - `api.check.sse.start`、`api.check.sse.chunk`、`api.check.sse.final`、`api.check.sse.error`、`api.check.sse.close`
    - 未处理错误：`api.check.unhandled_error`
  - 分析核心（`src/lib/langchain/index.ts`）
    - `analyze.start`、`analyze.done`、`analyze.error`
  - 协调器与智能体（`src/lib/langchain/agents/coordinator/CoordinatorAgent.ts`）
    - `agent.basic.run.summary`、`agent.basic.run.error`
    - `agent.fluent.run.summary`、`agent.fluent.run.error`
    - `agent.reviewer.run.summary`、`agent.reviewer.run.error`
    - 通用失败：`agent.failed`（包含 `agent` 字段）
- **敏感负载控制**：
  - 通过 `LOG_ENABLE_PAYLOAD=false`（默认）避免在日志记录示例文本与建议。
  - 开发/调试场景可临时设为 `true`，生产环境务必保持 `false`。
- **查看日志**：
  - 控制台：开发环境直接查看终端输出。
  - 文件：当 `LOG_TO_FILE=true` 时，日志写入 `logs/` 目录，文件名形如 `app-YYYY-MM-DD.log`。
    - Windows PowerShell 实时查看：
      ```powershell
      Get-Content -Path .\logs\app-*.log -Wait
      ```
    - 常用字段：`ts`（时间戳）、`level`、`event`、`reqId`、`ip`、其他上下文字段。

## 部署

本项目可以部署到 Vercel、Netlify 等支持 Next.js 的平台：

```bash
# 构建生产版本
npm run build
# 或
yarn build

# 本地预览生产版本
npm run start
# 或
yarn start
```

## 项目结构

```
spellcheck/
├── src/
│   ├── app/                    # Next.js 应用目录
│   │   ├── api/
│   │   │   └── check/          # 文本检测 API（入参与出参 Zod 校验）
│   │   ├── globals.scss        # 全局样式（BEM 规范）
│   │   ├── layout.tsx
│   │   └── page.tsx
 │   ├── components/             # 组件目录（BEM 命名、无 & 嵌套）
 │   │   ├── ControlBar/
 │   │   ├── Home/
 │   │   ├── ResultPanel/
 │   │   ├── TextEditor/
 │   │   └── （已清理未使用的示例组件 AnalyzerPanel.tsx）
 │   ├── lib/
 │   │   ├── config.ts           # 统一配置（读取 .env）
│   │   ├── logger.ts           # 结构化日志
│   │   └── langchain/
│   │       ├── index.ts        # analyzeText（超时保护、结构化日志、流式回调）
│   │       ├── merge.ts        # 错误合并策略（去重/冲突解决/类型优先级）
│   │       ├── utils/
│   │       │   ├── llm-guard.ts   # 统一 LLM 调用保护（重试/超时/限流）
│   │       │   └── llm-output.ts  # LLM 输出解析与健壮性处理
│   │       └── agents/         # 多智能体实现
│   │           ├── coordinator/CoordinatorAgent.ts  # 顺序编排与索引映射
│   │           ├── basic/BasicErrorAgent.ts         # 基础错误检测 + Fluency 子阶段
│   │           └── reviewer/ReviewerAgent.ts        # 审阅与最终裁决（由 WORKFLOW_PIPELINE 控制，前端无开关）
│   └── types/                  # 类型定义（ErrorItem/AnalyzeOptions 等）
├── tests/
│   ├── unit/                   # 单元测试（Vitest）
│   ├── integration/            # 集成测试（含 /api/check）
│   └── e2e/                    # 端到端测试（Playwright）
├── .github/
│   └── workflows/ci.yml        # CI 工作流（构建、单测、安装浏览器、E2E）
├── playwright.config.ts        # Playwright 配置
├── .env.example                # 环境变量示例
├── next.config.js              # Next.js 配置
├── package.json                # 项目依赖与脚本
├── tsconfig.json               # TypeScript 配置
└── vitest.config.ts            # Vitest 配置
```

## 扩展与定制

### 添加新的检测智能体

1. 在`src/lib/langchain/agents`目录下创建新的智能体实现
2. 在 `src/lib/langchain/agents/coordinator/CoordinatorAgent.ts` 中接入新智能体（当前 pipeline 仅解析 `basic|reviewer`，新增类型需同步扩展解析与协调逻辑）

3. 在前端界面中添加对应的选项和显示逻辑

### 架构与执行流程

 1. BasicErrorAgent 在原文上检测，返回基础错误候选（spelling/punctuation/grammar）。
 2. 将基础候选进行去重与冲突解决（`mergeErrors()`），应用非重叠修复以生成“临时修复文本”，并构建“修复文本索引 → 原文索引”的映射。
 3. 在临时修复文本上执行 Basic 内置的 Fluency 子阶段，产出的索引通过映射回投至原文坐标系。
 4. 合并 Basic 与 Fluency 的候选（`metadata.source` 仍区分为 `basic|fluent`），若后端工作流 `WORKFLOW_PIPELINE` 包含 reviewer 节点，则交由 Reviewer 审阅（accept/reject/modify），否则直接合并返回。

5. 最终使用 `mergeErrors()` 产出稳定、无冲突的结果列表。

### 智能体 Prompt 规范（关键约束）

#### BasicErrorAgent（基础错误）

- **检测范围**：
  - spelling：错别字、同音/近形误用。
  - punctuation：全角/半角混用、成对标点不匹配、重复或多余标点、类型错误。
  - grammar：明显量词错误、主谓搭配明显不当、成分残缺/重复（客观可判定）。

- **排除**：风格/语气/主观优化、需外部知识推断的改写、纯“缺失标点”的插入类修改。

- **输出**（仅 JSON 数组）：对象字段
  - `type`: `"spelling" | "punctuation" | "grammar"`
  - `text`, `start`, `end`, `suggestion`, `description`, `quote`（与 text 一致）, `confidence?`(0~1)

- **索引/编辑规则**：
  - UTF-16 计数；`original.slice(start, end) === text`；`end > start`。
  - 禁止空区间“纯插入”；如需插入，使用相邻的最小可替换片段实现等价插入。
  - 最小编辑；不做大段重写；避免重叠与重复；数量 ≤200。

#### Fluency（Basic 内置子阶段，流畅/表达）

- **检测范围**：语义通顺、语序更顺、常见搭配/用词更地道、重复与冗余精简、表达更清晰（不改变原意、最小编辑）。

- **排除**：所有基础错误（spelling/punctuation/grammar）、需要上下文推断的改写、风格化/主观改写。

- **输出**（仅 JSON 数组）：对象字段
  - `type: "fluency"`
  - `text`, `start`, `end`, `suggestion`（删除用空字符串）、`description`, `quote`（与 text 一致）, `confidence?`

- **索引/编辑规则**：与 Basic 相同；尤其禁止空区间“纯插入”，需以最小替换片段等价实现插入；去重与不重叠。

#### ReviewerAgent（审阅裁决）

- **输入**：Basic 与 Fluency 合并后的候选（含 `id`）。

- **决策**：对每个候选按 `id` 逐一 `accept | reject | modify`。
  - 不得新增候选；仅在提供的 `id` 集合内裁决。
  - `modify` 必须给出可验证的 `start/end/text/suggestion`（同 UTF-16 校验规则），遵循最小编辑与不重叠；可接受/微调 `fluency`，前提是不改变原意且可读性显著提升。

- **输出**（仅 JSON 数组）：统一 JSON 对象，字段遵循上述索引与最小编辑规则。

以上三者分工清晰：Basic 负责客观基础错误；Fluency 负责不改变原意的表达优化；Reviewer 进行最终一致性与质量裁决。

### 合并与优先级策略（`src/lib/langchain/merge.ts`）

- 去重：按 `start:end:text` 聚类，跨类型比较。
- 类型优先级（数值越高越优先）：`spelling(4) > punctuation(3) > grammar(2) > fluency(1)`。
- 冲突（区间重叠）解决：优先更短片段，其次解释信息量（`explanation` 长度），再按类型优先级，最后保持先到者稳定性。

### 前端集成建议

- 使用 `analyzeText(text, options, streamCallback)`：
  - `streamCallback` 将依次收到 `agent: 'basic' | 'fluent' | 'reviewer'` 的结果片段，便于分栏实时渲染。
  - 如需分栏演示，可自行创建示例组件（项目中已移除未使用的 AnalyzerPanel.tsx）。

### 测试建议

- `llm-output.ts`：回退定位不重复插入。
- `ReviewerAgent`：`modify` 决策索引边界校验。
- `CoordinatorAgent`：顺序编排与索引映射正确性（Basic 应用后 Fluency 映射回原文）。
- `merge.ts`：类型优先级与重叠裁决一致性。

## 测试与 CI

### 本地测试

- 类型检查

```bash
npm run type-check
```

- 单元测试

```bash
npm run test        # 一次性运行
npm run test:watch  # 监听模式
```

- 端到端测试（Playwright）

```bash
npx playwright install chromium  # 首次仅需一次，安装浏览器
npm run e2e                      # 运行 E2E
```

说明：E2E 测试将使用生产模式服务器，自动执行 `build + start` 并在端口 `3001` 启动；`baseURL` 为 `http://localhost:3001`。Playwright 会在启动被测服务时注入以下环境变量：

- `PORT=3001`
- `E2E_ENABLE=1`（仅用于本地/CI 的模拟场景分支）
- `NEXT_PUBLIC_SSE_IDLE_MS`, `NEXT_PUBLIC_TOTAL_TIMEOUT_MS`, `NEXT_PUBLIC_BASE_DELAY_MS`, `NEXT_PUBLIC_BACKOFF_MIN_MS`, `NEXT_PUBLIC_BACKOFF_MAX_MS`, `NEXT_PUBLIC_MAX_RETRIES`

如需调整端口或基址，请修改 `playwright.config.ts` 的 `use.baseURL` 与 `webServer.port`/`env.PORT`。

#### E2E 模拟场景触发方式

- 通过请求头或 Cookie 触发：
  - 请求头：`x-e2e-scenario: sse-garbage-then-final | long-stream | idle-no-final`
  - Cookie：`e2e_scenario=sse-garbage-then-final | long-stream | idle-no-final`
- 三种内置场景：
  - `sse-garbage-then-final`：先发一段非 JSON 垃圾数据，再发合法 final。
  - `long-stream`：先 `:ready`，延迟仅发一个 `chunk`，不发送 `final`，便于测试取消。
  - `idle-no-final`：仅发送 `:ready` 后保持空闲，不发送任何数据与 `final`。

### 持续集成（GitHub Actions）

- 工作流：`.github/workflows/ci.yml`
- 运行环境：Node.js 20，Ubuntu
- 步骤：依赖安装（`npm ci`）→ 类型检查（`npm run type-check`）→ 单元测试（`npm run test:ci`）→ 安装浏览器（`npx playwright install --with-deps chromium`）→ E2E（`npm run e2e`）。
- CI 中使用占位密钥 `OPENAI_API_KEY=dummy_for_ci_only` 以避免密钥缺失导致构建失败。E2E 使用模拟分支，不会发出真实请求。

### 常见问题排查

- “Response body object should not be disturbed or locked”：Next 开发模式在流式请求下可能出现。E2E 已切换至生产模式（`build + start`）避免该问题。
- 端口占用或超时：E2E 使用 `3001` 端口，确保空闲；或在 `playwright.config.ts` 修改端口与 `use.baseURL`。`webServer.timeout` 默认为 `120s`，可按需调整。
- 浏览器未安装：执行 `npx playwright install chromium`。

### 自定义检测规则

可以通过修改各智能体的实现来自定义检测规则和优先级。

## 贡献指南

欢迎提交问题报告和功能请求。如果您想贡献代码，请遵循以下步骤：

1. Fork 仓库
2. 创建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详情请参见 LICENSE 文件
