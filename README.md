# AI 中文文本检测系统

基于 Next.js + TypeScript + LangChain 构建的智能中文文本检测系统，提供高准确率的流畅性检测。

## 核心特性

- **智能检测**：流畅性检测（所有错误类型相关功能已完全移除）
- **执行模型（无串联）**：每个角色/每轮运行都基于初始文本执行，patchedText 仅用于展示与最终返回聚合
- **稳健流式 SSE**：:ready 预热、15s keep-alive 心跳、断连检测与资源清理
- **可取消与超时**：原生 AbortSignal，客户端断开即时中止；全局/角色级超时（ANALYZE_TIMEOUT_MS）
- **类型安全**：Zod 运行时校验 + TypeScript 零 any，响应体与事件显式类型化
- **可配置工作流**：通过 WORKFLOW_PIPELINE 配置角色与轮次（如 basic\*2）

## 🏗️ 系统架构

### 检测引擎

- **规则引擎**：基于正则表达式的快速检测，处理常见错误模式
- **LLM 智能体**：深度语义分析，处理复杂表达问题
- **后处理器**：智能合并结果，冲突解决，置信度过滤

<!-- 错误类型相关内容已移除 -->

## ⚙️ 执行模型与管线（非串联模式）

- **无串联**：`src/lib/roles/executor.ts` 中 `runPipeline()` 确保每个角色、每一轮都以入口文本为输入，不使用上一轮的修复作为下一轮输入。
- **patchedText 用途**：仅用于该轮展示与最终聚合返回，不影响后续运行输入。
- **runIndex**：所有流式事件都会携带 `runIndex`，便于前端按轮聚合展示。
- **工作流配置**：通过 `WORKFLOW_PIPELINE` 定义，如 `basic*2` 表示 basic 运行两次；请求体也可传入 `options.pipeline` 覆盖。

## 📖 使用方法

1. **输入文本**：在编辑器中输入需要检测的中文文本
2. **开始检测**：点击"检查文本"按钮或使用快捷键 `Ctrl + Enter`
3. **查看结果**：右侧面板显示检测到的问题和修正建议
4. **应用修正**：点击建议项一键应用修正，或手动编辑文本

> 提示：前端 ResultPanel 已移除“来源筛选”下拉；所有错误类型相关功能已完全移除。来源信息仍用于标签展示与内部统计。

### 快捷键

- `Ctrl + Enter`：开始检测
- `↑ / ↓`：在检测结果间切换上一条/下一条
- `Enter`：应用当前选中的修正建议
- `Delete / Backspace`：忽略当前选中的修正建议
- `Ctrl + Alt + Z`（Windows / Linux）或 `⌘ + ⌥ + Z`（macOS）：撤回修改

## 🚀 快速开始

### 环境要求

- Node.js 18+
- OpenAI API Key

### 安装运行

```bash
# 1. 克隆项目
git clone <repository-url>
cd spellcheck

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，设置 OPENAI_API_KEY

# 4. 启动开发服务器
npm run dev
```

访问 http://localhost:3000 开始使用。

### 核心环境变量

```bash
# 必需
OPENAI_API_KEY=your_api_key

# 可选 · 检测配置
# 错误类型相关阈值已移除

# 可选 · LangChain / 管线
ANALYZE_TIMEOUT_MS=60000                 # 全局/角色级超时（SSE/JSON 均生效）

# 多智能体工作流配置
# 仅支持 basic | reviewer
# 注意：该默认流水线可被 API 请求体中的 options.pipeline 临时覆盖。
WORKFLOW_PIPELINE="basic*1"              # 运行顺序与次数，示例："basic*2"
MERGE_CONFIDENCE_FIRST=1                 # 合并阶段优先高置信度

# 可选 · basic agent（src/lib/config.ts -> langchain.agents.basic）
BASIC_MIN_CONFIDENCE=0.9
BASIC_MAX_OUTPUT=300
BASIC_RETURN_PATCHED_TEXT=1              # 是否在响应中返回 patchedText
BASIC_REQUIRE_EXACT_INDEX=1
BASIC_ALLOW_LOCATE_FALLBACK=0

# 可选 · fluent（已移除）
# 所有错误类型相关功能已完全移除

# 可选 · 其他
OPENAI_BASE_URL=your_base_url            # 第三方 API 网关
E2E_ENABLE=0                             # 端到端测试开关（1 开启）
```

## 🛠️ 技术栈

- **前端**：Next.js 14 + React 18 + TypeScript 5 + SCSS
- **后端**：Next.js API Routes + Node.js
- **AI 引擎**：LangChain + OpenAI GPT
- **数据校验**：Zod 类型安全
- **测试框架**：Vitest + Playwright
- **代码质量**：ESLint + Prettier + Husky

## 🧪 测试

