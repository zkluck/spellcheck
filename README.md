# 中文文本检测系统

这是一个基于 Next.js 和 LangChain 多智能体架构构建的中文文本检测系统，可以帮助用户检测并修正文本中的语法、拼写、标点和重复问题。

## 功能特点

- **多智能体检测**：系统集成了四种专业智能体，分别负责检测不同类型的文本问题

  - 语法智能体：检测语法错误
  - 拼写智能体：检测拼写错误
  - 标点智能体：检测标点符号使用错误
  - 重复检测智能体：检测文本中的重复内容

- **实时编辑**：用户可以在编辑器中直接输入文本，并获得即时的检测结果

- **一键修正**：对于检测到的问题，系统会提供修正建议，用户可以一键应用

- **高亮显示**：在编辑器中直接高亮显示存在问题的文本，方便用户定位

## 技术栈

- **前端**：Next.js + TypeScript + SCSS
- **后端**：Next.js API Routes
- **AI 模型**：LangChain 多智能体架构

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
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=your_openai_base_url
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
│   ├── app/               # Next.js应用目录
│   │   ├── api/           # API路由
│   │   │   └── check/     # 文本检测API
│   │   ├── globals.scss   # 全局样式
│   │   ├── layout.tsx     # 布局组件
│   │   └── page.tsx       # 主页面
│   ├── components/        # 组件目录
│   │   ├── ControlBar/    # 控制栏组件
│   │   ├── Home/          # 主页组件
│   │   ├── ResultPanel/   # 结果面板组件
│   │   ├── ShortcutHint/  # 快捷键提示组件
│   │   └── TextEditor/    # 文本编辑器组件
│   ├── lib/               # 工具库
│   │   └── agents/        # 智能体实现
│   └── types/             # TypeScript类型定义
├── .env.local             # 环境变量
├── next.config.js         # Next.js配置
├── package.json           # 项目依赖
└── tsconfig.json          # TypeScript配置
```

## 扩展与定制

### 添加新的检测智能体

1. 在`src/lib/agents`目录下创建新的智能体实现
2. 在 API 路由中注册新智能体
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
