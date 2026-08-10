import type {
  DockState,
  ProviderProfile,
  SecretPersistence,
  SiteRule,
  TaskRouteKey,
  TaskRoutes,
  WeaveSettings,
} from '../lib/contracts';
import { DEFAULT_SETTINGS, DEFAULT_TASK_ROUTES } from '../lib/defaults';

const SETTINGS_V2_KEY = 'weave.settings.v2';
const SETTINGS_V1_KEY = 'weave.settings.v1';
const LOCAL_SECRETS_KEY = 'weave.secrets.local.v2';
const SESSION_SECRETS_KEY = 'weave.secrets.session.v2';
const LEGACY_LOCAL_KEY = 'weave.secret.local.v1';
const LEGACY_SESSION_KEY = 'weave.secret.session.v1';

type LegacySettings = Partial<WeaveSettings> & { provider?: Partial<ProviderProfile> };
type SecretMap = Record<string, string>;

function cloneRoutes(raw?: Partial<TaskRoutes>): TaskRoutes {
  const result = {} as TaskRoutes;
  for (const key of Object.keys(DEFAULT_TASK_ROUTES) as TaskRouteKey[]) {
    result[key] = { ...DEFAULT_TASK_ROUTES[key], ...raw?.[key] };
  }
  return result;
}

function migrateLegacy(raw: LegacySettings): WeaveSettings {
  const legacy = raw.provider;
  const connectionId = legacy?.id || 'deepseek';
  const modelId = `${connectionId}-chat`;
  const reasoning = raw.reasoning
    ? { ...DEFAULT_SETTINGS.reasoning, ...raw.reasoning }
    : legacy?.reasoningMode
      ? { page: legacy.reasoningMode, selection: legacy.reasoningMode, subtitle: legacy.reasoningMode }
      : { ...DEFAULT_SETTINGS.reasoning };
  const taskRoutes = cloneRoutes();
  for (const key of Object.keys(taskRoutes) as TaskRouteKey[]) {
    if (key !== 'transcription') taskRoutes[key].profileId = modelId;
  }
  taskRoutes.pageContext.reasoningMode = reasoning.page;
  taskRoutes.pageTranslation.reasoningMode = reasoning.page;
  taskRoutes.selectionTranslation.reasoningMode = reasoning.selection;
  taskRoutes.selectionExplanation.reasoningMode = reasoning.selection;
  taskRoutes.videoContext.reasoningMode = reasoning.subtitle;
  taskRoutes.subtitleTranslation.reasoningMode = reasoning.subtitle;

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schemaVersion: 2,
    connections: [{
      ...DEFAULT_SETTINGS.connections[0]!,
      id: connectionId,
      label: legacy?.label ?? DEFAULT_SETTINGS.connections[0]!.label,
      kind: legacy?.kind ?? DEFAULT_SETTINGS.connections[0]!.kind,
      chatEndpoint: legacy?.endpoint ?? DEFAULT_SETTINGS.connections[0]!.chatEndpoint,
      secretRef: connectionId,
      keyPersistence: legacy?.keyPersistence ?? DEFAULT_SETTINGS.connections[0]!.keyPersistence,
      hasApiKey: false,
    }],
    models: [{
      ...DEFAULT_SETTINGS.models[0]!,
      id: modelId,
      connectionId,
      label: legacy?.label ? `${legacy.label} Chat` : DEFAULT_SETTINGS.models[0]!.label,
      model: legacy?.model ?? DEFAULT_SETTINGS.models[0]!.model,
    }],
    taskRoutes,
    reasoning,
    dock: { ...DEFAULT_SETTINGS.dock, ...raw.dock },
    video: { ...DEFAULT_SETTINGS.video, ...raw.video },
    siteRules: { ...DEFAULT_SETTINGS.siteRules, ...raw.siteRules },
  };
}

export function mergeSettings(raw?: LegacySettings): WeaveSettings {
  if (!raw || raw.schemaVersion !== 2 || !Array.isArray(raw.connections) || !Array.isArray(raw.models)) {
    return migrateLegacy(raw ?? {});
  }
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schemaVersion: 2,
    connections: raw.connections.map((connection) => ({
      ...DEFAULT_SETTINGS.connections[0]!,
      ...connection,
      hasApiKey: false,
    })),
    models: raw.models.map((model) => ({ ...model, capabilities: [...model.capabilities] })),
    taskRoutes: cloneRoutes(raw.taskRoutes),
    reasoning: { ...DEFAULT_SETTINGS.reasoning, ...raw.reasoning },
    dock: { ...DEFAULT_SETTINGS.dock, ...raw.dock },
    video: { ...DEFAULT_SETTINGS.video, ...raw.video },
    siteRules: { ...DEFAULT_SETTINGS.siteRules, ...raw.siteRules },
  };
}

function storedSettings(settings: WeaveSettings): WeaveSettings {
  return {
    ...settings,
    connections: settings.connections.map((connection) => ({ ...connection, hasApiKey: false })),
  };
}

async function readSecrets(persistence: SecretPersistence): Promise<SecretMap> {
  const area = persistence === 'session' ? browser.storage.session : browser.storage.local;
  const key = persistence === 'session' ? SESSION_SECRETS_KEY : LOCAL_SECRETS_KEY;
  return ((await area.get(key))[key] as SecretMap | undefined) ?? {};
}

