import { cacheClear, cacheGet, cachePut } from '../background/cache';
import { callProvider, ProviderError, validateEndpoint } from '../background/provider';
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
import type { ProviderProfile, RuntimeRequest, RuntimeResponse, TranslationResult, TranslationTask, WeaveSettings } from '../lib/contracts';
import { resolveReasoningMode } from '../lib/reasoning';

const LEGACY_SCRIPT_ID = 'weave-global-dock';
const SCRIPT_FILES = ['/content-scripts/content.js'] as const;
const ALL_ORIGINS = ['http://*/*', 'https://*/*'];

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
    profile.kind,
    profile.endpoint,
    profile.model,
    profile.reasoningMode,
    task.task.scope,
    task.task.kind,
    task.task.sourceLanguage,
    task.task.targetLanguage,
    task.task.context,
    task.task.units,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v3:${(hash >>> 0).toString(16)}`;
}

export function requestProfile(settings: WeaveSettings, task: TranslationTask, pageUrl?: string): ProviderProfile {
  return { ...settings.provider, reasoningMode: resolveReasoningMode(settings, task, pageUrl) };
}

function allowedCaptionUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'www.youtube.com' ||
    host.endsWith('.youtube.com') ||
    host.endsWith('.googlevideo.com') ||
    host === 'api.bilibili.com' ||
    host.endsWith('.hdslb.com') ||
    host.endsWith('.bilibili.com');
  if (url.protocol !== 'https:' || !allowed) throw new Error('字幕地址不在允许的平台范围内。');
  return url;
}

async function handleMessage(message: RuntimeRequest, sender: Browser.runtime.MessageSender): Promise<RuntimeResponse> {
  try {
    switch (message.type) {
      case 'GET_SETTINGS':
        return { ok: true, data: await getSettings() };
      case 'SAVE_SETTINGS':
        return { ok: true, data: await saveSettings(message.patch) };
      case 'SAVE_SITE_RULE':
        return { ok: true, data: await saveSiteRule(message.host, message.patch) };
      case 'DELETE_SITE_RULE':
        return { ok: true, data: await deleteSiteRule(message.pattern) };
      case 'SAVE_DOCK_STATE':
        return { ok: true, data: await saveDockState(message.patch) };
      case 'SET_API_KEY':
        await setApiKey(message.apiKey, message.persistence);
        return { ok: true, data: await getSettings() };
      case 'CLEAR_API_KEY':
        await clearApiKey();
        return { ok: true, data: await getSettings() };
      case 'TEST_PROVIDER': {
        validateEndpoint(message.profile.endpoint);
        const settings = await getSettings();
        const key = message.candidateKey ?? (await getApiKey(message.profile.keyPersistence));
        const result = await callProvider({ ...message.profile, hasApiKey: Boolean(key) }, key, {
          id: crypto.randomUUID(),
          kind: 'selection',
          scope: 'selection',
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
          units: [{ id: 'probe', text: 'Translation connection test.' }],
        });
        return { ok: true, data: { result: result.items[0]?.text, previousModel: settings.provider.model } };
      }
      case 'TRANSLATE': {
        const settings = await getSettings();
        const profile = requestProfile(settings, message.task, sender.tab?.url);
        const key = await getApiKey(settings.provider.keyPersistence);
        if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.provider.endpoint).hostname)) {
          throw new ProviderError('请先在设置中填写 API Key。', 'MISSING_API_KEY');
        }
        const keyId = cacheKey(message, profile);
        const cached = await cacheGet(keyId);
        if (cached) return { ok: true, data: cached };
        const result = await callProvider(profile, key, message.task);
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
      case 'CLEAR_CACHE':
        await cacheClear(message.scope, message.host);
        return { ok: true, data: true };
      case 'OPEN_OPTIONS':
        await browser.runtime.openOptionsPage();
        return { ok: true, data: true };
    }
  } catch (error) {
    const known = error instanceof ProviderError ? error : undefined;
    return {
      ok: false,
      error: error instanceof Error ? error.message : '发生未知错误。',
      ...(known ? { code: known.code } : {}),
    };
  }
}

export default defineBackground(() => {
  void protectStorage();
  void unregisterLegacyContent();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    void injectOpenTabs();
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  });
  browser.runtime.onMessage.addListener((message, sender) => handleMessage(message as RuntimeRequest, sender));
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-page-translation') return;
    const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id != null) await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE_TRANSLATION' }).catch(() => injectTab(tab.id));
  });
});
