import type { SiteRule, WeaveSettings } from './contracts';

export const DEFAULT_SITE_RULE: SiteRule = {
  autoTranslate: false,
  paused: false,
  hidden: false,
};

export const DEFAULT_SETTINGS: WeaveSettings = {
  provider: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'deepseek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    reasoningMode: 'compatible',
    targetLanguage: 'zh-CN',
    keyPersistence: 'local',
    hasApiKey: false,
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  contextEnabled: true,
  selectionEnabled: true,
  dock: {
    side: 'right',
    yRatio: 0.42,
    pinned: false,
    pageMode: 'bilingual',
  },
  video: {
    enabled: false,
    mode: 'bilingual',
    fontScale: 1,
    bottomOffset: 12,
    backgroundOpacity: 0.72,
  },
  siteRules: {},
};
