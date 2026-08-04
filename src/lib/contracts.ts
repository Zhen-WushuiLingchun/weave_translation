export type TranslationKind = 'selection' | 'page' | 'subtitle' | 'summary' | 'explain';
export type PageMode = 'original' | 'bilingual' | 'translated';
export type DockSide = 'left' | 'right';
export type ProviderKind = 'deepseek' | 'openai-compatible';
export type ReasoningMode = 'compatible' | 'fast' | 'balanced' | 'deep';
export type TranslationScope = 'page' | 'selection' | 'subtitle';
export type TranslationTheme = 'auto' | 'light' | 'dark';

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

export interface MathFragment {
  token: string;
  latex: string;
  display: boolean;
  fallback: string;
}

export type MathContext = Omit<MathFragment, 'token'>;

export interface ContextBlock {
  id: string;
  text: string;
  tag: string;
  headingPath: string[];
  index: number;
  math?: MathFragment[];
  contextMath?: MathContext[];
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
  math?: MathFragment[];
  contextMath?: MathContext[];
}

export interface TranslationTask {
  id: string;
  kind: TranslationKind;
  scope: TranslationScope;
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
  autoTranslate?: boolean;
  paused?: boolean;
  hidden?: boolean;
  pageMode?: PageMode;
  targetLanguage?: string;
  reasoningMode?: ReasoningMode;
  theme?: TranslationTheme;
}

export interface ResolvedSiteRule {
  autoTranslate: boolean;
  paused: boolean;
  hidden: boolean;
  pageMode?: PageMode;
  targetLanguage?: string;
  reasoningMode?: ReasoningMode;
  theme?: TranslationTheme;
  matchedPatterns: string[];
}

export interface ReasoningSettings {
  page: ReasoningMode;
  selection: ReasoningMode;
  subtitle: ReasoningMode;
}

export interface WeaveSettings {
  provider: ProviderProfile;
  sourceLanguage: string;
  targetLanguage: string;
  contextEnabled: boolean;
  selectionEnabled: boolean;
  reasoning: ReasoningSettings;
  pageTheme: TranslationTheme;
  dock: DockState;
  video: VideoSettings;
  siteRules: Record<string, SiteRule>;
}

export type PublicSettings = WeaveSettings;

export type RuntimeRequest =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<WeaveSettings> }
  | { type: 'SAVE_SITE_RULE'; host: string; patch: Partial<SiteRule> }
  | { type: 'DELETE_SITE_RULE'; pattern: string }
  | { type: 'SAVE_DOCK_STATE'; patch: Partial<DockState> }
  | { type: 'SET_API_KEY'; apiKey: string; persistence: 'local' | 'session' }
  | { type: 'CLEAR_API_KEY' }
  | { type: 'TEST_PROVIDER'; profile: Omit<ProviderProfile, 'hasApiKey'>; candidateKey?: string }
  | { type: 'TRANSLATE'; task: TranslationTask }
  | { type: 'FETCH_CAPTION_JSON'; url: string }
  | { type: 'CLEAR_CACHE'; scope: 'all' | 'site'; host?: string }
  | { type: 'OPEN_OPTIONS' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };
