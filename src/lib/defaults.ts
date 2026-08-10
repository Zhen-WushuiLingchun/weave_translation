import type { SiteRule, TaskRoutes, WeaveSettings } from './contracts';

export const DEFAULT_SITE_RULE: Required<Pick<SiteRule, 'autoTranslate' | 'paused' | 'hidden'>> = {
  autoTranslate: false,
  paused: false,
  hidden: false,
};

export const DEFAULT_TASK_ROUTES: TaskRoutes = {
  pageContext: { profileId: 'deepseek-chat', reasoningMode: 'balanced', glossaryMode: 'matched' },
  pageTranslation: { profileId: 'deepseek-chat', reasoningMode: 'balanced', glossaryMode: 'hybrid' },
  selectionTranslation: { profileId: 'deepseek-chat', reasoningMode: 'fast', glossaryMode: 'hybrid' },
  selectionExplanation: { profileId: 'deepseek-chat', reasoningMode: 'balanced', glossaryMode: 'hybrid' },
  videoContext: { profileId: 'deepseek-chat', reasoningMode: 'fast', glossaryMode: 'matched' },
  subtitleTranslation: { profileId: 'deepseek-chat', reasoningMode: 'fast', glossaryMode: 'hybrid' },
  transcription: { profileId: '', reasoningMode: 'compatible', glossaryMode: 'matched' },
};

export const DEFAULT_SETTINGS: WeaveSettings = {
  schemaVersion: 2,
  connections: [{
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'deepseek',
    chatEndpoint: 'https://api.deepseek.com/chat/completions',
    transcriptionEndpoint: '',
    secretRef: 'deepseek',
    keyPersistence: 'local',
    hasApiKey: false,
    transcriptionResponseMode: 'verbose_json',
  }],
  models: [{
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    connectionId: 'deepseek',
    model: 'deepseek-v4-flash',
    capabilities: ['chat', 'tools', 'reasoningEffort'],
    enabled: true,
  }],
  taskRoutes: DEFAULT_TASK_ROUTES,
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  contextEnabled: true,
  selectionEnabled: true,
  reasoning: { page: 'balanced', selection: 'fast', subtitle: 'fast' },
  pageTheme: 'auto',
  dock: { side: 'right', yRatio: 0.42, pinned: false, pageMode: 'bilingual' },
  video: {
    enabled: false,
    mode: 'bilingual',
    fontScale: 1,
    bottomOffset: 12,
    backgroundOpacity: 0.72,
    asrLanguage: 'auto',
  },
  siteRules: {},
};
