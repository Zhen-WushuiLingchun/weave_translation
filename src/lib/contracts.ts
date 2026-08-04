export type TranslationKind = 'selection' | 'page' | 'subtitle' | 'summary' | 'explain';
export type PageMode = 'original' | 'bilingual' | 'translated';
export type DockSide = 'left' | 'right';
export type ProviderKind = 'deepseek' | 'openai-compatible';
export type ReasoningMode = 'compatible' | 'fast' | 'balanced' | 'deep';

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderKind;
  endpoint: string;
  model: string;
  reasoningMode: ReasoningMode;
  targetLanguage: string;
  keyPersistence: 'local' | 'session';
  hasApiKey: boolean;
}

export interface ContextBlock {
  id: string;
  text: string;
  tag: string;
  headingPath: string[];
  index: number;
}

export interface ContextSnapshot {
  url: string;
  title: string;
  language: string;
  contentHash: string;
  blocks: ContextBlock[];
}

export interface ContextBrief {
  summary: string;
  terms: Array<{ source: string; preferred: string; note?: string }>;
}

export interface TranslationUnit {
  id: string;
  text: string;
  headingPath?: string[];
  before?: string;
  after?: string;
}

export interface TranslationTask {
  id: string;
  kind: TranslationKind;
  sourceLanguage: string;
  targetLanguage: string;
  units: TranslationUnit[];
  context?: ContextBrief;
  stream?: boolean;
}

export interface TranslationItem {
  id: string;
  text: string;
  error?: string;
}

export interface TranslationResult {
  taskId: string;
  items: TranslationItem[];
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  language?: string;
  speaker?: string;
}

export interface SubtitleSentence {
  id: string;
  start: number;
  end: number;
  text: string;
  cueIds: string[];
  displayParts: string[];
}

export interface DockState {
  side: DockSide;
  yRatio: number;
  pinned: boolean;
  pageMode: PageMode;
}

export interface VideoSettings {
  enabled: boolean;
  mode: 'bilingual' | 'translated';
  fontScale: number;
  bottomOffset: number;
  backgroundOpacity: number;
}

export interface SiteRule {
  autoTranslate: boolean;
  paused: boolean;
  hidden: boolean;
}

export interface WeaveSettings {
  provider: ProviderProfile;
  sourceLanguage: string;
  targetLanguage: string;
  contextEnabled: boolean;
  selectionEnabled: boolean;
  dock: DockState;
  video: VideoSettings;
  siteRules: Record<string, SiteRule>;
}

export type PublicSettings = WeaveSettings;

export type RuntimeRequest =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<WeaveSettings> }
  | { type: 'SAVE_SITE_RULE'; host: string; patch: Partial<SiteRule> }
  | { type: 'SAVE_DOCK_STATE'; patch: Partial<DockState> }
  | { type: 'SET_API_KEY'; apiKey: string; persistence: 'local' | 'session' }
  | { type: 'CLEAR_API_KEY' }
  | { type: 'TEST_PROVIDER'; profile: Omit<ProviderProfile, 'hasApiKey'>; candidateKey?: string }
  | { type: 'TRANSLATE'; task: TranslationTask }
  | { type: 'SYNC_GLOBAL_CONTENT' }
  | { type: 'GET_PERMISSION_STATE' }
  | { type: 'INJECT_ACTIVE_TAB'; tabId?: number }
  | { type: 'FETCH_CAPTION_JSON'; url: string }
  | { type: 'CLEAR_CACHE'; scope: 'all' | 'site'; host?: string }
  | { type: 'OPEN_OPTIONS' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };
