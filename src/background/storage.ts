import type { DockState, ProviderProfile, SiteRule, WeaveSettings } from '../lib/contracts';
import { DEFAULT_SETTINGS, DEFAULT_SITE_RULE } from '../lib/defaults';

const SETTINGS_KEY = 'weave.settings.v1';
const LOCAL_KEY = 'weave.secret.local.v1';
const SESSION_KEY = 'weave.secret.session.v1';

function mergeSettings(raw?: Partial<WeaveSettings>): WeaveSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    provider: { ...DEFAULT_SETTINGS.provider, ...raw?.provider },
    dock: { ...DEFAULT_SETTINGS.dock, ...raw?.dock },
    video: { ...DEFAULT_SETTINGS.video, ...raw?.video },
    siteRules: { ...DEFAULT_SETTINGS.siteRules, ...raw?.siteRules },
  };
}

export async function protectStorage(): Promise<void> {
  await browser.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  await browser.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function getSettings(): Promise<WeaveSettings> {
  const raw = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<WeaveSettings> | undefined;
  const settings = mergeSettings(raw);
  const apiKey = await getApiKey(settings.provider.keyPersistence);
  settings.provider.hasApiKey = Boolean(apiKey);
  return settings;
}

export async function saveSettings(patch: Partial<WeaveSettings>): Promise<WeaveSettings> {
  const current = await getSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    provider: patch.provider ? { ...current.provider, ...patch.provider } : current.provider,
    dock: patch.dock ? { ...current.dock, ...patch.dock } : current.dock,
    video: patch.video ? { ...current.video, ...patch.video } : current.video,
    siteRules: patch.siteRules ? { ...current.siteRules, ...patch.siteRules } : current.siteRules,
  });
  const stored = { ...next, provider: { ...next.provider, hasApiKey: false } };
  await browser.storage.local.set({ [SETTINGS_KEY]: stored });
  return getSettings();
}

export async function saveSiteRule(host: string, patch: Partial<SiteRule>): Promise<WeaveSettings> {
  const current = await getSettings();
  const rule = { ...DEFAULT_SITE_RULE, ...current.siteRules[host], ...patch };
  return saveSettings({ siteRules: { ...current.siteRules, [host]: rule } });
}

export async function saveDockState(patch: Partial<DockState>): Promise<WeaveSettings> {
  const current = await getSettings();
  return saveSettings({ dock: { ...current.dock, ...patch } });
}

export async function setApiKey(apiKey: string, persistence: 'local' | 'session'): Promise<void> {
  const trimmed = apiKey.trim();
  if (persistence === 'session') {
    await browser.storage.session.set({ [SESSION_KEY]: trimmed });
    await browser.storage.local.remove(LOCAL_KEY);
  } else {
    await browser.storage.local.set({ [LOCAL_KEY]: trimmed });
    await browser.storage.session.remove(SESSION_KEY);
  }
  const current = await getSettings();
  await saveSettings({ provider: { ...current.provider, keyPersistence: persistence } });
}

export async function getApiKey(persistence?: 'local' | 'session'): Promise<string> {
  if (persistence === 'session') {
    return String((await browser.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? '');
  }
  return String((await browser.storage.local.get(LOCAL_KEY))[LOCAL_KEY] ?? '');
}

export async function clearApiKey(): Promise<void> {
  await Promise.all([browser.storage.local.remove(LOCAL_KEY), browser.storage.session.remove(SESSION_KEY)]);
}

export function sanitizeProfile(profile: ProviderProfile): ProviderProfile {
  return { ...profile, hasApiKey: Boolean(profile.hasApiKey) };
}
