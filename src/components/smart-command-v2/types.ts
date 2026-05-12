export type SmartCommandCardKind = 'ask' | 'discuss' | 'summarize' | 'actions';

export type SmartCommandCardTheme = {
  background: string;
  accent: string;
  text: string;
  mutedText: string;
  buttonBackground: string;
  buttonText: string;
};

export const SMART_COMMAND_THEMES: Record<SmartCommandCardKind, SmartCommandCardTheme> = {
  ask: {
    background: '#1E3AFC',
    accent: '#D7E1FF',
    text: '#FFFFFF',
    mutedText: 'rgba(255,255,255,0.82)',
    buttonBackground: '#FFFFFF',
    buttonText: '#1E3AFC',
  },
  discuss: {
    background: '#F3F4F6',
    accent: '#111827',
    text: '#111827',
    mutedText: '#4B5563',
    buttonBackground: '#FFFFFF',
    buttonText: '#111827',
  },
  summarize: {
    background: '#FF6A00',
    accent: '#FFE4CC',
    text: '#FFFFFF',
    mutedText: 'rgba(255,255,255,0.85)',
    buttonBackground: '#FFFFFF',
    buttonText: '#C2410C',
  },
  actions: {
    background: '#F3F4F6',
    accent: '#111827',
    text: '#111827',
    mutedText: '#4B5563',
    buttonBackground: '#FFFFFF',
    buttonText: '#111827',
  },
};
