/**
 * 公考模块分类体系：模块（如言语理解）→ 题型（如片段阅读）→ 考点（如主旨概括）。
 * 模块支持自定义增删，题型/考点随模块维护；错题与母题通过「考点」自动关联。
 */
export interface QuestionCategory {
  id: string
  name: string
  types: string[]
  points: string[]
  /** 题型 → 该题型可用考点；未配置的题型沿用模块全部考点 */
  typePoints?: Record<string, string[]>
  createdAt: number
  updatedAt: number
}

export interface SeedCategory {
  name: string
  types: string[]
  points: string[]
  typePoints?: Record<string, string[]>
}

/** 首次使用时预置的公考模块（可自由增删/修改） */
export const DEFAULT_CATEGORIES: SeedCategory[] = [
  {
    name: '言语理解',
    types: ['片段阅读', '逻辑填空', '语句表达', '篇章阅读'],
    points: ['主旨概括', '意图判断', '细节理解', '标题选择', '语句排序', '词语辨析', '语句填空'],
    typePoints: {
      片段阅读: ['主旨概括', '意图判断', '细节理解', '标题选择'],
      逻辑填空: ['词语辨析', '语句填空'],
      语句表达: ['语句排序', '语句填空'],
      篇章阅读: ['主旨概括', '细节理解', '标题选择'],
    },
  },
  {
    name: '数量关系',
    types: ['数学运算', '数字推理'],
    points: ['工程问题', '行程问题', '排列组合', '概率问题', '几何问题', '利润问题', '容斥问题'],
  },
  {
    name: '判断推理',
    types: ['图形推理', '定义判断', '类比推理', '逻辑判断'],
    points: ['削弱论证', '加强论证', '翻译推理', '真假推理', '图形规律', '空间重构', '集合关系'],
    typePoints: {
      图形推理: ['图形规律', '空间重构'],
      定义判断: ['集合关系'],
      类比推理: ['集合关系'],
      逻辑判断: ['削弱论证', '加强论证', '翻译推理', '真假推理'],
    },
  },
  {
    name: '资料分析',
    types: ['文字材料', '表格材料', '图形材料', '综合材料'],
    points: ['增长率', '增长量', '比重', '平均数', '倍数', '混合增长', '隔年增长'],
  },
  {
    name: '常识判断',
    types: ['政治', '法律', '经济', '人文', '科技', '地理'],
    points: ['宪法', '民法典', '科技常识', '党史', '宏观经济', '文学常识'],
    typePoints: {
      政治: ['党史'],
      法律: ['宪法', '民法典'],
      经济: ['宏观经济'],
      人文: ['文学常识'],
      科技: ['科技常识'],
      地理: ['文学常识', '科技常识'],
    },
  },
  {
    name: '其他',
    types: ['申论', '面试'],
    points: ['归纳概括', '综合分析', '提出对策', '文章写作'],
    typePoints: {
      申论: ['归纳概括', '综合分析', '提出对策', '文章写作'],
      面试: ['综合分析', '提出对策'],
    },
  },
]

/** 兼容旧代码：默认模块名列表。实际选项由 categories store 动态提供。 */
export const QUESTION_TYPES: readonly string[] = DEFAULT_CATEGORIES.map((item) => item.name)
/** 兼容旧类型：现在允许自定义模块名，故为字符串 */
export type QuestionType = string

export interface Mistake {
  id: string
  title: string
  type: QuestionType
  options: string[]
  answer: string
  userAnswer: string
  analysis: string
  tags: string[]
  images: string[]
  createdAt: number
  updatedAt: number
  lastReviewedAt?: number
  reviewCount: number
  correctCount: number
  motherId?: string
  source?: string
  /** 用户手填的正确率（0–100），与刷题统计相互独立 */
  accuracy?: number
  /** 所属模块 id（对应 QuestionCategory.id） */
  categoryId?: string
  /** 题型（模块下的 types 之一） */
  subType?: string
  /** 考点（模块下的 points 之一），错题与母题据此关联 */
  point?: string
  /** 是否关联母题：关闭后即使有历史考点也不参与自动关联 */
  linkMother?: boolean
}

/* ---------- FlowUs 式块文档 ---------- */
export type BlockType =
  | 'text' | 'h1' | 'h2' | 'h3' | 'todo' | 'bullet' | 'number' | 'quote'
  | 'code' | 'table' | 'divider' | 'image' | 'video' | 'link' | 'docref' | 'attachment'

/** 块内附件（Base64 DataURL 存储，支持多文件） */
export interface DocAttachment {
  id: string
  name: string
  fileType: string
  fileData: string
  size: number
}

export interface DocBlock {
  id: string
  type: BlockType
  /** contentEditable 块的富文本 HTML */
  html: string
  /** 纯文本，便于快捷输入、搜索与字数统计 */
  text: string
  checked?: boolean
  language?: string
  rows?: string[][]
  src?: string
  href?: string
  docId?: string
  /** 图片块显示宽度百分比（10~300，默认 100），随文档保存 */
  imgWidth?: number
  /** 附件列表（attachment 块） */
  attachments?: DocAttachment[]
}

/** 知识库文件夹（独立于文档，支持空文件夹与无限层级子文件夹） */
export interface KnowledgeFolder {
  id: string
  name: string
  /** 父文件夹 id；空值表示根目录 */
  parentId?: string | null
  createdAt: number
  updatedAt: number
}

export interface KnowledgeDoc {
  id: string
  title: string
  /** Markdown 纯文本，由 blocks 派生，用于预览与兼容旧数据 */
  content: string
  /** FlowUs 式块结构；新建与编辑的文档均以此为准 */
  blocks?: DocBlock[]
  /** 兼容旧数据：所属文件夹名称（现以 folderId 为准） */
  category: string
  /** 所属文件夹 id；空值表示未分类 */
  folderId?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  /** 文档类型：markdown 文本 / 上传文件（PDF、图片等） */
  kind?: 'md' | 'file'
  /** 上传文件的原始文件名 */
  fileName?: string
  /** 上传文件 MIME 类型 */
  fileType?: string
  /** 上传文件内容（DataURL），用于在线预览与下载 */
  fileData?: string
  /** 绑定的腾讯文档在线编辑链接 */
  tencentUrl?: string
}

export interface MotherQuestion {
  id: string
  title: string
  type: QuestionType
  point: string
  modelAnswer: string
  keyPoints: string[]
  tags: string[]
  source?: string
  /** 用户手填的正确率（0–100） */
  accuracy?: number
  createdAt: number
  updatedAt: number
  /** 所属模块 id */
  categoryId?: string
  /** 题型 */
  subType?: string
  /** 题目图片（OCR 识别后保存） */
  images?: string[]
  /** 选项（OCR 识别时填充，母题可选用） */
  options?: string[]
}

/* ---------- 学习计划 ---------- */
export const STUDY_MODULES = ['言语', '判断', '资料', '图推', '数量', '时政', '常识'] as const
export type StudyModule = (typeof STUDY_MODULES)[number]

export const PLAN_MODES = ['学习', '刷题'] as const
/** 兼容旧数据中「专注」模式 */
export type PlanMode = (typeof PLAN_MODES)[number] | '专注'

export const PLAN_PRIORITIES = ['重要且紧急', '重要不紧急', '紧急不重要', '不紧急不重要'] as const
export type PlanPriority = (typeof PLAN_PRIORITIES)[number]

export interface PlanSubTask {
  id: string
  /** 学习：章节/知识点名称；刷题：题型 */
  type: string
  /** 学习：预计分钟；刷题：题量 */
  count: number
  /** 刷题：做对题数 */
  correct?: number
  /** 该子任务单独累计秒数 */
  elapsedSeconds?: number
  done?: boolean
}

/** 一次计时/补录记录，用于按天统计 */
export interface PlanSession {
  id: string
  startedAt?: number
  endedAt?: number
  seconds: number
  /** 手动补录的时长 */
  manual?: boolean
  subTaskId?: string
}

export interface StudyPlan {
  id: string
  module: StudyModule
  mode: PlanMode
  title: string
  description: string
  subTasks: PlanSubTask[]
  date: string // YYYY-MM-DD
  startTime?: string
  endTime?: string
  priority: PlanPriority
  completed: boolean
  elapsedSeconds: number
  timerStartedAt?: number
  /** 专项学习：课程/资料来源（网课平台、教材、自学等） */
  source?: string
  /** 专项学习：预计投入分钟 */
  targetMinutes?: number
  /** 刷题：总题量 */
  questionCount?: number
  /** 刷题：做对题数 */
  correctCount?: number
  /** 计时历史（用于按天统计） */
  sessions?: PlanSession[]
  /** 当前正在专注的子任务 */
  activeSubTaskId?: string
  createdAt: number
  updatedAt: number
}

export interface BackupData {
  version: number
  exportedAt: number
  mistakes: Mistake[]
  docs: KnowledgeDoc[]
  mothers: MotherQuestion[]
  plans?: StudyPlan[]
  categories?: QuestionCategory[]
  folders?: KnowledgeFolder[]
}
