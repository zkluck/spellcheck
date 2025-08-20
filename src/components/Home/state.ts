import { ErrorItem } from '@/types/error';

// 1. State Shape
export interface HomeState {
  text: string;
  errors: ErrorItem[];
  apiError: string | null;
  isLoading: boolean;
  activeErrorId: string | null;
  history: { text: string; errors: ErrorItem[] }[];
  reviewerMeta: any | null;
  // 分组视图：按“检测轮次”记录每轮原始最终错误集（未与历史轮次合并）
  runs: { id: string; name: string; finishedAt: number; errors: ErrorItem[]; runIndex: number }[];
}

// Initial State
export const initialState: HomeState = {
  text: '',
  errors: [],
  apiError: null,
  isLoading: false,
  activeErrorId: null,
  history: [],
  reviewerMeta: null,
  runs: [],
};

// 2. Action Types
export type HomeAction =
  | { type: 'SET_TEXT'; payload: string }
  | { type: 'START_CHECK' }
  | { type: 'STREAM_MERGE_ERRORS'; payload: ErrorItem[] }
  // FINISH_CHECK：errors 为“综合视图（跨轮次已合并）”；runRaw 为“本轮原始最终结果”；finishedAt 用于分组时间戳
  | { type: 'FINISH_CHECK'; payload: { errors: ErrorItem[]; reviewer?: any | null; runRaw?: ErrorItem[]; finishedAt?: number } }
  // APPEND_RUN：在某一步骤（runIndex）结束时，追加该步骤的原始最终结果；若同一 runIndex 已存在则合并更新
  | { type: 'APPEND_RUN'; payload: { errors: ErrorItem[]; runIndex?: number; finishedAt?: number } }
  | { type: 'SET_API_ERROR'; payload: string }
  | { type: 'APPLY_ERROR'; payload: { newText: string; remainingErrors: ErrorItem[] } }
  | { type: 'APPLY_ALL_ERRORS'; payload: string }
  | { type: 'UNDO' }
  | { type: 'SET_ACTIVE_ERROR'; payload: string | null }
  | { type: 'IGNORE_ERROR', payload: string }
  | { type: 'CLEAR_RESULTS' };

// 3. Reducer Function
export function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'SET_TEXT':
      return {
        ...state,
        text: action.payload,
        errors: [],
        apiError: null,
        activeErrorId: null,
        // 编辑文本时清空分组结果，避免跨文本混淆
        runs: [],
      };
    case 'START_CHECK':
      return {
        ...state,
        isLoading: true,
        apiError: null,
        activeErrorId: null,
        reviewerMeta: null,
      };
    case 'STREAM_MERGE_ERRORS':
      return {
        ...state,
        errors: action.payload,
      };
    case 'FINISH_CHECK':
      return {
        ...state,
        isLoading: false,
        errors: action.payload.errors,
        reviewerMeta: action.payload.reviewer ?? null,
        history: [...state.history, { text: state.text, errors: action.payload.errors }],
        // 向后兼容：若无分步上报（runs 仍为空）且提供 runRaw，则补充一条单步记录
        runs: (() => {
          const arr = state.runs.slice();
          const raw = action.payload.runRaw;
          if (arr.length === 0 && raw && Array.isArray(raw)) {
            const idx = arr.length + 1;
            const ts = action.payload.finishedAt ?? Date.now();
            arr.push({ id: `run-${ts}-${idx}`, name: `步骤${idx}`, finishedAt: ts, errors: raw, runIndex: 0 });
          }
          return arr;
        })(),
      };
    case 'APPEND_RUN': {
      // 说明：根据 runIndex 追加或更新一步骤的原始最终结果。
      // - 若 runIndex 缺省，则按当前长度顺序追加。
      // - 若相同 runIndex 已存在，则覆盖其 errors 与 finishedAt（去重）。
      const arr = state.runs.slice();
      const idx = ((): number => {
        const ri = action.payload.runIndex;
        if (typeof ri === 'number' && ri >= 0) return ri;
        return arr.length; // 追加在末尾
      })();
      const ts = action.payload.finishedAt ?? Date.now();
      const existAt = arr.findIndex((r) => r.runIndex === idx);
      if (existAt >= 0) {
        arr[existAt] = { ...arr[existAt], errors: action.payload.errors, finishedAt: ts };
      } else {
        const displayIdx = arr.length + 1;
        arr.push({ id: `run-${ts}-${displayIdx}`, name: `步骤${displayIdx}`, finishedAt: ts, errors: action.payload.errors, runIndex: idx });
      }
      return { ...state, runs: arr };
    }
    case 'SET_API_ERROR':
      return {
        ...state,
        isLoading: false,
        apiError: action.payload,
      };
    case 'APPLY_ERROR':
      return {
        ...state,
        history: [...state.history, { text: state.text, errors: state.errors }],
        text: action.payload.newText,
        errors: action.payload.remainingErrors,
        activeErrorId: null,
      };
    case 'APPLY_ALL_ERRORS':
       return {
        ...state,
        history: [...state.history, { text: state.text, errors: state.errors }],
        text: action.payload,
        errors: [],
        activeErrorId: null,
      };
    case 'UNDO':
      const lastState = state.history[state.history.length - 1];
      if (!lastState) return state;
      return {
        ...state,
        ...lastState,
        history: state.history.slice(0, -1),
      };
    case 'SET_ACTIVE_ERROR':
      return {
        ...state,
        activeErrorId: action.payload,
      };
    case 'IGNORE_ERROR':
      return {
        ...state,
        errors: state.errors.filter(e => e.id !== action.payload),
        activeErrorId: state.activeErrorId === action.payload ? null : state.activeErrorId,
      };
    case 'CLEAR_RESULTS':
      return {
        ...state,
        errors: [],
        activeErrorId: null,
        apiError: null,
        reviewerMeta: null,
        runs: [],
      };
    default:
      return state;
  }
}
