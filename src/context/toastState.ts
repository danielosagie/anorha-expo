export const TOAST_TONES = ['neutral', 'success', 'warn', 'danger'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

export const TOAST_ACTION_LABELS = ['Undo', 'Retry', 'View', 'Review'] as const;
export type ToastActionLabel = (typeof TOAST_ACTION_LABELS)[number];

export type ToastAction = {
  label: ToastActionLabel;
  onPress: () => void;
};

export type ToastInput = {
  title: string;
  tone: ToastTone;
  action?: ToastAction;
};

export type ToastRecord = ToastInput & {
  id: number;
  shownAt: number;
};

export type ToastState = {
  current: ToastRecord | null;
  nextId: number;
};

export type ToastEvent =
  | { type: 'show'; input: ToastInput; now: number }
  | { type: 'dismiss'; id?: number };

export const initialToastState: ToastState = {
  current: null,
  nextId: 1,
};

export function normalizeToastTitle(title: string): string {
  if (typeof title !== 'string') return 'Something went wrong';
  const words = title.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return 'Update';
  return words.slice(0, 4).join(' ');
}

function normalizeToastInput(input: ToastInput): ToastInput {
  const tone = TOAST_TONES.includes(input.tone) ? input.tone : 'neutral';
  const action = input.action && TOAST_ACTION_LABELS.includes(input.action.label)
    ? input.action
    : undefined;
  return {
    title: normalizeToastTitle(input.title),
    tone,
    ...(action ? { action } : {}),
  };
}

export function getToastDuration(input: Pick<ToastInput, 'action'>): number {
  return input.action ? 5000 : 3000;
}

export function toastReducer(state: ToastState, event: ToastEvent): ToastState {
  if (event.type === 'show') {
    return {
      current: {
        ...normalizeToastInput(event.input),
        id: state.nextId,
        shownAt: event.now,
      },
      nextId: state.nextId + 1,
    };
  }

  if (!state.current || (event.id != null && event.id !== state.current.id)) {
    return state;
  }

  return { ...state, current: null };
}