async function writeSecrets(persistence: SecretPersistence, secrets: SecretMap): Promise<void> {
  const area = persistence === 'session' ? browser.storage.session : browser.storage.local;
  const key = persistence === 'session' ? SESSION_SECRETS_KEY : LOCAL_SECRETS_KEY;
  await area.set({ [key]: secrets });
}

async function ensureV2Settings(): Promise<WeaveSettings> {
  const values = await browser.storage.local.get([SETTINGS_V2_KEY, SETTINGS_V1_KEY, LEGACY_LOCAL_KEY]);
  const current = values[SETTINGS_V2_KEY] as LegacySettings | undefined;
  if (current?.schemaVersion === 2) return mergeSettings(current);

  const legacy = values[SETTINGS_V1_KEY] as LegacySettings | undefined;
  const migrated = mergeSettings(legacy);
  const legacySession = String((await browser.storage.session.get(LEGACY_SESSION_KEY))[LEGACY_SESSION_KEY] ?? '');
  const legacyLocal = String(values[LEGACY_LOCAL_KEY] ?? '');
  const connection = migrated.connections[0]!;
  const legacyKey = connection.keyPersistence === 'session' ? legacySession : legacyLocal;
  if (legacyKey) await writeSecrets(connection.keyPersistence, { [connection.secretRef]: legacyKey });
  await browser.storage.local.set({ [SETTINGS_V2_KEY]: storedSettings(migrated) });
  if (legacyKey) {
    await Promise.all([
      browser.storage.local.remove(LEGACY_LOCAL_KEY),
      browser.storage.session.remove(LEGACY_SESSION_KEY),
    ]);
  }
  return migrated;
}

export async function protectStorage(): Promise<void> {
  await browser.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  await browser.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function getSettings(): Promise<WeaveSettings> {
  const settings = await ensureV2Settings();
  const connections = await Promise.all(settings.connections.map(async (connection) => ({
    ...connection,
    hasApiKey: Boolean(await getApiKey(connection.secretRef, connection.keyPersistence)),
  })));
  return { ...settings, connections };
}

export async function saveSettings(patch: Partial<WeaveSettings>): Promise<WeaveSettings> {
  const current = await getSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    schemaVersion: 2,
    connections: patch.connections ?? current.connections,
    models: patch.models ?? current.models,
    taskRoutes: patch.taskRoutes ? cloneRoutes({ ...current.taskRoutes, ...patch.taskRoutes }) : current.taskRoutes,
    reasoning: patch.reasoning ? { ...current.reasoning, ...patch.reasoning } : current.reasoning,
    dock: patch.dock ? { ...current.dock, ...patch.dock } : current.dock,
    video: patch.video ? { ...current.video, ...patch.video } : current.video,
    siteRules: patch.siteRules ? { ...current.siteRules, ...patch.siteRules } : current.siteRules,
  });
  await browser.storage.local.set({ [SETTINGS_V2_KEY]: storedSettings(next) });
  return getSettings();
}

export async function saveSiteRule(host: string, patch: Partial<SiteRule>): Promise<WeaveSettings> {
  const current = await getSettings();
  const rule = { ...current.siteRules[host], ...patch };
  return saveSettings({ siteRules: { ...current.siteRules, [host]: rule } });
}

export async function deleteSiteRule(pattern: string): Promise<WeaveSettings> {
  const current = await getSettings();
  const siteRules = { ...current.siteRules };
  delete siteRules[pattern];
  return saveSettings({ siteRules });
}

export async function saveDockState(patch: Partial<DockState>): Promise<WeaveSettings> {
  const current = await getSettings();
  return saveSettings({ dock: { ...current.dock, ...patch } });
}

export async function setApiKey(secretRef: string, apiKey: string, persistence: SecretPersistence): Promise<void> {
  const trimmed = apiKey.trim();
  const selected = await readSecrets(persistence);
  const otherPersistence: SecretPersistence = persistence === 'local' ? 'session' : 'local';
  const other = await readSecrets(otherPersistence);
  if (trimmed) selected[secretRef] = trimmed;
  else delete selected[secretRef];
  delete other[secretRef];
  await Promise.all([writeSecrets(persistence, selected), writeSecrets(otherPersistence, other)]);
  const settings = await ensureV2Settings();
  if (settings.connections.some((connection) => connection.secretRef === secretRef && connection.keyPersistence !== persistence)) {
    const next = {
      ...settings,
      connections: settings.connections.map((connection) => connection.secretRef === secretRef ? { ...connection, keyPersistence: persistence } : connection),
    };
    await browser.storage.local.set({ [SETTINGS_V2_KEY]: storedSettings(next) });
  }
}

export async function getApiKey(secretRef: string, persistence: SecretPersistence = 'local'): Promise<string> {
  return String((await readSecrets(persistence))[secretRef] ?? '');
}

export async function clearApiKey(secretRef: string): Promise<void> {
  const [local, session] = await Promise.all([readSecrets('local'), readSecrets('session')]);
  delete local[secretRef];
  delete session[secretRef];
  await Promise.all([writeSecrets('local', local), writeSecrets('session', session)]);
}

export function sanitizeProfile(profile: ProviderProfile): ProviderProfile {
  return { ...profile, hasApiKey: Boolean(profile.hasApiKey) };
}

export const STORAGE_KEYS = {
  settings: SETTINGS_V2_KEY,
  legacySettings: SETTINGS_V1_KEY,
  localSecrets: LOCAL_SECRETS_KEY,
  sessionSecrets: SESSION_SECRETS_KEY,
} as const;
