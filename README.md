# AI 中文文本检测系统

基于 Next.js + TypeScript + LangChain 构建的智能中文文本检测系统，集成规则引擎和 LLM 双重检测，提供高准确率的语法、拼写、标点和流畅性检测。

## 核心特性

- **智能检测**：拼写错误、语法问题、标点符号、表达优化
- **双重引擎**：规则引擎 + LLM 智能体，快速准确
- **高精度**：置信度阈值过滤，减少误报
- **专业词典**：内置技术、医学、法律、金融等领域术语
- **实时检测**：边输入边检测，即时反馈
- **一键修复**：智能建议，一键应用修正
- **现代界面**：简洁美观的用户体验

## 🏗️ 系统架构

### 检测引擎
- **规则引擎**：基于正则表达式的快速检测，处理常见错误模式
- **LLM智能体**：深度语义分析，处理复杂语法和表达问题
- **后处理器**：智能合并结果，冲突解决，置信度过滤

### 检测类型
- **拼写检测** (spelling)：错别字、同音字误用
- **语法检测** (grammar)：量词错误、主谓搭配、成分缺失
- **标点检测** (punctuation)：标点错误、重复标点、全半角混用
- **流畅性检测** (fluency)：表达优化、冗余消除、语序调整

## 📖 使用方法

1. **输入文本**：在编辑器中输入需要检测的中文文本
2. **开始检测**：点击"检查文本"按钮或使用快捷键 `Ctrl + Enter`
3. **查看结果**：右侧面板显示检测到的问题和修正建议
4. **应用修正**：点击建议项一键应用修正，或手动编辑文本

### 快捷键
- `Ctrl + Enter`：开始检测
- `Tab`：在检测结果间切换
- `Enter`：应用当前选中的修正建议

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
# 必需配置
OPENAI_API_KEY=your_api_key

# 可选配置
OPENAI_BASE_URL=your_base_url  # 第三方API网关
DETECTION_SPELLING_THRESHOLD=0.85    # 拼写检测阈值
DETECTION_GRAMMAR_THRESHOLD=0.75     # 语法检测阈值
DETECTION_PUNCTUATION_THRESHOLD=0.90 # 标点检测阈值
DETECTION_FLUENCY_THRESHOLD=0.65     # 流畅性检测阈值
```

## 🛠️ 技术栈

- **前端**：Next.js 14 + React 18 + TypeScript 5 + SCSS
- **后端**：Next.js API Routes + Node.js
- **AI引擎**：LangChain + OpenAI GPT
- **数据校验**：Zod 类型安全
- **测试框架**：Vitest + Playwright
- **代码质量**：ESLint + Prettier + Husky

## 🧪 测试

```bash
# 类型检查
npm run type-check

# 单元测试
npm run test

# 端到端测试
npm run e2e
```

## 📁 项目结构

```
spellcheck/
├── src/
│   ├── app/                    # Next.js 应用
│   │   ├── api/check/          # 检测API
│   │   └── page.tsx            # 主页面
│   ├── components/             # React组件
│   │   ├── Home/               # 主界面
│   │   ├── TextEditor/         # 文本编辑器
│   │   └── ResultPanel/        # 结果面板
│   ├── lib/
│   │   ├── config.ts           # 配置管理
│   │   ├── rules/              # 规则引擎
│   │   │   ├── engine.ts       # 规则引擎核心
│   │   │   ├── postprocessor.ts # 后处理器
│   │   │   └── dictionaries/   # 专业词典
│   │   └── langchain/          # LLM智能体
│   └── types/                  # 类型定义
├── tests/                      # 测试文件
└── examples/                   # 示例代码
```
## 🔧 自定义配置

### 专业词典扩展

可以在 `src/lib/rules/dictionaries/` 目录下扩展专业词典：

```typescript
// 添加新领域术语
export const professionalTerms = {
  technology: ['算法', '数据结构', '机器学习'],
  medical: ['诊断', '治疗', '症状'],
  // 添加更多领域...
};
```

### 检测阈值调整

通过环境变量调整各类型检测的置信度阈值：

```bash
DETECTION_SPELLING_THRESHOLD=0.85    # 拼写检测阈值
DETECTION_GRAMMAR_THRESHOLD=0.75     # 语法检测阈值  
DETECTION_PUNCTUATION_THRESHOLD=0.90 # 标点检测阈值
DETECTION_FLUENCY_THRESHOLD=0.65     # 流畅性检测阈值
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

### POST /api/check

**请求体：**
```json
{
  "text": "需要检查的文本",
  "options": {
    "enabledTypes": ["spelling", "grammar", "punctuation", "fluency"]
  }
}
```

**响应：**
```json
{
  "errors": [
    {
      "id": "string",
      "start": 0,
      "end": 5,
      "text": "错误片段",
      "suggestion": "修正建议",
      "type": "spelling",
      "metadata": { "confidence": 0.95, "source": "rule_engine" }
    }
  ],
  "meta": {
    "elapsedMs": 123,
    "enabledTypes": ["spelling", "grammar"]
  }
}
```

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📜 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

