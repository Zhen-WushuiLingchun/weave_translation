import { cacheClear, cacheGet, cachePut } from '../background/cache';
import {
  deleteGlossaryCollection,
  deleteGlossaryEntry,
  importGlossaryEntries,
  listGlossaryCollections,
  listGlossaryEntries,
  lookupGlossary,
  putGlossaryCollection,
  putGlossaryEntry,
  storeSuggestedTerms,
} from '../background/glossary-store';
import { callProvider, ProviderError, validateEndpoint } from '../background/provider';
import {
  effectiveRoutes,
  profilesWithCapability,
  resolveChatRoute,
  resolveTranscriptionProfile,
  type TabRouteOverrides,
} from '../background/routing';
import {
  clearApiKey,
  deleteSiteRule,
  getApiKey,
  getSettings,
  protectStorage,
  saveDockState,
  saveSettings,
  saveSiteRule,
  setApiKey,
} from '../background/storage';
import { callTranscription, createSilentWavBase64 } from '../background/transcription';
import type {
  GlossaryLookupContext,
} from '../lib/glossary';
import { glossaryDigest } from '../lib/glossary';
import type {
  AsrStatusPayload,
  ModelProfile,
  ProviderConnection,
  ProviderProfile,
  RuntimeRequest,
  RuntimeResponse,
  SubtitleCue,
  TaskRouteKey,
  TranslationResult,
  TranslationTask,
  TranscriptionSegment,
  WeaveSettings,
} from '../lib/contracts';
import { mapCaptureRange, mergeTranscriptionSegments } from '../lib/audio';

const LEGACY_SCRIPT_ID = 'weave-global-dock';
const SCRIPT_FILES = ['/content-scripts/content.js'] as const;
const ALL_ORIGINS = ['http://*/*', 'https://*/*'];
const tabRouteOverrides = new Map<number, TabRouteOverrides>();

interface AsrSession {
  id: string;
  tabId: number;
  language: string;
  title: string;
  pageUrl: string;
  videoTime: number;
  baseCaptureTime: number;
  startedAt: number;
  playbackRate: number;
  generation: number;
  lastCaptureEnd: number;
  segments: TranscriptionSegment[];
  queue: Promise<void>;
}

const asrSessions = new Map<string, AsrSession>();

async function unregisterLegacyContent(): Promise<void> {
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [LEGACY_SCRIPT_ID] });
  if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [LEGACY_SCRIPT_ID] });
}

async function injectTab(tabId?: number): Promise<void> {
  let targetId = tabId;
  if (targetId == null) targetId = (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (targetId == null) throw new Error('没有可注入的活动网页。');
  await browser.scripting.executeScript({ target: { tabId: targetId }, files: [...SCRIPT_FILES] });
}

async function injectOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ url: ALL_ORIGINS });
  await Promise.allSettled(tabs.filter((tab) => tab.id != null).map((tab) => injectTab(tab.id)));
}

