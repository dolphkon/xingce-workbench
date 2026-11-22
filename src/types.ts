export const QUESTION_TYPES = [
  '言语理解',
  '数量关系',
  '判断推理',
  '资料分析',
  '常识判断',
  '其他',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

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
}

export interface KnowledgeDoc {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  createdAt: number
  updatedAt: number
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
}