```bash
# 类型检查
npm run type-check

# 单元测试（全量/指定目录）
npm run test
npm run test:unit

# 端到端测试
npm run e2e
# 端到端测试（可视化/带头）
npm run e2e:ui
npm run e2e:headed

# 生成 JSON Schema（由 Zod 推导）
npm run gen:schema
```

## 📁 项目结构

```
spellcheck/
├── src/
│   ├── app/                     # Next.js 应用（`layout.tsx`、`globals.scss`、页面与路由）
│   │   └── api/check/           # 检测 API（SSE/JSON）
│   ├── components/              # React 组件
│   │   ├── ControlBar/
│   │   ├── Home/
│   │   ├── NavBar/
│   │   ├── PipelineEditor/
│   │   ├── ResultPanel/
│   │   └── TextEditor/
│   ├── lib/
│   │   ├── api/
│   │   ├── errors/
│   │   ├── feConfig.ts
│   │   ├── config.ts            # 环境配置与管线解析（WORKFLOW_PIPELINE 等）
│   │   ├── langchain/
│   │   ├── logger.ts
│   │   ├── roles/               # 角色注册、执行器（无串联）
│   │   ├── rules/
│   │   │   ├── engine.ts
│   │   │   └── postprocessor.ts
│   │   └── text/
│   └── types/                   # Zod Schemas（`src/types/schemas.ts`、`error.ts`）
├── tests/                       # Vitest / Playwright
└── examples/                    # 示例脚本
```

## 🔧 自定义配置

### 专业词典与规则扩展

默认词典/规则在 `src/lib/rules/engine.ts` 中维护。你可以：

- 直接在 `engine.ts` 扩展词典与规则；或
- 新建目录 `src/lib/rules/dictionaries/` 存放自定义词典模块，并在 `engine.ts` 中显式引入。

示例：

```typescript
// src/lib/rules/dictionaries/professional.ts（可自建）
export const professionalTerms = {
  technology: ['算法', '数据结构', '机器学习'],
  medical: ['诊断', '治疗', '症状'],
};

// src/lib/rules/engine.ts 中引入并使用
// import { professionalTerms } from './dictionaries/professional';
```

## 🚀 部署

```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm run start
```

支持部署到 Vercel、Netlify 等 Next.js 兼容平台。

## 📄 API 文档

### 非流式 JSON · POST `/api/check`

**请求体（Zod: `AnalyzeRequestSchema`）**

```json
{
  "text": "需要检查的文本",
  "options": {
    "pipeline": [{ "id": "basic", "runs": 2 }]
  }
}
```

注：所有错误类型相关功能已完全移除；“来源筛选”下拉已移除（来源信息仅用于标签与内部统计）。

**响应（TypeScript: `AnalyzeResponse`）**

```json
{
  "errors": [
    {
      "id": "string",
      "start": 0,
      "end": 5,
      "text": "错误片段",
      "suggestion": "修正建议",
      "metadata": { "confidence": 0.95, "source": "rule_engine" }
    }
  ],
  "patchedText": "（可选，取决于 BASIC_RETURN_PATCHED_TEXT）",
  "meta": {
    "elapsedMs": 123,
    "reviewer": {
      "ran": false,
      "status": "skipped",
      "counts": { "accepted": 0, "rejected": 0, "modified": 0 },
      "fallbackUsed": false
    },
    "warnings": ["reviewer:timeout"]
  }
}
```

错误码：客户端中止返回 499；超时返回 504。

### 流式 SSE · POST `/api/check`（请求头 `Accept: text/event-stream`）

服务会先发送注释 `:ready` 预热，并每 15s 发送 `:keep-alive` 心跳。

可能的事件：

- `data: { "type": "chunk", "agent": "basic", "errors": [...], "runIndex": 0, "isFinalOfRun": true? }`
- `data: { "type": "warning", "agent": "reviewer", "message": "..." }`
- `data: { "type": "final", "errors": [...], "meta": {...}, "patchedText": "..." }`
- `data: { "type": "error", "code": "aborted|internal", "message": "...", "requestId": "..." }`

示例 cURL（SSE）：

```bash
curl -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "测试文本",
    "options": { "pipeline": [{"id":"basic","runs":1}] }
  }' \
  http://localhost:3000/api/check
```

断连与超时：客户端断开会立即中止执行并关闭流；达到 `ANALYZE_TIMEOUT_MS` 时终止并发送 `error` 事件后关闭。

### E2E 调试场景（需 `E2E_ENABLE=1`）

通过请求头 `x-e2e-scenario` 注入：

- `sse-garbage-then-final`：先发非法数据，再发合法 final
- `long-stream`：长时间仅少量 chunk，便于测试前端取消
- `idle-no-final`：只发 `:ready` 不发 final，便于测试前端 idle 重试

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📜 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