export function cacheKey(task: RuntimeRequest & { type: 'TRANSLATE' }, profile: ProviderProfile): string {
  const serialized = JSON.stringify([
    'v4', profile.id, profile.connectionId, profile.kind, profile.endpoint, profile.model, profile.reasoningMode,
    profile.glossaryMode, glossaryDigest(task.task.glossary ?? []), task.task.scope, task.task.kind,
    task.task.sourceLanguage, task.task.targetLanguage, task.task.context, task.task.units,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v4:${(hash >>> 0).toString(16)}`;
}

export function requestProfile(
  settings: WeaveSettings,
  task: TranslationTask,
  pageUrl?: string,
  overrides: TabRouteOverrides = {},
): ProviderProfile {
  return resolveChatRoute(settings, task, pageUrl, overrides).profile;
}

function allowedCaptionUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed = host === 'www.youtube.com' || host.endsWith('.youtube.com') || host.endsWith('.googlevideo.com')
    || host === 'api.bilibili.com' || host.endsWith('.hdslb.com') || host.endsWith('.bilibili.com');
  if (url.protocol !== 'https:' || !allowed) throw new Error('字幕地址不在允许的平台范围内。');
  return url;
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

function glossaryContext(task: TranslationTask, pageUrl?: string): GlossaryLookupContext {
  let hostname = '';
  try { hostname = pageUrl ? new URL(pageUrl).hostname : ''; } catch { hostname = ''; }
  return { hostname, sourceLanguage: task.sourceLanguage, targetLanguage: task.targetLanguage };
}

async function routeTask(
  settings: WeaveSettings,
  task: TranslationTask,
  pageUrl: string | undefined,
  overrides: TabRouteOverrides,
): Promise<{ profile: ProviderProfile; task: TranslationTask; connection: ProviderConnection; model: ModelProfile; glossaryContext: GlossaryLookupContext }> {
  const resolved = resolveChatRoute(settings, task, pageUrl, overrides);
  const context = glossaryContext(task, pageUrl);
  const sourceText = [task.context?.summary, ...task.units.flatMap((unit) => [unit.text, unit.before, unit.after])].filter(Boolean).join('\n');
  const matches = resolved.route.glossaryMode === 'off' ? [] : await lookupGlossary(sourceText, context);
  return { profile: resolved.profile, task: { ...task, glossary: matches }, connection: resolved.connection, model: resolved.model, glossaryContext: context };
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await browser.offscreen.hasDocument()) return;
  await browser.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: '在用户明确启动无字幕翻译后处理当前标签页音频。',
  });
}

async function sendAsrStatus(tabId: number, payload: AsrStatusPayload): Promise<void> {
  await browser.tabs.sendMessage(tabId, { type: 'WEAVE_ASR_UPDATE', payload }).catch(() => undefined);
}

function activeSessionForTab(tabId: number): AsrSession | undefined {
  return [...asrSessions.values()].find((session) => session.tabId === tabId);
}

async function stopAsrSession(tabId: number, emit = true): Promise<void> {
  const session = activeSessionForTab(tabId);
  if (!session) return;
  session.generation += 1;
  asrSessions.delete(session.id);
  await browser.runtime.sendMessage({ type: 'WEAVE_OFFSCREEN_STOP' }).catch(() => undefined);
  if (emit) await sendAsrStatus(tabId, { state: 'idle', message: '语音识别已停止' });
}

async function startAsrSession(tabId: number, videoTime: number, language: string, title: string, pageUrl: string): Promise<{ sessionId: string }> {
  const granted = await browser.permissions.request({ permissions: ['tabCapture'] });
  if (!granted) throw new ProviderError('需要“捕获当前标签页音频”权限才能生成字幕。', 'PERMISSION_DENIED');
  for (const session of [...asrSessions.values()]) await stopAsrSession(session.tabId, session.tabId !== tabId);
  await ensureOffscreenDocument();
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const session: AsrSession = {
    id: crypto.randomUUID(), tabId, language, title, pageUrl, videoTime, baseCaptureTime: 0, startedAt: Date.now(), playbackRate: 1,
    generation: 0, lastCaptureEnd: 0, segments: [], queue: Promise.resolve(),
  };
  asrSessions.set(session.id, session);
  await browser.runtime.sendMessage({ type: 'WEAVE_OFFSCREEN_START', sessionId: session.id, streamId });
  await sendAsrStatus(tabId, { state: 'capturing', message: '正在捕获标签页音频…' });
  return { sessionId: session.id };
}

function transcriptionCues(segments: TranscriptionSegment[]): SubtitleCue[] {
  return segments.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end, text: segment.text }));
}

async function processAsrChunk(session: AsrSession, message: Extract<RuntimeRequest, { type: 'ASR_AUDIO_CHUNK' }>): Promise<void> {
  const generation = session.generation;
  const settings = await getSettings();
  const override = tabRouteOverrides.get(session.tabId) ?? {};
  const { connection, model } = resolveTranscriptionProfile(settings, override);
  const apiKey = await getApiKey(connection.secretRef, connection.keyPersistence);
  if (!apiKey && !isLocalEndpoint(connection.transcriptionEndpoint)) throw new ProviderError('请先为语音识别连接填写 API Key。', 'MISSING_API_KEY');
  const mapped = mapCaptureRange(session.videoTime, session.baseCaptureTime, session.playbackRate, message.start, message.end);
  const mappedStart = mapped.start;
  const mappedEnd = mapped.end;
  session.lastCaptureEnd = message.end;
  const recentText = session.segments.slice(-12).map((segment) => segment.text).join(' ');
  const context = glossaryContext({
    id: 'asr-glossary', kind: 'subtitle', scope: 'subtitle', sourceLanguage: session.language,
    targetLanguage: settings.targetLanguage, units: [{ id: 'asr-context', text: `${session.title}\n${recentText}` }],
  }, session.pageUrl);
  const hotwords = await lookupGlossary(`${session.title}\n${recentText}`, context);
  const prompt = hotwords.map((match) => `${match.source} (${match.preferred})`).join(', ');
  await sendAsrStatus(session.tabId, { state: 'transcribing', message: '正在识别刚播放的语音…', cues: transcriptionCues(session.segments) });
  const result = await callTranscription(connection, model, apiKey, message.wavBase64, session.language, mappedStart, mappedEnd, fetch, prompt);
  if (generation !== session.generation || !asrSessions.has(session.id)) return;
  session.segments = mergeTranscriptionSegments(session.segments, result.segments);
  await sendAsrStatus(session.tabId, { state: 'synced', message: '字幕已同步', cues: transcriptionCues(session.segments) });
}

async function handleMessage(message: RuntimeRequest, sender: Browser.runtime.MessageSender): Promise<RuntimeResponse> {
  try {
    const tabId = sender.tab?.id;
    const overrides = tabId == null ? {} : (tabRouteOverrides.get(tabId) ?? {});
    switch (message.type) {
      case 'GET_SETTINGS': return { ok: true, data: await getSettings() };
      case 'SAVE_SETTINGS': return { ok: true, data: await saveSettings(message.patch) };
      case 'SAVE_SITE_RULE': return { ok: true, data: await saveSiteRule(message.host, message.patch) };
      case 'DELETE_SITE_RULE': return { ok: true, data: await deleteSiteRule(message.pattern) };
      case 'SAVE_DOCK_STATE': return { ok: true, data: await saveDockState(message.patch) };
      case 'SET_API_KEY':
        await setApiKey(message.secretRef, message.apiKey, message.persistence);
        return { ok: true, data: await getSettings() };
      case 'CLEAR_API_KEY':
        await clearApiKey(message.secretRef);
        return { ok: true, data: await getSettings() };
      case 'TEST_CONNECTION': {
        const endpoint = message.capability === 'chat' ? message.connection.chatEndpoint : message.connection.transcriptionEndpoint;
        validateEndpoint(endpoint);
        const key = message.candidateKey ?? await getApiKey(message.connection.secretRef, message.connection.keyPersistence);
        if (message.capability === 'audioTranscription') {
          const result = await callTranscription(message.connection, message.model, key, createSilentWavBase64(), 'en', 0, 0.3);
          return { ok: true, data: { result: result.text || '接口接受了测试音频。', responseMode: message.connection.transcriptionResponseMode } };
        }
        const profile: ProviderProfile = {
          id: message.model.id, label: message.model.label, kind: message.connection.kind,
          endpoint: message.connection.chatEndpoint, model: message.model.model, reasoningMode: 'compatible',
          targetLanguage: 'zh-CN', keyPersistence: message.connection.keyPersistence, hasApiKey: Boolean(key),
          connectionId: message.connection.id, secretRef: message.connection.secretRef,
          capabilities: message.model.capabilities, glossaryMode: 'off',
        };
        const result = await callProvider(profile, key, {
          id: crypto.randomUUID(), kind: 'selection', scope: 'selection', route: 'selectionTranslation',
          sourceLanguage: 'en', targetLanguage: 'zh-CN', units: [{ id: 'probe', text: 'Translation connection test.' }],
        });
        return { ok: true, data: { result: result.items[0]?.text } };
      }
      case 'SET_TAB_MODEL': {
        if (tabId == null) throw new Error('当前消息没有关联网页标签页。');
        const next = { ...overrides };
        if (message.profileId) next[message.route] = message.profileId;
        else delete next[message.route];
        tabRouteOverrides.set(tabId, next);
        return { ok: true, data: effectiveRoutes(await getSettings(), sender.tab?.url, next) };
      }
      case 'GET_EFFECTIVE_ROUTES': return { ok: true, data: effectiveRoutes(await getSettings(), sender.tab?.url, overrides) };
      case 'TRANSLATE': {
        const settings = await getSettings();
        const routed = await routeTask(settings, message.task, sender.tab?.url, overrides);
        const key = await getApiKey(routed.connection.secretRef, routed.connection.keyPersistence);
        if (!key && !isLocalEndpoint(routed.connection.chatEndpoint)) throw new ProviderError('请先在设置中填写 API Key。', 'MISSING_API_KEY');
        const routedRequest = { type: 'TRANSLATE', task: routed.task } as const;
        const keyId = cacheKey(routedRequest, routed.profile);
        const cached = await cacheGet(keyId);
        if (cached) return { ok: true, data: cached };
        const result = await callProvider(routed.profile, key, routed.task, fetch, {
          glossaryLookup: async (queries) => lookupGlossary(queries.join('\n'), routed.glossaryContext),
        });
        if (result.suggestedTerms) await storeSuggestedTerms(result.suggestedTerms, routed.glossaryContext);
        const host = sender.tab?.url ? new URL(sender.tab.url).hostname : 'extension';
        await cachePut(keyId, host, result);
        return { ok: true, data: result satisfies TranslationResult };
      }
      case 'FETCH_CAPTION_JSON': {
        const url = allowedCaptionUrl(message.url);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`字幕请求失败（HTTP ${response.status}）。`);
        return { ok: true, data: await response.json() };
      }
      case 'GLOSSARY_LIST': return { ok: true, data: await listGlossaryEntries({ ...(message.collectionId ? { collectionId: message.collectionId } : {}), ...(message.status ? { status: message.status } : {}) }) };
      case 'GLOSSARY_PUT': await putGlossaryEntry(message.entry); return { ok: true, data: true };
      case 'GLOSSARY_DELETE': await deleteGlossaryEntry(message.id); return { ok: true, data: true };
      case 'GLOSSARY_IMPORT': return { ok: true, data: await importGlossaryEntries(message.entries) };
      case 'GLOSSARY_COLLECTIONS': return { ok: true, data: await listGlossaryCollections() };
      case 'GLOSSARY_PUT_COLLECTION': await putGlossaryCollection(message.collection); return { ok: true, data: true };
      case 'GLOSSARY_DELETE_COLLECTION': await deleteGlossaryCollection(message.id); return { ok: true, data: true };
      case 'ASR_START': {
        if (tabId == null) throw new Error('当前消息没有关联网页标签页。');
        return { ok: true, data: await startAsrSession(tabId, message.videoTime, message.language, message.title, sender.tab?.url ?? '') };
      }
      case 'ASR_STOP':
        if (tabId != null) await stopAsrSession(tabId);
        return { ok: true, data: true };
      case 'ASR_SYNC': {
        if (tabId == null) return { ok: true, data: false };
        const session = activeSessionForTab(tabId);
        if (!session) return { ok: true, data: false };
        if (message.seeked) {
          session.generation += 1;
          session.segments = [];
        }
        session.videoTime = message.videoTime;
        session.baseCaptureTime = Math.max(session.lastCaptureEnd, (Date.now() - session.startedAt) / 1_000);
        session.playbackRate = message.paused ? 0 : message.playbackRate;
        return { ok: true, data: true };
      }
      case 'ASR_AUDIO_CHUNK': {
        const session = asrSessions.get(message.sessionId);
        if (!session) return { ok: true, data: false };
        session.queue = session.queue.then(() => processAsrChunk(session, message)).catch(async (error) => {
          await sendAsrStatus(session.tabId, { state: 'error', message: error instanceof Error ? error.message : '语音识别失败' });
        });
        await session.queue;
        return { ok: true, data: true };
      }
      case 'ASR_CAPTURE_STATUS': {
        const session = asrSessions.get(message.sessionId);
        if (session) await sendAsrStatus(session.tabId, { state: message.state, message: message.message, cues: transcriptionCues(session.segments) });
        return { ok: true, data: true };
      }
      case 'CLEAR_CACHE': await cacheClear(message.scope, message.host); return { ok: true, data: true };
      case 'OPEN_OPTIONS': await browser.runtime.openOptionsPage(); return { ok: true, data: true };
    }
  } catch (error) {
    const known = error instanceof ProviderError ? error : undefined;
    return { ok: false, error: error instanceof Error ? error.message : '发生未知错误。', ...(known ? { code: known.code } : {}) };
  }
}

export default defineBackground(() => {
  void protectStorage();
  void unregisterLegacyContent();
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void injectOpenTabs();
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (typeof (message as { type?: unknown })?.type === 'string' && String((message as { type: string }).type).startsWith('WEAVE_OFFSCREEN_')) return undefined;
    return handleMessage(message as RuntimeRequest, sender);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    tabRouteOverrides.delete(tabId);
    void stopAsrSession(tabId, false);
  });
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-page-translation') return;
    const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id != null) await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE_TRANSLATION' }).catch(() => injectTab(tab.id));
  });
});

export { profilesWithCapability };
