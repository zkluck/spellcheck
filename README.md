# 中文文本检测系统

这是一个基于 Next.js 和 LangChain 双智能体架构构建的中文文本检测系统，可以帮助用户检测并修正文本中的语法、拼写、标点和流畅（表达优化）问题。

## 功能特点

- **多智能体检测**：系统集成了两种专业智能体，分别负责检测不同类型的文本问题

  - 基础错误智能体（BasicErrorAgent）：检测拼写、标点、基础语法等客观错误
  - 流畅智能体（FluentAgent）：检测语义通顺、冗余重复与表达优化问题

- **实时编辑**：用户可以在编辑器中直接输入文本，并获得即时的检测结果

- **一键修正**：对于检测到的问题，系统会提供修正建议，用户可以一键应用

- **高亮显示**：在编辑器中直接高亮显示存在问题的文本，方便用户定位

## 技术栈

- **前端**：Next.js 14 + React 18 + TypeScript 5 + SCSS（BEM 规范，无 & 嵌套）
- **后端**：Next.js App Router API Routes（Node 环境）
- **AI**：LangChain 0.1.x 双智能体（基础错误：拼写/标点/语法；流畅：冗余/通顺/表达优化）
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
# OpenAI 相关
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=your_openai_base_url

# LangChain/分析配置
ANALYZE_TIMEOUT_MS=8000   # analyzeText 超时（毫秒）

# API 速率限制（如未启用可忽略）
API_RATE_LIMIT=60
```

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
      "explanation": "可选解释"
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
 │   │   └── TextEditor/
 │   ├── lib/
 │   │   ├── config.ts           # 统一配置（读取 .env）
│   │   ├── logger.ts           # 结构化日志
│   │   └── langchain/
│   │       ├── index.ts        # analyzeText（超时保护、结构化日志）
│   │       ├── merge.ts        # 错误合并策略
│   │       └── agents/         # 多智能体实现
│   └── types/                  # 类型定义（ErrorItem/AnalyzeOptions 等）
├── tests/
│   ├── unit/                   # 单元测试（Vitest）
│   └── integration/            # 集成测试（含 /api/check）
├── .env.example                # 环境变量示例
├── next.config.js              # Next.js 配置
├── package.json                # 项目依赖与脚本
├── tsconfig.json               # TypeScript 配置
└── vitest.config.ts            # Vitest 配置
```

## 扩展与定制

### 添加新的检测智能体

1. 在`src/lib/langchain/agents`目录下创建新的智能体实现
2. 在 `src/lib/langchain/agents/coordinator/CoordinatorAgent.ts` 中接入新智能体（根据 `enabledTypes` 决定是否调用）
3. 在前端界面中添加对应的选项和显示逻辑

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
