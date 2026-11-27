# 行测工作台（xingce-workbench）项目规格说明书

> 本文档的目标：让一个从未接触过本项目的 AI，**仅凭本文即可完整复现该网站**。
> 文档基于 2026-11-27 的项目快照编写，所有数据结构、文件路径、算法、配置均已核验。
> 项目根目录：`/Users/kondolph/WorkBuddy/2026-11-22-08-46-41`

---

## 目录

1. [项目目标与定位](#1-项目目标与定位)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [快速复现指南](#3-快速复现指南)
4. [完整文件清单与结构](#4-完整文件清单与结构)
5. [数据模型（类型定义）](#5-数据模型类型定义)
6. [数据持久化层](#6-数据持久化层)
7. [核心库模块详解](#7-核心库模块详解)
8. [路由与页面](#8-路由与页面)
9. [功能模块详解](#9-功能模块详解)
10. [样式体系](#10-样式体系)
11. [三大特色引擎](#11-三大特色引擎)
12. [同步机制](#12-同步机制)
13. [主题与字号](#13-主题与字号)
14. [测试方式](#14-测试方式)
15. [构建与部署](#15-构建与部署)
16. [当前状态](#16-当前状态)
17. [已知限制与坑](#17-已知限制与坑)
18. [下一步计划](#18-下一步计划)

---

## 1. 项目目标与定位

**行测工作台**是一个面向中国公务员考试（行测/公考）备考者的**纯前端个人工作台**。它把错题、母题、知识库、学习计划和在线刷题整合到一个统一的本地优先（local-frontend-first）应用中。

核心设计原则：
- **本地优先**：所有数据默认存于浏览器（IndexedDB + localStorage 双写镜像），无需登录即可使用全套功能。
- **可选云同步**：用户可自愿接入 WorkBuddy 云服务或 GitHub 私有仓库，实现跨设备同步。
- **粉笔风格 UI**：界面参考粉笔 App/粉笔网，蓝灰底 + 白卡片 + 三档大字号 + 全屏考试模式。
- **文档即题库**：上传 PDF/Word 文档，自动拆题为在线试卷，支持无限刷题与错题自动入库。
- **富文本知识库**：FlowUs 式块编辑器 + 应用内多格式文件阅读器（PDF/Word/Excel/PPTX/Markdown/CSV/图片）。

一句话定位：**一个本地优先、可云同步、粉笔风格的公考刷题与知识管理 SPA。**

---

## 2. 技术栈与依赖

### 2.1 运行时与框架

| 类别 | 技术 | 版本 |
|---|---|---|
| 框架 | React | `^18.3.1` |
| DOM | react-dom | `^18.3.1` |
| 路由 | react-router-dom | `^6.26.2`（**HashRouter**） |
| 语言 | TypeScript | `^5.6.3`（strict 模式） |
| 构建 | Vite | `^5.4.10` |
| React 插件 | @vitejs/plugin-react | `^4.3.3` |

### 2.2 生产依赖（package.json dependencies）

```json
{
  "@tencent-ai/workbuddy-cloud-sdk": "^0.1.4-dev.71e5d1e.202611161655",
  "docx-preview": "^0.4.1",
  "dompurify": "^3.1.6",
  "idb": "^8.0.0",
  "jszip": "^3.10.2",
  "mammoth": "^1.13.0",
  "marked": "^12.0.2",
  "pdfjs-dist": "^4.10.38",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.26.2",
  "tesseract.js": "^5.1.1",
  "xlsx": "^0.18.5"
}
```

依赖用途说明：
- `@tencent-ai/workbuddy-cloud-sdk`：WorkBuddy 云服务 SDK（数据库/认证/存储/**免密钥 LLM**），名义上来自 npm `@dev` 渠道，本项目锁定 dev 构建版本。
- `idb`：IndexedDB 封装（Promise API）。
- `pdfjs-dist`：PDF 文本层抽取 + 逐页 canvas 渲染。
- `mammoth` + `docx-preview`：Word 文档解析（前者转 HTML，后者原版式渲染）。
- `xlsx`（SheetJS）：Excel 表格渲染。
- `jszip`：PPTX（OOXML zip）解压。
- `tesseract.js`：浏览器本地 OCR（中文 `chi_sim`）。
- `marked` + `dompurify`：Markdown 渲染 + XSS 消毒。
- `dompurify`：所有 HTML 注入前的白名单消毒。

### 2.3 npm scripts

```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit"
}
```

### 2.4 TypeScript 配置要点（tsconfig.json）

- `target: ES2020`、`module: ESNext`、`moduleResolution: Bundler`
- `jsx: react-jsx`、`noEmit: true`
- **`strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`**（严格模式，未使用的局部变量/参数会编译失败——复现时务必注意）
- `isolatedModules: true`、`allowImportingTsExtensions: true`、`skipLibCheck: true`

### 2.5 Vite 配置（vite.config.ts，完整）

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORT) || 5173

export default defineConfig({
  plugins: [react()],
  base: './',                       // 相对资源路径，适配 GitHub Pages 子路径部署
  server: {
    port,                           // 监听环境变量 PORT，默认 5173
    host: '0.0.0.0',                // 绑定所有网卡
    allowedHosts: true,             // 允许任意 Host（WorkBuddy 沙箱反向代理必需）
  },
})
```

> **关键**：`PORT` 环境变量 + `host: '0.0.0.0'` + `allowedHosts: true` 三者缺一不可，否则 WorkBuddy 沙箱的反向代理会因端口/主机校验失败而无法预览。

### 2.6 index.html 要点

- `lang="zh-CN"`，标题「行测工作台」。
- 三行禁用缓存 meta（no-cache / no-store / must-revalidate、Pragma、Expires）。
- 从 `cdn.jsdelivr.net/npm/prismjs@1.29.0` 加载 `prism-tomorrow` 主题 CSS、`prism-core.min.js`、`prism-autoloader.min.js`，并设置 `languages_path` 自动加载语言包（代码块语法高亮依赖此 CDN，离线时会降级为纯文本）。
- `<div id="root">` + `<script type="module" src="/src/main.tsx">`。

---

## 3. 快速复现指南

按以下步骤可从零重建并运行：

```bash
# 1. 创建项目目录并初始化
mkdir xingce-workbench && cd xingce-workbench
npm init -y

# 2. 安装依赖（按第 2 节 package.json 精确版本）
npm install react@^18.3.1 react-dom@^18.3.1 react-router-dom@^6.26.2 \
  idb@^8.0.0 @tencent-ai/workbuddy-cloud-sdk@dev \
  pdfjs-dist@^4.10.38 mammoth@^1.13.0 docx-preview@^0.4.1 \
  xlsx@^0.18.5 jszip@^3.10.2 tesseract.js@^5.1.1 \
  marked@^12.0.2 dompurify@^3.1.6
npm install -D typescript@^5.6.3 vite@^5.4.10 \
  @vitejs/plugin-react@^4.3.3 @types/react@^18.3.11 @types/react-dom@^18.3.1

# 3. 按第 2.4 / 2.5 节写 tsconfig.json、vite.config.ts、index.html

# 4. 按第 4 节文件树创建 src/ 下所有文件（逐文件职责见第 4、7、9 节）

# 5. 关键配置常量（cloud.ts）：
#    ENDPOINT = 'https://xingce-workbench-ai.app.workbuddy.host'
#    PUBLISHABLE_KEY = 'wbpk_6G3nteaUKurmlxHnjcgVk3_BV5PE2vtrQdfg0w8QGMoc8pGU0tkMwCX'
#    （如需复现云端/AI 能力，必须先通过 workbuddy_cloud_service 的 activate(create,
#      intent 声明"接入大模型"）新建应用拿到自己的 publicConfig 并替换——旧应用事后无法补开 AI 能力，见 16.2）

# 6. 启动
npm run dev            # 开发
npm run build          # 类型检查 + 构建（必须通过 strict 检查）
npm run preview        # 预览构建产物
```

> **注意**：`@tencent-ai/workbuddy-cloud-sdk` 是腾讯内部渠道包。若安装失败，可按 cloud-service skill 的指引切换到 CDN `<script>` 形式（`WorkBuddyCloud` 全局），或在无云能力需求时先 stub 掉 `cloud.ts`/`sync.ts`/`github.ts`（本地功能不受影响，只是没有同步）。

---

## 4. 完整文件清单与结构

### 4.1 根目录

```
xingce-workbench/
├── .github/workflows/deploy.yml     # GitHub Pages 自动部署工作流
├── .gitignore                        # node_modules / dist / .workbuddy / *.genie 等
├── .wbapp_jw6026ZNcqYFzU3nV4V2iA.genie  # WorkBuddy 应用标记（appId/name/localDir/appType）
├── index.html                        # HTML 入口 + Prism CDN
├── package.json / package-lock.json
├── tsconfig.json
├── vite.config.ts
├── scripts/
│   └── test-refine.mjs               # 【新增】拆题后处理回归测试（npm run test:refine）
├── dist/                             # 构建产物（部署用，生成即可）
├── flowus-editor/                    # 【可忽略】早期独立原型子项目，主站不引用
└── src/                              # 主源码（58 个文件）
```

### 4.2 src/ 完整文件树（按职责分组）

```
src/
├── main.tsx                          # 应用入口：HashRouter + AuthProvider + initTheme
├── App.tsx                           # 路由表
├── types.ts                          # 全部 TypeScript 类型 + 默认分类种子 + 状态工具
├── vite-env.d.ts                     # /// <reference types="vite/client" />
│
├── styles/
│   └── global.css                    # 唯一样式文件（1781 行），含全部组件样式与主题变量
│
├── components/                       # 公共组件（6）
│   ├── ui.tsx                        # Icon（内联 SVG path 表）、Modal、ConfirmDialog、EmptyState
│   ├── Layout.tsx                    # 顶部导航 + 设置面板 + GitHub/WorkBuddy 同步面板（429 行）
│   ├── QuestionNavigator.tsx         # 详情/做题翻页导航（← → 键）
│   ├── QuestionImages.tsx            # 题目图片统一展示 + 灯箱（object-fit: contain）
│   ├── ImageLightbox.tsx             # 大图灯箱（缩放 0.3~3、下载、Esc）
│   └── RichTextEditor.tsx            # 【新增】材料富文本编辑器：排版工具栏 + 插入图片 + 拖拽缩放/删除
│
├── lib/                              # 核心库（23）
│   ├── db.ts                         # IndexedDB 封装 + localStorage 同步镜像（340 行）
│   ├── sync.ts                       # WorkBuddy 云双向同步 + 微信 OAuth
│   ├── syncHook.ts                   # 写入钩子（addSyncHook/pauseSync/notifySync）
│   ├── snapshot.ts                   # 快照收集/合并/落地 + SYNC_EVENT
│   ├── cloud.ts                      # 云 SDK 惰性加载 + 域名判断 + getCloudForLlm
│   ├── auth.tsx                      # AuthProvider / useAuth
│   ├── github.ts                     # GitHub 私有仓库同步（463 行）
│   ├── useGitHubSync.ts              # GitHub 同步外部 store（useSyncExternalStore）
│   ├── plans.ts                      # 学习计划双写存储 + 统计
│   ├── categories.ts                 # 模块/题型/考点配置与关联
│   ├── folders.ts                    # 知识库无限层级文件夹
│   ├── blocks.ts                     # 块 <-> Markdown/HTML 转换
│   ├── docFile.ts                    # 文件上传读取为 DataURL / 文本
│   ├── image.ts                      # 图片原图/压缩 DataURL
│   ├── pdfText.ts                    # pdfjs-dist 文本层抽取 + 逐页渲染
│   ├── ocr.ts                        # tesseract.js 中文 OCR + 题目结构化（293 行）
│   ├── paperParser.ts                # 文档→题库四重解析引擎（392 行）
│   ├── bankParser.ts                 # 题库图片识别引擎：OCR→LLM/rule 拆为 BankQuestion JSON
│   ├── richText.ts                   # 【新增】材料富文本工具：DOMPurify 白名单过滤、富文本↔纯文本、提取内嵌图片
│   ├── questionRefine.ts             # 拆题后处理：文段/设问拆分、单行选项切分、答案回填、类别/模块校正
│   ├── llm.ts                        # 免密钥大模型探测 + 分批拆题（含 structureQuestionsForBank）
│   ├── pptxSlide.ts                  # 自研 PPTX OOXML 版式解析器（565 行）
│   ├── markdown.ts                   # marked + DOMPurify 渲染
│   ├── filters.ts                    # 正确率/日期筛选
│   ├── fontSize.ts                   # 三档字号
│   ├── theme.ts                      # 明暗主题
│   ├── hooks.ts                      # useCollection
│   └── utils.ts                      # 日期/UID/题干排版工具
│
└── features/                         # 功能模块（8 个目录，26 个页面组件）
    ├── dashboard/
    │   └── Dashboard.tsx             # 总览 + 备份导入导出 + 清空
    ├── mistakes/
    │   ├── MistakesPage.tsx          # 错题库列表 + 多维筛选
    │   ├── MistakeDetail.tsx         # 错题详情 + 做题模式 + 移入掌握库
    │   ├── MistakeForm.tsx           # 错题录入/编辑 + OCR 粘贴（422 行）
    │   ├── MasteredPage.tsx          # 掌握库
    │   ├── PracticePage.tsx          # 专项刷题全屏考试（746 行）
    │   ├── QuestionSketch.tsx        # 题目手写草稿（覆盖相邻三题）
    │   └── DraftPad.tsx              # 独立草稿纸抽屉
    ├── knowledge/
    │   ├── KnowledgePage.tsx         # 知识库单页工作台：文件夹树 + 文档列表（564 行）
    │   ├── DocEditor.tsx             # 旧路由重定向组件
    │   ├── DocWorkspace.tsx          # 右侧编辑区 / 全屏阅读
    │   ├── BlockEditor.tsx           # FlowUs 式块编辑器（1080 行）
    │   ├── FileViewer.tsx            # 应用内多格式文件阅读器（648 行）
    │   └── DocSketch.tsx             # 文档手写批注层
    ├── paper/
    │   ├── OnlinePracticePage.tsx    # 上传→解析→校对→组卷→历史（577 行）
    │   └── PaperExamRunner.tsx       # 在线试卷考试运行器
    ├── bank/                         # 【新增】题库后台管理
    │   ├── QuestionBankPage.tsx      # 顶部入口：图片识别入库/列表筛选/JSON查看/推送错题
    │   └── BankForm.tsx              # 题库题目手动新增/编辑表单
    ├── mothers/
    │   ├── MothersPage.tsx           # 母题库列表
    │   ├── MotherForm.tsx            # 母题录入/编辑（316 行）
    │   └── MotherDetail.tsx          # 母题详情（191 行）
    ├── categories/
    │   ├── CategoryManager.tsx       # 模块/题型/考点三级管理
    │   └── CategoryFields.tsx        # 表单中的三级分类选择器
    └── plans/
        ├── PlansPage.tsx             # 周历 + 计划列表 + 多视图
        ├── PlanForm.tsx              # 计划新建/编辑
        ├── PlanTimer.tsx             # 圆环计时器 + 子任务
        └── PlanStats.tsx             # 统计图表
```

---

## 5. 数据模型（类型定义）

以下为 `src/types.ts` 的完整核心接口（复现时必须逐字段一致，否则数据兼容性会破坏）：

### 5.1 分类与状态

```ts
interface QuestionCategory {
  id: string; name: string; types: string[]; points: string[];
  typePoints?: Record<string, string[]>;   // 题型 → 专属考点
  createdAt: number; updatedAt: number;
}
type ReviewStatus = 'new' | 'pending' | 'reviewed' | 'mastered'
```

`DEFAULT_CATEGORIES` 为 6 个预置模块（言语理解/数量关系/判断推理/资料分析/常识判断/其他），各含 `types`、`points`、`typePoints`。首次启动由 `ensureCategories()` 种子化，固定 id `seed-category-1..6`，按名去重。

`ReviewStatus` 工具函数：`reviewStatusOf`（默认 new）、`reviewStatusLabel`、`reviewStatusChip`（new→chip-primary / pending→chip-warning / reviewed→chip / mastered→chip-success）。`mastered` 状态的错题进入掌握库、不再显示在错题库。

### 5.2 核心实体

```ts
interface Mistake {
  id: string; title: string; type: string; options: string[];
  answer: string; userAnswer: string; analysis: string;
  tags: string[]; images: string[];
  createdAt: number; updatedAt: number;
  lastReviewedAt?: number; reviewCount: number; correctCount: number;
  motherId?: string; source?: string; accuracy?: number;
  categoryId?: string; subType?: string; point?: string;
  linkMother?: boolean; reviewStatus?: ReviewStatus;
}

interface QuizQuestion {           // 文档解析出的通用题
  id: string; title: string; options: string[]; answer: string;
  analysis: string; type: string; subType?: string; point?: string; images?: string[];
}

interface Paper {                   // 文档转在线试卷
  id: string; title: string; fileName: string; fileType: string;
  fileData?: string; questions: QuizQuestion[]; parseMethod: string;
  questionCount: number; sourceDocId?: string;
  createdAt: number; updatedAt: number;
}

interface PracticeRecord {          // 一次在线刷题历史
  id: string; paperId: string; paperTitle: string;
  startedAt: number; finishedAt: number; elapsed: number;
  total: number; correct: number; wrong: number; skipped: number;
  details: Array<{ questionId: string; title: string; chosen: string; answer: string; correct: boolean }>;
  createdAt: number; updatedAt: number;
}

interface MotherQuestion {
  id: string; title: string; type: string; point: string;
  modelAnswer: string; keyPoints: string[]; tags: string[];
  source?: string; accuracy?: number; categoryId?: string;
  subType?: string; images?: string[]; options?: string[];
  createdAt: number; updatedAt: number;
}

// 【新增】题库后台题目：图片识别后以 JSON 结构入库，每题唯一 ID
type BankCategory = '单选题' | '多选题'
const BANK_CATEGORIES = ['单选题', '多选题']
const BANK_MODULES = ['政治理论','常识','言语理解','数量关系','判断推理','资料分析']
interface BankQuestion {
  id: string;                 // 唯一 ID（uid()）
  category: BankCategory;     // 单选题 / 多选题
  module: string;             // 六大模块之一
  material: string;           // 材料纯文本（供搜索/拆题/推送错题）
  materialHtml?: string;      // 【新增】材料富文本 HTML（排版 + 内嵌图片）；老题为空，由 material 生成
  stem: string;               // 题干
  options: string[];          // A-D 选项
  answer: string;             // 正确答案字母（多选含多个字母）
  analysis: string;           // 解析
  images: string[];           // 题目原图（压缩存储图）
  source?: string;
  createdAt: number; updatedAt: number;
}
```

### 5.3 知识库与块文档

```ts
type BlockType = 'text'|'h1'|'h2'|'h3'|'todo'|'bullet'|'number'|'quote'
  |'code'|'table'|'divider'|'image'|'video'|'link'|'docref'|'attachment'   // 16 种

interface DocAttachment { id: string; name: string; fileType: string; fileData: string; size: number }
interface DocBlock {
  id: string; type: BlockType; html: string; text: string;
  checked?: boolean; language?: string; rows?: string[][];
  src?: string; href?: string; docId?: string;
  imgWidth?: number;                  // 10~300，默认 100
  attachments?: DocAttachment[];
}
interface KnowledgeFolder { id: string; name: string; parentId?: string|null; createdAt: number; updatedAt: number }
interface KnowledgeDoc {
  id: string; title: string; content: string;       // Markdown，由 blocks 派生
  blocks?: DocBlock[];                              // 块结构为准
  category: string;                                 // 兼容旧数据（文件夹名），现用 folderId
  folderId?: string; tags: string[];
  createdAt: number; updatedAt: number;
  kind?: 'md'|'file'; fileName?: string; fileType?: string; fileData?: string; tencentUrl?: string;
}
```

### 5.4 学习计划

```ts
const STUDY_MODULES = ['言语','判断','资料','图推','数量','时政','常识'] as const
const PLAN_MODES = ['学习','刷题'] as const
type PlanMode = '学习'|'刷题'|'专注'   // '专注' 兼容旧数据
const PLAN_PRIORITIES = ['重要且紧急','重要不紧急','紧急不重要','不紧急不重要'] as const

interface PlanSubTask { id: string; type: string; count: number; correct?: number; elapsedSeconds?: number; done?: boolean }
interface PlanSession { id: string; startedAt?: number; endedAt?: number; seconds: number; manual?: boolean; subTaskId?: string }
interface StudyPlan {
  id: string; module: StudyModule; mode: PlanMode; title: string; description: string;
  subTasks: PlanSubTask[]; date: string;          // YYYY-MM-DD
  startTime?: string; endTime?: string; priority: PlanPriority;
  completed: boolean; elapsedSeconds: number; timerStartedAt?: number;
  source?: string; targetMinutes?: number; questionCount?: number; correctCount?: number;
  sessions?: PlanSession[]; activeSubTaskId?: string;
  createdAt: number; updatedAt: number;
}
```

### 5.5 备份

```ts
interface BackupData {
  version: number; exportedAt: number;
  mistakes: Mistake[]; docs: KnowledgeDoc[]; mothers: MotherQuestion[];
  plans?: StudyPlan[]; categories?: QuestionCategory[];
  folders?: KnowledgeFolder[]; papers?: Paper[]; practiceRecords?: PracticeRecord[]; bank?: BankQuestion[];
}
```

---

## 6. 数据持久化层

这是整个项目最关键、最需要精确复现的部分（`src/lib/db.ts`）。

### 6.1 IndexedDB

- 数据库名：`xingce-workbench`，**版本 6**。
- 9 个 object store（keyPath 均为 `id`）：

| store | 类型 | 索引 |
|---|---|---|
| `mistakes` | Mistake | `by-created`(createdAt)、`by-type`(type) |
| `docs` | KnowledgeDoc | `by-updated`、`by-category` |
| `mothers` | MotherQuestion | `by-created`、`by-type` |
| `plans` | StudyPlan | `by-date`(date)、`by-module`(module) |
| `categories` | QuestionCategory | `by-updated` |
| `folders` | KnowledgeFolder | `by-updated` |
| `papers` | Paper | `by-updated` |
| `practiceRecords` | PracticeRecord | `by-updated`、`by-paper`(paperId) |
| `bank` | BankQuestion | `by-updated`、`by-module`(module)、`by-category`(category) |

> 版本升级链：v5 加 `papers`/`practiceRecords`；**v6 加 `bank`**（题库后台）。所有 store 均需同步登记到 `db.ts` 的 `StoreName`/`EntityMap`、`snapshot.ts` 的 `STORES`/`collectLocal`/`buildSnapshot`、`sync.ts` 的 `exportWithCloud`、`db.ts` 的 export/import/clear 与 storage 事件正则，否则不参与双端同步与备份。

### 6.2 双写镜像架构（核心设计）

为避免每次操作都 `JSON.parse` 含大图 Base64 的对象，采用「**localStorage 同步镜像 + IndexedDB 异步镜像**」：

- 常量：`CACHE_PREFIX='xingce-cache-v1-'`、`DELETED_PREFIX='xingce-deleted-v1-'`、`DB_TIMEOUT=800`。
- `stateOf(store)`：懒加载 localStorage 缓存与删除墓碑到内存。
- `readCachedAll` / `readCachedById`：**同步**读取内存镜像（首帧渲染零等待）。
- `withFallback(promise, 800, fallback)`：DB 操作 800ms 超时兜底。
- `mirror(work)`：后台异步写 IndexedDB，失败静默。
- `listAll(store)` / `getById`：后台合并 DB 与缓存（按 `updatedAt` 取新，排除墓碑）。
- `put(store, value)`：同步写缓存 → 后台 mirror → `notifySync(store, id, value, updatedAt)`（触发云/GitHub 推送）。
- `remove(store, id)`：写墓碑 → 移出缓存 → 后台删除 → `notifySync(..., null, now)`。
- `window.addEventListener('storage')`：监听 `xingce-(cache|deleted)-v1-<store>` 变化，多标签页同步失效内存镜像。
- 备份：`exportAll()`（`{version:3, exportedAt, ...8 stores}`）、`importAll(data)`、`clearAll()`。

### 6.3 localStorage / sessionStorage 全部 key

**localStorage：**
- `xingce-theme`（主题）
- `xingce-font-size`（字号档位 key）
- `xingce-cache-v1-<store>` × 8（内存镜像缓存）
- `xingce-deleted-v1-<store>` × 8（删除墓碑）
- `xingce-plans-v1`（学习计划独立存储）、`xingce-plans-deleted-v1`（计划墓碑）
- `xingce-github-config-v1`（GitHub 配置含 PAT，仅存本机）
- `xingce-kb-sidebar`（知识库侧栏展开状态）
- `xingce-docsketch-v2-<docId>`（文档手写笔迹 JSON，几 KB）、`xingce-docsketch-v1-<docId>`（旧版 PNG 兼容）

**sessionStorage：**
- `xingce-practice-session-v1`（专项刷题本轮进度，刷新恢复）
- `xingce-sketch-v1-<questionId>`（题目草稿 PNG）
- `xingce-practice-draft-v1`（独立草稿纸 PNG）

---

## 7. 核心库模块详解

### 7.1 cloud.ts — 云 SDK 惰性加载

```ts
const ENDPOINT = 'https://xingce-workbench-53921.app.workbuddy.host'
const OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
const PUBLISHABLE_KEY = 'wbpk_jw6026ZNcqYFzU3nV4V2iA_cNgN30Q5QinX1jRs6QYmwi6mjLE2kcuA'

export const CLOUD_AVAILABLE = (() => {
  try { return new URL(ENDPOINT).host === window.location.host } catch { return false }
})()

export function getCloud(): Promise<CloudClient> | null {   // 同步用：仅发布域名
  if (!CLOUD_AVAILABLE) return null
  ...  // createWorkBuddyCloud({ endpoint, oauthRelayBaseUrl, publishableKey })
}
export function getCloudForLlm(): Promise<CloudClient> {    // LLM 用：不受域名限制，惰性加载
  ...
}
```

> `CLOUD_AVAILABLE` 为 false 时（如 GitHub Pages），首屏完全不下载 SDK，保证加载速度；LLM 走独立的 `getCloudForLlm()`，只在解析文档时加载。

### 7.2 syncHook.ts / snapshot.ts

- `syncHook.ts`：`addSyncHook(fn)`（返回取消注册函数，支持多个后端）、`pauseSync/resumeSync`、`notifySync(store, id, payload, updatedAt)`。
- `snapshot.ts`：
  - `STORES`（8 个 store 名数组）、`SYNC_EVENT='xingce-sync-applied'`、`emitSyncApplied()`（派发 window 事件驱动界面刷新）。
  - `collectLocal()`：从各 store 缓存 + plans 独立存储收集为 `Map<store, Map<id, {payload, updatedAt}>>`，墓碑以 `{payload:{}, updatedAt:0}` 表示。
  - `mergeStores(local, remote)` → `{pushes, applies, pulled}`：**按 updatedAt 取新、删除优先**的双向合并算法（处理本地/远端存在/删除的 8 种组合）。
  - `applyLocal(applies)`：普通 store 用 dbPut/dbRemove，plans 用 cachePlan/deletePlan。
  - `buildSnapshot()`：`Snapshot {version:1, exportedAt, stores, deleted}`。

### 7.3 其他库速查

| 文件 | 关键导出/职责 |
|---|---|
| `categories.ts` | `ensureCategories()`（种子化+去重+补默认 typePoints）、`readCategories`、`saveCategory`、`deleteCategory`、`pointsForType`、`relatedMistakes`、`relatedMothers`（按考点自动关联，linkMother=false 不关联） |
| `folders.ts` | `UNCATEGORIZED_ID='__uncategorized__'`、`ALL_DOCS_ID='__all__'`（虚拟 id）、`createFolder`（同父同名去重）、`buildFolderTree`（含环检测）、`folderPath`、`descendantFolderIds`、`migrateLegacyFolderData` |
| `blocks.ts` | `makeBlock`、`inlineToHtml`（先转义防 XSS）、`htmlToMarkdown`、`blocksToMarkdown`（视频/附件 DataURL 不写 Markdown 仅留文件名）、`markdownToBlocks`、`blocksToHtml` |
| `markdown.ts` | `renderMarkdown(source)` = `DOMPurify.sanitize(marked.parse(source))`，`marked` 设 `gfm:true, breaks:true` |
| `image.ts` | `fileToDataUrl`（OCR 用原图不压缩）、`compressImage(file, maxSize=3200, quality=0.95)`（PNG/GIF/BMP 无损，照片 JPEG 高质量压缩+白底填充） |
| `docFile.ts` | `loadDocFile(file)`（文本 readAsText，其余 DataURL）、`docFileKind()`、`formatBytes` |
| `filters.ts` | `ACCURACY_RANGES`（lt30/30to50/50to60/60to70/gte70，左闭右开）、`matchesAccuracy`、`matchesDate` |
| `utils.ts` | `dateKey/fromDateKey/weekOf`（周日开始）、`formatHours/formatClock`、`uid`（crypto.randomUUID 回退）、`formatQuestionText`（题干自动排版） |
| `hooks.ts` | `useCollection(store)` → `{items, loading, error, refresh}`（首帧 readCachedAll 同步，后台 listAll，监听 SYNC_EVENT） |
| `theme.ts` | `ThemeKey='light'|'dark'`、`THEME_KEY`、`initTheme()`、`setTheme()`（写 `document.documentElement.dataset.theme` + CustomEvent） |
| `fontSize.ts` | `FONT_SIZES`（standard/large/xlarge，默认 large）、`FONT_SIZE_KEY`、`initFontSize/readFontIndex/setFontIndex/cycleFontSize`（写 `dataset.fontSize`） |
| `auth.tsx` | `AuthProvider`/`useAuth` → `{available, user, ready, syncing, lastResult, signIn, signOut, sync, subscribeApplied}`，30 秒定时同步 + 页面可见时同步 |

---

## 8. 路由与页面

### 8.1 main.tsx（完整）

```tsx
import { HashRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { initTheme } from './lib/theme'
import './styles/global.css'
initTheme()   // 首帧同步应用主题，防闪烁
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider><App /></AuthProvider>
    </HashRouter>
  </React.StrictMode>,
)
```

### 8.2 App.tsx 路由表

`useEffect` 首帧调用 `ensureCategories()`；所有路由嵌在 `<Route element={<Layout />}>`（Layout 含 `<Outlet/>`）：

| 路径 | 组件 |
|---|---|
| `/` | Dashboard（总览） |
| `/mistakes` | MistakesPage（错题库） |
| `/mastered` | MasteredPage（掌握库） |
| `/mistakes/practice` | PracticePage（专项刷题） |
| `/online-practice` | OnlinePracticePage（在线刷题） |
| `/question-bank` | QuestionBankPage（题库后台管理，顶部导航入口） |
| `/mistakes/:id` | MistakeDetail |
| `/knowledge` | KnowledgePage（知识库单页工作台） |
| `/knowledge/:id` | DocEditor（仅重定向到 `/knowledge?doc=:id`） |
| `/mothers` | MothersPage |
| `/mothers/:id` | MotherDetail |
| `/plans` | PlansPage |
| `*` | Dashboard（兜底） |

Layout 顶部导航含 6 项：总览 / 错题库 / 知识库 / 在线刷题 / 母题库 / 学习计划，右侧有 GitHub 同步按钮 + 设置面板。

---

## 9. 功能模块详解

### 9.1 知识库（FlowUs 式）

- **KnowledgePage.tsx**：左侧无限层级文件夹树 + 文档列表 + 搜索；`useSearchParams` 管理 `?doc=<id>&read=1&new=<folderId>`；≤900px 手机端抽屉式侧栏 + 遮罩；文件夹更多菜单（新建文档/上传本地文件/新建子文件夹/重命名/删除）；删除文件夹时文档移入「未分类」而非删除。
- **DocWorkspace.tsx**：右侧编辑区，块编辑器 800ms debounce 自动保存 + Ctrl/Cmd+S；全屏沉浸模式（`?read=1`，Esc 退出）；文件类文档内嵌阅读；文档信息面板；下载/删除。
- **BlockEditor.tsx**（1080 行，核心）：
  - `BlockItem` 富文本 contentEditable，markdown 快捷输入（`# `→h1、`- `→bullet、`[] `→todo、``` →code 等）。
  - 特殊块：code 用 Prism 高亮、table 可编辑、image 可缩放 10~300% + 灯箱、video（YouTube/B站 embed + 本地 DataURL 转 Blob URL + memo VideoPlayer 保持进度）、link、docref、attachment。
  - 斜杠菜单 `/` 插入 15 种块；`@` 提及全库文档生成不可编辑 chip（`data-doc-id`）；选中文字浮动工具栏（加粗/斜体/下划线/删除线/行内代码/颜色/高亮，`document.execCommand`）。
  - 撤销/重做：history/future 快照栈（最多 100），800ms 内同 mergeKey 连续输入合并；Ctrl/Cmd+Z / Shift+Z / Ctrl+Y；块拖拽排序。
- **FileViewer.tsx**（648 行）：`detectKind` 识别 pdf/image/md/csv/docx/xlsx/pptx/text；docx 用 docx-preview 原版式（失败回退 mammoth）；xlsx 用 SheetJS；pptx 先 JSZip 文字/图片 fallback，再由自研 `PptxDocument` 按原始坐标 + cqw 单位还原版式；PDF 用 `<iframe src=DataURL#toolbar=0...>` + 加载骨架屏；工具栏缩放 0.5~2.5 + 手写批注（仅 PDF/Word）+ 全屏 + 下载。
- **DocSketch.tsx**：手写层 v2，笔迹存为归一化坐标点数组 JSON（几 KB），rAF 合并 resize + pointermove 增量绘制；工具：撤销/手写/擦除(destination-out)/红黑蓝三色/清空/退出。

### 9.2 文档转在线刷题（paper/）

- **OnlinePracticePage.tsx**（577 行）：视图 `list|upload|exam`。上传 PDF/DOCX → `parseDocumentToQuestions` 带进度 → 人工校对预览（`QuestionReviewModal`：题干 textarea 保留换行、4 选项可编辑、答案 A-D 校验、题型、解析、删除；`splitStem` 拆【共用材料】/【题目】；`inspectQuestion` 标黄待审核）→ 每题「确认无误」或校对保存标记 `confirmedIds` → 「确认组卷」汇总弹窗 → `put('papers')`；从知识库文件文档直接创建；试卷卡片（开始刷题/历史/删除）；历史记录弹窗；LLM 能力状态条 `.op-notice.ok/warn`。
- **finishExam**：答错按题目 id 去重写入 mistakes（已存在累加 reviewCount，source 标注「XX（在线试卷）」），写一条 PracticeRecord；一份试卷可无限次刷。
- **PaperExamRunner.tsx**：复用 `.practice-exam/.pe-*/.pr-*` 全屏考试 UI——题目乱序、选项、标记、计时/暂停、答题卡跳题、字号、夜间模式、下载 Markdown 报告、交卷确认、成绩报告（含每题正确答案醒目标注）。

### 9.2.1 题库后台管理（bank/）【新增】

- **顶部导航入口**：Layout `navItems` 中 `/question-bank`（icon `database`），路由见 8.2。
- **QuestionBankPage.tsx**：题库列表 + 模块/类别/关键词筛选；「图片识别入库」弹窗——上传≤12 张图片（压缩图存储 + 原图 OCR）→ `parseImagesToBank` → 实时进度（OCR 0~35%、LLM 35~92%、规则兜底 92~100%）→ 识别结果预览（每题展示类别/模块/答案/题干/选项）→ 「确认入库」批量 `put('bank')`；「导出 JSON」；每题「查看 JSON」「编辑」「删除」「推送到错题」。
- **BankForm.tsx**：手动新增/编辑——类别（单选/多选）、模块（六大固定）、材料（富文本编辑器）、题干、4 选项、答案（>1 字母自动判多选）、解析、来源、图片（≤8）；失焦 `formatQuestionText`。
- **材料富文本（适配图形推理/资料分析图表题）**：
  - `RichTextEditor.tsx`：`contentEditable` 编辑器 + 工具栏（加粗/斜体/下划线/无序列表/有序列表/清除格式/插入图片）；图片经 `compressImage` 压缩后以 DataURL 内嵌，插入时光标折叠到末尾避免误替换选中文字；图片右下角拖拽手柄用 Pointer Events 缩放（48~1200px），右上角 × 删除；所有输出经 DOMPurify 白名单过滤。
  - `richText.ts`：`sanitizeRichHtml`（放行 base64 图片）、`richTextToPlain`（图片转 `[图]`、剔除编辑器控件字符）、`plainToRichText`（老题纯文本降级显示）、`extractImagesFromHtml`（推送错题时把内嵌图片并入 images）。
  - 数据兼容：`material` 继续存纯文本供搜索/拆题/推送，`materialHtml` 存排版与图片；老题无 `materialHtml` 时由 `material` 自动生成，不改变既有数据。列表卡片用 `.bank-item-material-rich` 渲染缩略内容与图片。
- **bankParser.ts**：`parseImagesToBank(images, onProgress, signal)` —— 逐张 `recognizeImage` 提文本 → 优先 `structureQuestionsForBank`（LLM 输出 category/module/material/stem/options/answer/analysis）→ 能力不可用时 `ruleParse`（题号切分 + `parseQuestionText` + 关键词猜模块）兜底。每题 `uid()` 唯一 ID。
- **llm.ts**：泛型 `runStructure<T>(text, systemPrompt, normalize, dedupKey, ...)`；`structureQuestions`（原逻辑）与 `structureQuestionsForBank`（新）共用；`BANK_SYSTEM_PROMPT` 约束六模块与字段名，`normalizeBankQuestion` 兼容多种返回格式。题库拆题去重键为 `material(80)+stem+options(100)`，因矫正后 `stem` 只剩设问句，单独用 stem 去重会误删多道同设问题。
- **questionRefine.ts**：拆题结果确定性后处理（LLM 与规则兜底均调用）——① 从单行 `A.… B.… C.… D.…` 抽出 4 个独立选项并保留行内「答案：X」；② 将「文段 + 设问」拆成 `material`/`stem`（识别「对上述文段…」「根据上述材料…」「填入画横线…」等设问句型）；③ 答案字母去重/过滤非法字母、回填并清除残留标注；④ 答案 >1 字母自动改「多选题」；⑤ 模块填「常识」但内容有明确关键词时按内容纠正（片段阅读→言语理解、数据段落→资料分析等）。纯函数无副作用。
- **BANK_SYSTEM_PROMPT 人工矫正锚点**：把用户人工校正后的「免密支付」言语理解题完整写入提示词作为 few-shot 示例，明确 material/stem 边界、4 条独立选项、答案只按原文回填不臆测。
- **推送到错题**：`pushToMistake` 跳 `/mistakes?fromBank=<id>`；MistakesPage 的 `useEffect` 读参数 → `readCachedById('bank', id)` → 构造 Mistake（materialHtml 先转纯文本再与 stem 合并为题干、module→type、options/answer/analysis/images/source 带入；内嵌图片经 `extractImagesFromHtml` 并入 images，新 `uid()`）→ 打开预填 MistakeForm → 用 `replace` 移除 URL 参数防重复。
- E2E 验证：导航/入库/JSON 字段（id/category/module/material/stem/options/answer/images 全在）/推送预填（答案 AB、选项、来源正确带入）/LLM 拆题（单选 C、多选 AD 正确判定）/手机端无溢出，均无报错。矫正后处理有 4 项回归测试（`npm run test:refine`，见 14）。

### 9.3 错题库与专项刷题（mistakes/）

- **MistakesPage.tsx**：模块 tab + 关键词/题型/正确率/日期多维筛选；只显示未掌握题；chip 展示状态/模块/题型/正确率/来源/答案/图片数/练习次数/标签。
- **MistakeForm.tsx**（422 行）：题干（失焦自动 `formatQuestionText`）、复盘状态下拉、三级分类、关联母题开关、4 选项、答案/我的答案、解析、自评正确率、来源、标签、图片（最多 8 张）；**核心交互**：进入即 `warmupOcr()`，Ctrl/⌘+V 粘贴截图自动 OCR 并回填答案。
- **MistakeDetail.tsx**：做题模式（默认隐藏答案/解析）、作答累计 reviewCount/correctCount、答错自动移回错题库、「移入已掌握库」、QuestionNavigator 翻页、关联母题列表。
- **MasteredPage.tsx**：掌握库（reviewStatus='mastered'），移回错题库/编辑/彻底删除。
- **PracticePage.tsx**（746 行）：专项刷题——筛选（时间/模块/题型/正确率/题量 10/20/50/全部），答题过程不即时显示对错，交卷统一判分；本轮进度存 sessionStorage；计时/暂停/标记/笔记/草稿；答题卡；报告页含难度系数（`10 - 平均正确率/20`，限制 1~5）、分模块统计、每题答案醒目标注、Markdown 报告下载。
- **QuestionSketch.tsx**：手写草稿覆盖锚点题 + 前后各一题（共三题卡片区），笔迹按题 id 存 `sessionStorage[xingce-sketch-v1-<id>]`（PNG），20 步撤销，红黑蓝/擦除。
- **DraftPad.tsx**：独立草稿纸侧栏抽屉（`xingce-practice-draft-v1`）。

### 9.4 母题库 / 分类 / 计划 / 总览

- **mothers/**：MothersPage（搜索/模块筛选，展开看解题思路/关键要点/关联错题）；MotherForm（316 行，题干 OCR + 三级分类 + 模范答案 + 关键要点）；MotherDetail（191 行）。
- **categories/**：CategoryManager（Modal 内管理模块/题型/考点，含「题型对应考点」配置）；CategoryFields（linkMother 开关控制是否按题型选考点）。
- **plans/**：PlansPage（周历 + 4 概览 tile + 5 视图 + 任务卡 + FAB）；PlanForm（模式/7 模块彩色选择/子任务/预计时长/日期/优先级）；PlanTimer（SVG 圆环进度 + 开始/暂停/完成 + ±5 分钟 + 补录 + 子任务状态）；PlanStats（6 统计卡 + 近 7 天柱状图 + 模块投入条 + 模式分布）。
- **dashboard/Dashboard.tsx**：5 统计卡 + 4 模块入口 + 最近 5 错题 + 数据管理区；备份导出 `行测工作台备份-YYYY-MM-DD.json`（version:3）、导入、清空（二次确认）。

### 9.5 公共组件

- **ui.tsx**：`Icon` 内联 SVG path 字典（约 45 个图标名，缺省 file）、`Modal`（Esc/遮罩关闭，wide=900px）、`ConfirmDialog`、`EmptyState`。
- **Layout.tsx**（429 行）：顶部导航（粉笔风 `.topbar/.topnav`）；`GithubConfigModal`（粘贴 Fine-grained PAT → 自动识别用户/建私有仓库/建 data 分支）；`GithubSyncPanel`；`WorkbuddySyncPanel`（微信扫码，仅 CLOUD_AVAILABLE 显示）；`TopbarSync`；`AppearanceSettings`（主题日/夜 + 三档字号）；`SettingsPanel`（外观 + 账户 + GitHub 三区）。
- **QuestionNavigator / QuestionImages / ImageLightbox**：翻页导航；图片 `object-fit: contain` 完整显示（不裁切图形推理选项）+ 灯箱（缩放/下载/Esc）。

---

## 10. 样式体系

唯一文件 `src/styles/global.css`（1781 行）。复现时按以下体系组织：

### 10.1 主题变量（`:root`）

```css
--primary: #1c7cff;  --primary-dark: #1668e0;  --accent: #ff7a2f;
--bg: #f4f7fb;       --surface: #fff;          --text: #16233a;
--border: #e4eaf2;   --radius: 14px;
/* success / danger / warning 及对应 bg；三档 shadow */
font-family: -apple-system, "PingFang SC", ...
```

### 10.2 字号体系

`--font-scale` 默认 1.2；`html[data-font-size='standard']`→1、`large`→1.2、`xlarge`→1.38。全站尺寸用 `calc(Npx * var(--font-scale))` 表达（body 基准 `calc(16px * var(--font-scale))`）。

### 10.3 暗色主题

`html[data-theme='dark']`（约 1655 行起）覆盖 `--bg:#0f172a`、`--surface:#1a2436` 等；刷题页 `.practice-exam.practice-dark`（约 1381 行）独立覆盖为更接近粉笔夜间的深灰。

### 10.4 关键 class 命名前缀

| 前缀 | 用途 |
|---|---|
| `.topbar/.topnav/.topbar-sync/.settings-panel` | 顶部导航与设置 |
| `.btn/.modal/.card/.form-field/.chip/.notice/.segmented/.empty-state` | 通用 UI |
| `.question-text/.question-images/.be-lightbox` | 题目与图片 |
| `.kb-*`（旧）/ `.fw-*`（新） | 知识库工作台 |
| `.kb-be-*` | 块编辑器 |
| `.fr-*` | 文件阅读器 |
| `.practice-exam/.pe-*` | 粉笔风全屏刷题 |
| `.pr-*` | 刷题报告页 |
| `.op-*` | 在线刷题页（能力状态/校对/确认组卷） |
| `.qs-*` / `.ds-*` | 题目草稿 / 文档批注手写层 |

响应式断点：900px、700px、600px。

---

## 11. 三大特色引擎

### 11.1 OCR 引擎（lib/ocr.ts）

- `getWorker()` 动态 import `tesseract.js`，`createWorker('chi_sim', 1, {logger})`，默认 PSM 4（对 ⒶⒷⒸⒹ 圆圈选项更稳）。
- `recognizeImage(dataUrl, onProgress)`：先 PSM4，若解析不出 ≥2 选项则回退 PSM3，用 `scoreOcrResult`（选项数×10 − 乱码罚分）选优。
- **关键经验**：不做图像预处理，直接用原图（压缩会破坏圆圈选项标记）。
- `OCR_TYPO_FIXES` 形近字纠正表；`postprocessOcrText` 合并汉字间空格、纠字、规整标点。
- `findOptionMarks` 覆盖三类标记（标准 A./B、圆圈 ⒶⒷⒸⒹ 及 OCR 乱码《c)、行首裸字母），只接受 A→B→C→D 顺序防误判；`parseQuestionText` 提取答案行并回填。

### 11.2 文档解析引擎（lib/paperParser.ts）

四重手段：**PDF 文本层(pdfjs)/Word 文本层(mammoth) → 扫描版逐页渲染 OCR 回退 → 免密钥 LLM 结构化 → 规则切题校验补全**。

- 进度：`prepare→text→ocr→llm→rules→done`（8→18→64→68→76→92→100）。
- **题号 LIS 算法**（`findQuestionAnchors`）：收集「数字+标点」候选题号，用最长递增子序列（DP，题号差≤12、间隔≤1600 字）排除年份/小数噪声，支持题中挤在一起的题号（127.2020年…128.2020年…）。
- `splitByQuestionNumbers`：锚点切片，第一个锚点前文本作为【共用材料】并入第一题。
- `extractAnswerKey`：提取「答案：1.D 2.B」表按题号回填。
- `formatStem`：规整排版（(一)(二)小标题换行、合并 PDF 拆碎短行）。
- `inspectQuestion` → `QuestionConfidence {missingAnswer, incompleteOptions, tooLongStem, needsReview}`（题干 >280 字且选项不全/无答案→疑似多题粘连）。
- `mergeResults(llm, rules)`：LLM 缺选项/答案时用规则补齐。
- `parseDocumentToQuestions(fileData, fileName, fileType, onProgress, options)` 为主入口。

### 11.3 大模型拆题（lib/llm.ts，⚠️ 见当前状态）

- `SYSTEM_PROMPT`：要求模型输出严格 `{"questions":[...]}` JSON，字段 no/stem/options(长度4)/answer/analysis/type。
- `probeLlm(force=false)`：`cloud.llm.models.list()` 运行时探测，`probeCache` 缓存；`classifyError` 把 capability_disabled→'disabled'、origin/Failed to fetch→'origin'（友好中文「请在 WorkBuddy 应用中打开本工具」）、quota/no_model 等归类。
- `structureQuestions(text, signal)`：按题号 `chunkText(text, 12000)` 分批，`chat.completions.create({stream:true, temperature:0.1, max_tokens:8192, response_format:{type:'json_object'}})` 收集 SSE delta，去 ```json 包裹后 JSON.parse，按 no/题干跨批去重。
- `LlmBlockReason = 'ok'|'disabled'|'origin'|'no_model'|'network'|'quota'|'invalid'|'unknown'`。
- **重要**：调用必须符合官方 SDK 规范——必须 `stream:true`（非流式被拒 `request_stream_required`）、`messages[0]` 必须是 system 消息、初始化必须传 `endpoint + publishableKey`（web 还需 `oauthRelayBaseUrl`）。

### 11.4 PPTX 解析引擎（lib/pptxSlide.ts）

自研 OOXML 解析：`EMU_PER_PX=9525`（96dpi）；解析 solidFill/gradFill/schemeClr、rPr/defRPr 文字样式、制表位、项目符号与自动编号；唯一导出 `parsePptxDeck(buffer): Promise<PptxDeck>`，返回 `{width, height, slides:[{shapes, bg, bgImage}]}`。

---

## 12. 同步机制

两套独立同步，共用 `snapshot.ts` 的合并算法：

### 12.1 WorkBuddy 云同步（lib/sync.ts + auth.tsx）

- 仅 `CLOUD_AVAILABLE`（发布域名）可用；微信 OAuth 登录（`signInWithWechat`，redirectTo 用站点根避免 hash 吞 code）。
- 云表 `workbench_items`：`store / item_id / payload / updated_at / deleted`，`owner_id` 由服务端注入做身份隔离。
- `syncNow()`：select 云端 → 组装 remote Map → `collectLocal()` → `mergeStores()` → `applyLocal(applies)`（pauseSync 期间）→ 分块 40 条 upsert → `emitSyncApplied()`。
- `queuePush`/`flushPushes`：单条写入 700ms 防抖批量 upsert，失败放回队列。

### 12.2 GitHub 私有仓库同步（lib/github.ts + useGitHubSync.ts）

- 任何域名可用；Fine-grained PAT 存本机 `xingce-github-config-v1`。
- 默认仓库 `xingce-workbench-data`、`data` 分支、`workbench-snapshot.json`。
- `ensurePrivateRepo()`（自动建私有仓库，空仓库先写 README 绕开 409）、`ensureBranch()`（Git Data API 建分支）、`probeWriteAccess()`（真实 PUT 探测权限）。
- `githubSyncNow()`：读云端 → 合并 → 单文件 PUT 提交（message `chore: sync xingce workbench data <ISO>`）；写钩子 1200ms 防抖。
- `useGitHubSync`：模块级共享状态 + `useSyncExternalStore`，30 秒定时 + visibilitychange 同步；connect(token) 一键配置。

---

## 13. 主题与字号

- 主题：`document.documentElement.dataset.theme = 'light'|'dark'`，key `xingce-theme`，`initTheme()` 在 main.tsx 渲染前同步调用防闪烁。
- 字号：`dataset.fontSize = 'standard'|'large'|'xlarge'`，key `xingce-font-size`，三档通过 CSS `--font-scale` 全局缩放。
- 两者都通过 CustomEvent（`xingce-theme-change` / `xingce-font-change`）通知组件；设置面板 `AppearanceSettings` 承载切换入口。

---

## 14. 测试方式

仓库内已固化**拆题后处理回归测试**（无需额外依赖）：

```bash
npm run test:refine   # esbuild 打包 questionRefine.ts → node scripts/test-refine.mjs
```

覆盖 4 个场景：① 文段/设问/选项全塞进 stem 的言语理解题还原为人工矫正结构；② 选项带字母前缀且答案藏在解析里；③ 多选答案 AD 自动改类别；④ 资料分析数据材料 + 设问拆分。

其余开发期验证使用 `playwright-core` + 系统 Chrome 无头浏览器做 E2E：

```bash
npm install --no-save playwright-core@1.49.0
PORT=4179 npm run dev
```

- 桌面视口 1440×900、手机视口 390×844。
- 通过 `page.goto('http://localhost:4179/#/...')` 访问 HashRouter 路由，`page.evaluate` 检查 DOM/localStorage/IndexedDB，`page.screenshot` 人工核对。
- 技巧：dev server 下 `await import('/src/lib/db.ts')` 调 `put()` 注入测试数据（注入的 Mistake 必须带 `images:[]`）；上传用隐藏 input `input[aria-label="上传本地文件到文件夹"]` 的 `setInputFiles`；模拟 LLM 用拦截 `models`/`chat` 接口返回 SSE。
- 验收标准：`npm run build` 通过（strict 类型检查）+ 无 `pageerror`。
- **注意**：`npm install pdfjs-dist` 等会清掉未记录的 `playwright-core`，需重新安装。

---

## 15. 构建与部署

### 15.1 GitHub Pages（主发布渠道）

- 远程：`git@github.com:dolphkon/xingce-workbench.git`，分支 `main`。
- `.github/workflows/deploy.yml`：push 到 main → `npm ci` → `npm run build` → upload `dist` → deploy-pages。
- 线上地址：`https://dolphkon.github.io/xingce-workbench/`
- 因 `base:'./'` + HashRouter，子路径部署无需服务端 rewrite。

### 15.2 WorkBuddy 分享应用（当前启用：AI 版）

- **当前分享链接**：`https://xingce-workbench-ai.app.workbuddy.host/?sharecode=QEQEGZR6PN`
- **当前应用 ID**：`wbapp_6G3nteaUKurmlxHnjcgVk3`（名称「行测工作台AI」，标记文件 `.wbapp_6G3nteaUKurmlxHnjcgVk3.genie`）。
- **发布目录**：`/Users/kondolph/WorkBuddy/xingce-workbench-ai`（独立目录，专用新应用；站点源码仍以本文所在目录为准，发布前需同步过来）。
- **该应用创建时声明了「接入大模型实现文档智能拆题」，因此 AI 能力已开通**（见 16.2）。
- 旧应用 `wbapp_jw6026ZNcqYFzU3nV4V2iA` / 旧链接 `https://xingce-workbench-53921.app.workbuddy.host/?sharecode=42GZLX32U2` 保留但**不再发布**（无 AI 能力）。
- 通过 `workbuddy_sites_deploy` 复用同一 `applicationId` 更新，域名与分享码不变。
- **发布约定**（项目长期约定）：任何功能改动完成后默认推送 GitHub Pages + 重新发布 WorkBuddy 分享链接，无需每次询问。

> 关键坑：`workbuddy_sites_deploy` 把 sandbox 与发布目录按路径深度绑定（`workspaceKey` = 目录 hash）。在同一目录内换 `appId` 无效，仍会发布到旧应用。要使用新应用必须从**新目录**发布，且该目录只放新应用的 `.genie` 标记。

### 15.3 构建产物文件（dist/assets/，2026-11-27 快照）

`index-CFwD6Y0q.js`、`index-CgXlS_F3.css`、`lib-BWnBGllE.js`、`pdf-BnPRJEQ6.js`、`docx-preview-0JLj78rT.js`、`pdf.worker.min-yatZIOMy.mjs`、`index-BquMSBPp.js`、`index-CAahKYV0.js`。

---

## 16. 当前状态

> 截至 2026-11-27，git 分支 `main`，工作区干净，HEAD = `650d4db`。

### 16.1 功能状态

| 模块 | 状态 | 说明 |
|---|---|---|
| 错题库 / 掌握库 / 母题库 | ✅ 完整可用 | CRUD、OCR、三级分类、关联 |
| 知识库 + 块编辑器 + 文件阅读器 | ✅ 完整可用 | 全格式预览、手写批注 |
| 专项刷题 + 全屏考试 UI | ✅ 完整可用 | 答题卡/计时/标记/交卷/报告/下载 |
| **题库后台管理（顶部）** | ✅ **完整可用（已线上验证）** | 图片识别→JSON 结构化入库（唯一 ID/类别/模块/材料/题干/选项）→推送错题编辑页；见 9.2.1 |
| 文档转在线刷题 | ✅ 完整可用（大模型智能拆题） | 上传→AI 拆题→人工校对→组卷→无限刷题→错题入库 |
| 学习计划 + 统计 | ✅ 完整可用 | 周历/计时/子任务/图表 |
| 本地存储 + 双同步 | ✅ 完整可用 | IndexedDB 镜像、GitHub 同步、WorkBuddy 云同步 |
| 主题/字号/移动端 | ✅ 完整可用 | 日/夜、三档字号、响应式 |
| **大模型智能拆题** | ✅ **已打通并线上验证** | 见下 |

### 16.2 大模型智能拆题：从 403 到打通的完整结论（复现者必读）

**当前状态：AI 能力已开通，线上实测可用**（2026-11-27）。这是通过「重建应用并声明 AI 能力」解决的，过程与结论如下：

- **旧应用**（`wbapp_jw6026ZNcqYFzU3nV4V2iA`）数据面调用始终返回 HTTP 403 `capability_disabled`：「该应用未开通 AI 能力，请先在设置里开启」。此错误码由**服务端下发**（SDK 源码里不存在），是应用级能力标记。
- 服务端管理接口 `workbuddy_cloudservice_llm_list_models` 显示模型目录完整（几十个模型全部 `enabled:true`）——即模型本身可用，唯独该应用的数据面通道被禁。
- 平台侧**没有用户可见的 AI 能力开关**：WorkBuddy「云服务」面板只有数据库/文件存储/身份认证/数据统计四项；`activate(reuse)` 带 intent 也无效。官方机制是「**创建应用时**在需求中声明接入大模型，由 WorkBuddy 写入能力标记」——事后无法补开。
- **解法**：用 `workbuddy_cloud_service` 的 `activate(applicationMode=create, intent="接入大模型实现文档智能拆题")` 新建应用 `wbapp_6G3nteaUKurmlxHnjcgVk3`，创建即带 AI 能力。实测 `models.list()` 返回 14 个模型、真实 `chat.completions.create` 返回 OK。
- **Origin 匹配**：新应用 publishableKey 只接受新域名 Origin。故必须从新域名 `xingce-workbench-ai.app.workbuddy.host` 发布（旧域名 Origin 调用返回 403）。发布工具按目录绑定，需从独立目录 `/Users/kondolph/WorkBuddy/xingce-workbench-ai` 发布（见 15.2 的坑说明）。
- **线上端到端验证**：浏览器内调用应用 `probeLlm(true)` 返回 `{available:true, reason:'ok', message:'大模型智能拆题已就绪'}`；调用 `structureQuestions()` 对 2 题样卷正确拆题并回填答案（1.D、2.A）。
- 降级仍保留：非白名单域名（如 GitHub Pages）或能力不可用时，`llm.ts` 会自动降级为「规则拆题 + 人工校对确认组卷」，功能不受影响。

#### 拆题性能与进度优化（2026-11-27 后续修复）

用户反馈「拆题卡在 76% 没反应」，根因与修复：

- **根因**：① `structureQuestions` 原用 `usable.find(isDefault)` 选中 `auto`（推理型模型，`onlyReasoning:true`/`effort:high`），长文拆题慢；② 长文本切多批**串行**调用，每批数秒、几十批累计很久；③ 调用期间无进度反馈，进度条卡在 76% 不动，用户误以为死机；④ 无超时，异常时永久挂起。
- **修复**（`src/lib/llm.ts`）：
  - `pickFastModel()`：优先选非推理快模型 `hunyuan-chat`（显式排除 `auto`/`onlyReasoning`/图像视频模型）。
  - **受限并发 3 批并行**（`CONCURRENCY=3`），大幅缩短总耗时。
  - **单批 45s 超时**（`CHUNK_TIMEOUT_MS`），超时自动降级，不再永久挂起。
  - **token 级进度回调**：`structureChunk` 每收到流式 chunk 上报字符数，主流程汇总成单调递增的 `fraction`（0~1），paperParser 映射到进度条 76~91%（`llm.ts` 的 `LlmProgress.fraction` 由 `paperParser.ts` 消费），进度条随生成实时前进。
  - **字段名兼容**：`normalizeQuestion` 兼容模型返回的 `question/id/ans/answer` 等别名，选项支持数组 / `{A,B,C,D}` 对象 / 内联字符串三种形态；SYSTEM_PROMPT 明确要求用 `stem` + 4 元素数组。
  - 批次大小 8000 字符。
- 验证：4 题真实样卷全部正确拆出（答案 D/A/A/C），进度单调 0→0.99；12 题样卷正确拆出、无页面错误。

#### 题库拆题准确度优化：以人工矫正题为准（2026-11-27 后续修复）

用户给出题库后台「免密支付」言语理解题的人工矫正结果（类别单选题、模块言语理解、材料=文段原文、题干=「对上述文段主旨概括准确的是：」、4 条独立选项、答案 B），要求据此优化拆题流程。

- **问题定位**：原流程模型常把整段文段塞进 `stem`、设问句丢失；OCR 把四选项挤在同一行时被当成一条；答案标注随选项被切掉；模块误填默认「常识」；去重只看 `stem` 导致同设问题互删。
- **修复**：
  - `src/lib/questionRefine.ts`（新增）：纯函数后处理，按上述四项规则修复；LLM 输出（`normalizeBankQuestion`）与规则兜底（`ruleParse`/`toBankQuestions`）统一经过。
  - `src/lib/llm.ts`：`BANK_SYSTEM_PROMPT` 加入该题完整人工矫正 JSON 作为 few-shot，并明确 material/stem 边界与「不凭内容猜答案」；题库去重键改为材料+题干+选项指纹。
  - `scripts/test-refine.mjs` + `package.json` 的 `test:refine`：4 项回归测试全部通过。
- **验证**：`npm run test:refine` 4/4 通过；`npm run typecheck`、`npm run build` 通过；1440×900 Chrome 冒烟测试题库页无 pageerror。

#### 材料富文本升级：支持插入图片与文字排版（2026-11-27）
- 需求：题库编辑页的材料输入支持插入图片、拖拽调整大小、文字排版，以适配图形推理/资料分析图表题。
- 实现：新增 `RichTextEditor.tsx` + `richText.ts`，`BankQuestion` 增加可选 `materialHtml`，`material` 保持纯文本兼容；列表渲染缩略图、关键词搜索走纯文本、推送错题把内嵌图片并入 images。
- 验证：E2E 覆盖加粗、插入图片、拖拽缩放（360→440px）、保存后 JSON 字段（material/materialHtml/尺寸）、列表缩略图、旧题纯文本降级、390px 手机端无溢出、暗色主题文字色；`typecheck`/`test:refine`/`build` 全通过。

### 16.3 最近提交历史

```
7d1a5ca feat: 题库材料富文本编辑器——文字排版、插入图片与拖拽缩放，适配图形推理/资料分析  ← HEAD
03200c2 docs: 固化题库编辑到拆题能力优化的闭环约定
c1bb5d2 fix: 按人工矫正结果优化题库拆题准确度——文段/设问拆分、单行选项切分、答案回填与回归测试
5b46723 feat: 新增题库后台管理（顶部）——图片识别按JSON结构化入库并推送错题编辑页
5cffc58 perf: 优化大模型拆题速度与进度反馈，修复卡在76%无响应
c990164 feat: 接入大模型智能拆题——重建应用开通 AI 能力并切换到新域名
650d4db fix: 智能拆题跨域失败提示改为友好中文指引
80c71e9 feat: 启用大模型智能拆题（运行时探测）+ 人工校对确认组卷流程
c081dd0 fix: 修复文档识别排版紊乱并新增人工审核，优化文档加载与手写性能
aaca850 feat: 知识库文档手写批注 + 文档转在线试卷刷题模块
d1c3c90 feat: 优化同步配色并将主题字号设置移入设置面板
```

---

## 17. 已知限制与坑

复现/维护时必须注意：

1. **LLM 能力必须靠「创建时声明」开通**：见 16.2。旧应用事后补声明无效；已改用带 AI 能力的新应用。`llm.ts` 的运行时探测 + 降级仍是正确的健壮性设计。
2. **严格 TS 检查**：`noUnusedLocals`/`noUnusedParameters` 开启，任何未使用变量/参数都会让 `npm run build` 失败。
3. **云同步域名校验**：WorkBuddy 云服务严格执行 Origin 白名单，GitHub Pages 域名下云同步不可用（但本地功能和 GitHub 同步正常）。
4. **SDK 依赖安装**：`@tencent-ai/workbuddy-cloud-sdk` 走内部渠道，`npm install` 普通 `pdfjs-dist` 等操作可能清掉 `--no-save` 的 playwright-core；云 SDK 安装失败时按 skill 指引切换 CDN。
5. **图片存储**：OCR 识别用原图（不压缩），存储用压缩图；两种 DataURL 都要保留在 `image.ts` 的逻辑里。
6. **首帧性能**：`readCachedAll` 必须同步读 localStorage 内存镜像，否则含大图 Base64 的 JSON.parse 会阻塞首屏。
7. **墓碑机制**：删除是写墓碑而非真删（同步需要），`clearAll` 写全量墓碑；不要绕过直接操作 IndexedDB。
8. **HashRouter**：所有链接用 `#/path` 形式；OAuth 回调 redirectTo 必须用站点根（否则 code 落入 hash 片段读不到）。
9. **块编辑器 XSS**：所有 HTML 注入前必须 `escapeHtml` / `DOMPurify.sanitize`，URL 走 safeUrl 白名单。
10. **Prism CDN**：代码块高亮依赖外部 CDN，离线时降级为纯文本（不影响功能）。
11. **flowus-editor/ 是死代码**：早期原型，主站不引用，复现时可忽略。

---

## 18. 下一步计划

按优先级排序：

### P0 — 打通大模型智能拆题 ✅ 已完成（2026-11-27）
- 已通过重建应用 `wbapp_6G3nteaUKurmlxHnjcgVk3` 并声明 AI 能力打通，`cloud.ts` 已指向新 endpoint/key，线上端到端验证通过（见 16.2）。
- 后续维护注意：站点源码在本目录，但 WorkBuddy 发布目录是 `/Users/kondolph/WorkBuddy/xingce-workbench-ai`。功能改动后需先把变更同步到该目录再从那里发布，否则线上还是旧代码。

### P1 — 可选增强（用户此前未明确要求，供参考）
- 离线兜底：Prism 高亮本地化，去除 CDN 依赖。
- 测试建设：拆题后处理回归测试已固化（`npm run test:refine`）；Playwright E2E 仍为临时脚本，未固化。
- 同步冲突可视化：mergeStores 冲突时给用户更明确的提示界面。

### P2 — 持续约定
- 任何功能改动后：推送 `main` 触发 GitHub Pages + 复用 `applicationId` 重新发布 WorkBuddy 分享链接（域名/分享码不变）。
- 每次改动前先任务拆解评估，改完构建 + E2E 验证，再提交与发布。
- **题库编辑 → 拆题能力闭环（强制）**：用户每次对题库题目做人工编辑矫正（材料/题干/选项/答案/模块/类别等变更）后，都要把该次矫正当作新标注样本，主动复盘并优化拆题能力与流程：
  1. 对比识别输出与人工矫正结果，定位问题属于提示词、确定性后处理（`questionRefine.ts`）、去重键还是 OCR/切分逻辑；
  2. 把矫正样本沉淀为 `BANK_SYSTEM_PROMPT` 的 few-shot 或 `questionRefine.ts` 的修复规则，并在 `scripts/test-refine.mjs` 新增对应回归用例；
  3. 跑 `npm run test:refine` + `npm run build`，同步更新本文档 9.2.1 / 16.2 / 16.3，再 commit + push + 重新发布；
  4. 目标：同类错误不再复现，拆题准确度随每次人工矫正持续提升。

---

## 附录 A：关键常量速查

| 常量 | 值 |
|---|---|
| IndexedDB 数据库名 / 版本 | `xingce-workbench` / `5` |
| localStorage 前缀 | `xingce-cache-v1-` / `xingce-deleted-v1-` |
| 云表 | `workbench_items` |
| GitHub 默认仓库/分支/路径 | `xingce-workbench-data` / `data` / `workbench-snapshot.json` |
| WorkBuddy endpoint（AI 版） | `https://xingce-workbench-ai.app.workbuddy.host` |
| WorkBuddy publishableKey（AI 版） | `wbpk_6G3nteaUKurmlxHnjcgVk3_BV5PE2vtrQdfg0w8QGMoc8pGU0tkMwCX` |
| LLM 分批大小 | 12000 字符 |
| DB 超时兜底 | 800ms |
| 同步防抖 | WorkBuddy 云 700ms / GitHub 1200ms |
| 备份版本 | 本地 3 / 云导出 2 / 快照 1 |

## 附录 B：应用 ID

- WorkBuddy applicationId（当前 AI 版）：`wbapp_6G3nteaUKurmlxHnjcgVk3`（分享码 `QEQEGZR6PN`）
- WorkBuddy applicationId（旧版，保留未发布）：`wbapp_jw6026ZNcqYFzU3nV4V2iA`（分享码 `42GZLX32U2`，无 AI 能力）
- GitHub 仓库：`dolphkon/xingce-workbench`（站点源码）+ `dolphkon/xingce-workbench-data`（数据同步，私有）

---

*文档结束。若复现过程中遇到与本文不符之处，以源码为准并回更新本文档。*
