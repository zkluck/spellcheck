import { ErrorItem } from '@/types/error';

// 1. State Shape
export interface HomeState {
  text: string;
  errors: ErrorItem[];
  apiError: string | null;
  isLoading: boolean;
  activeErrorId: string | null;
  history: { text: string; errors: ErrorItem[] }[];
}

// Initial State
export const initialState: HomeState = {
  text: '',
  errors: [],
  apiError: null,
  isLoading: false,
  activeErrorId: null,
  history: [],
};

// 2. Action Types
export type HomeAction =
  | { type: 'SET_TEXT'; payload: string }
  | { type: 'START_CHECK' }
  | { type: 'STREAM_MERGE_ERRORS'; payload: ErrorItem[] }
  | { type: 'FINISH_CHECK'; payload: ErrorItem[] }
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
      };
    case 'START_CHECK':
      return {
        ...state,
        isLoading: true,
        errors: [],
        apiError: null,
        activeErrorId: null,
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
        errors: action.payload,
        history: [...state.history, { text: state.text, errors: action.payload }],
      };
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
      };
    default:
      return state;
  }
}
