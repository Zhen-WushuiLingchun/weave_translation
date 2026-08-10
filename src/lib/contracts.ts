export type TranslationKind = 'selection' | 'page' | 'subtitle' | 'summary' | 'explain';
export type PageMode = 'original' | 'bilingual' | 'translated';
export type DockSide = 'left' | 'right';
export type ProviderKind = 'deepseek' | 'openai-compatible';
export type ReasoningMode = 'compatible' | 'fast' | 'balanced' | 'deep';
export type TranslationScope = 'page' | 'selection' | 'subtitle';
export type TranslationTheme = 'auto' | 'light' | 'dark';
export type SecretPersistence = 'local' | 'session';
export type ModelCapability = 'chat' | 'tools' | 'audioTranscription' | 'reasoningEffort';
export type GlossaryMode = 'off' | 'matched' | 'hybrid';
export type TaskRouteKey =
  | 'pageContext'
  | 'pageTranslation'
  | 'selectionTranslation'
  | 'selectionExplanation'
  | 'videoContext'
  | 'subtitleTranslation'
  | 'transcription';

export interface ProviderConnection {
  id: string;
  label: string;
  kind: ProviderKind;
  chatEndpoint: string;
  transcriptionEndpoint: string;
  secretRef: string;
  keyPersistence: SecretPersistence;
  hasApiKey: boolean;
  transcriptionResponseMode: 'verbose_json' | 'json' | 'text';
}

export interface ModelProfile {
  id: string;
  label: string;
  connectionId: string;
  model: string;
  capabilities: ModelCapability[];
  enabled: boolean;
}

export interface TaskRoute {
  profileId: string;
  reasoningMode: ReasoningMode;
  glossaryMode: GlossaryMode;
}

export type TaskRoutes = Record<TaskRouteKey, TaskRoute>;

/** Resolved request profile. Secrets never live on this object. */
export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderKind;
  endpoint: string;
  model: string;
  reasoningMode: ReasoningMode;
  targetLanguage: string;
  keyPersistence: SecretPersistence;
  hasApiKey: boolean;
  connectionId?: string;
  secretRef?: string;
  capabilities?: ModelCapability[];
  glossaryMode?: GlossaryMode;
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
  route?: TaskRouteKey;
  sourceLanguage: string;
  targetLanguage: string;
  units: TranslationUnit[];
  context?: ContextBrief;
  glossary?: GlossaryMatch[];
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
  suggestedTerms?: Array<{ source: string; preferred: string; note?: string }>;
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
  asrLanguage: string;
}

export interface SiteRule {
  autoTranslate?: boolean;
  paused?: boolean;
  hidden?: boolean;
  pageMode?: PageMode;
  targetLanguage?: string;
  reasoningMode?: ReasoningMode;
  pageProfileId?: string;
  pageContextProfileId?: string;
  theme?: TranslationTheme;
}

export interface ResolvedSiteRule {
  autoTranslate: boolean;
  paused: boolean;
  hidden: boolean;
  pageMode?: PageMode;
  targetLanguage?: string;
  reasoningMode?: ReasoningMode;
  pageProfileId?: string;
  pageContextProfileId?: string;
  theme?: TranslationTheme;
  matchedPatterns: string[];
}

export interface ReasoningSettings {
  page: ReasoningMode;
  selection: ReasoningMode;
  subtitle: ReasoningMode;
}

export type GlossaryScope = 'global' | 'domain' | 'host';

export interface GlossaryCollection {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryEntry {
  id: string;
  collectionId: string;
  source: string;
  preferred: string;
  aliases: string[];
  sourceLanguage: string;
  targetLanguage: string;
  domain: string;
  scope: GlossaryScope;
  scopeValue: string;
  caseSensitive: boolean;
  priority: number;
  note: string;
  enabled: boolean;
  status: 'approved' | 'suggested';
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryMatch {
  id: string;
  source: string;
  preferred: string;
  note: string;
  priority: number;
}

export interface WeaveSettings {
  schemaVersion: 2;
  connections: ProviderConnection[];
  models: ModelProfile[];
  taskRoutes: TaskRoutes;
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

export interface EffectiveRoute {
  route: TaskRouteKey;
  profileId: string;
  profileLabel: string;
  reasoningMode: ReasoningMode;
  glossaryMode: GlossaryMode;
  source: 'tab' | 'site' | 'default';
}

export interface TranscriptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  approximateTimestamps: boolean;
}

export interface AsrStatusPayload {
  state: 'idle' | 'capturing' | 'transcribing' | 'translating' | 'synced' | 'error';
  message: string;
  cues?: SubtitleCue[];
}

export type RuntimeRequest =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<WeaveSettings> }
  | { type: 'SAVE_SITE_RULE'; host: string; patch: Partial<SiteRule> }
  | { type: 'DELETE_SITE_RULE'; pattern: string }
  | { type: 'SAVE_DOCK_STATE'; patch: Partial<DockState> }
  | { type: 'SET_API_KEY'; secretRef: string; apiKey: string; persistence: SecretPersistence }
  | { type: 'CLEAR_API_KEY'; secretRef: string }
  | { type: 'TEST_CONNECTION'; connection: ProviderConnection; model: ModelProfile; capability: 'chat' | 'audioTranscription'; candidateKey?: string }
  | { type: 'SET_TAB_MODEL'; route: TaskRouteKey; profileId?: string }
  | { type: 'GET_EFFECTIVE_ROUTES' }
  | { type: 'TRANSLATE'; task: TranslationTask }
  | { type: 'FETCH_CAPTION_JSON'; url: string }
  | { type: 'GLOSSARY_LIST'; collectionId?: string; status?: GlossaryEntry['status'] }
  | { type: 'GLOSSARY_PUT'; entry: GlossaryEntry }
  | { type: 'GLOSSARY_DELETE'; id: string }
  | { type: 'GLOSSARY_IMPORT'; entries: GlossaryEntry[] }
  | { type: 'GLOSSARY_COLLECTIONS' }
  | { type: 'GLOSSARY_PUT_COLLECTION'; collection: GlossaryCollection }
  | { type: 'GLOSSARY_DELETE_COLLECTION'; id: string }
  | { type: 'ASR_START'; videoTime: number; language: string; title: string }
  | { type: 'ASR_STOP' }
  | { type: 'ASR_SYNC'; videoTime: number; playbackRate: number; paused: boolean; seeked?: boolean }
  | { type: 'ASR_AUDIO_CHUNK'; sessionId: string; wavBase64: string; start: number; end: number }
  | { type: 'ASR_CAPTURE_STATUS'; sessionId: string; state: AsrStatusPayload['state']; message: string }
  | { type: 'CLEAR_CACHE'; scope: 'all' | 'site'; host?: string }
  | { type: 'OPEN_OPTIONS' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };
