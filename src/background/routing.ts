import type {
  EffectiveRoute,
  ModelCapability,
  ModelProfile,
  ProviderConnection,
  ProviderProfile,
  TaskRoute,
  TaskRouteKey,
  TranslationTask,
  WeaveSettings,
} from '../lib/contracts';
import { resolveSiteRule } from '../lib/site-rules';

export type TabRouteOverrides = Partial<Record<TaskRouteKey, string>>;

export function routeKeyForTask(task: TranslationTask): TaskRouteKey {
  if (task.route) return task.route;
  if (task.kind === 'summary') return task.scope === 'subtitle' ? 'videoContext' : 'pageContext';
  if (task.kind === 'explain') return 'selectionExplanation';
  if (task.kind === 'selection') return 'selectionTranslation';
  if (task.kind === 'subtitle') return 'subtitleTranslation';
  return 'pageTranslation';
}

export function profilesWithCapability(settings: WeaveSettings, capability: ModelCapability): ModelProfile[] {
  return settings.models.filter((model) => model.enabled && model.capabilities.includes(capability));
}

function siteProfile(settings: WeaveSettings, routeKey: TaskRouteKey, pageUrl?: string): string | undefined {
  if (!pageUrl || (routeKey !== 'pageContext' && routeKey !== 'pageTranslation')) return undefined;
  try {
    const rule = resolveSiteRule(settings.siteRules, new URL(pageUrl).hostname);
    return routeKey === 'pageContext' ? rule.pageContextProfileId : rule.pageProfileId;
  } catch {
    return undefined;
  }
}

function connectionFor(settings: WeaveSettings, model: ModelProfile): ProviderConnection {
  const connection = settings.connections.find((candidate) => candidate.id === model.connectionId);
  if (!connection) throw new Error(`模型“${model.label}”关联的服务连接不存在。`);
  return connection;
}

export interface ResolvedChatRoute {
  key: TaskRouteKey;
  route: TaskRoute;
  model: ModelProfile;
  connection: ProviderConnection;
  profile: ProviderProfile;
  source: EffectiveRoute['source'];
}

export function resolveChatRoute(
  settings: WeaveSettings,
  task: TranslationTask,
  pageUrl?: string,
  tabOverrides: TabRouteOverrides = {},
): ResolvedChatRoute {
  const key = routeKeyForTask(task);
  const configured = settings.taskRoutes[key];
  const tabProfileId = tabOverrides[key];
  const siteProfileId = siteProfile(settings, key, pageUrl);
  const profileId = tabProfileId ?? siteProfileId ?? configured.profileId;
  const source: EffectiveRoute['source'] = tabProfileId ? 'tab' : siteProfileId ? 'site' : 'default';
  const model = settings.models.find((candidate) => candidate.id === profileId && candidate.enabled);
  if (!model) throw new Error(`任务“${key}”尚未配置可用模型。`);
  if (!model.capabilities.includes('chat')) throw new Error(`模型“${model.label}”不支持聊天翻译。`);
  const connection = connectionFor(settings, model);
  let reasoningMode = configured.reasoningMode;
  if ((key === 'pageContext' || key === 'pageTranslation') && pageUrl) {
    try {
      reasoningMode = resolveSiteRule(settings.siteRules, new URL(pageUrl).hostname).reasoningMode ?? reasoningMode;
    } catch {
      // Keep the task default for non-page URLs.
    }
  }
  return {
    key,
    route: { ...configured, profileId, reasoningMode },
    model,
    connection,
    source,
    profile: {
      id: model.id,
      label: model.label,
      kind: connection.kind,
      endpoint: connection.chatEndpoint,
      model: model.model,
      reasoningMode,
      targetLanguage: task.targetLanguage,
      keyPersistence: connection.keyPersistence,
      hasApiKey: connection.hasApiKey,
      connectionId: connection.id,
      secretRef: connection.secretRef,
      capabilities: [...model.capabilities],
      glossaryMode: configured.glossaryMode,
    },
  };
}

export function effectiveRoutes(
  settings: WeaveSettings,
  pageUrl?: string,
  tabOverrides: TabRouteOverrides = {},
): EffectiveRoute[] {
  return (Object.keys(settings.taskRoutes) as TaskRouteKey[]).map((key) => {
    const configured = settings.taskRoutes[key];
    const tabProfileId = tabOverrides[key];
    const siteProfileId = siteProfile(settings, key, pageUrl);
    const profileId = tabProfileId ?? siteProfileId ?? configured.profileId;
    return {
      route: key,
      profileId,
      profileLabel: settings.models.find((model) => model.id === profileId)?.label ?? '未配置',
      reasoningMode: configured.reasoningMode,
      glossaryMode: configured.glossaryMode,
      source: tabProfileId ? 'tab' : siteProfileId ? 'site' : 'default',
    };
  });
}

export function resolveTranscriptionProfile(settings: WeaveSettings, tabOverrides: TabRouteOverrides = {}) {
  const route = settings.taskRoutes.transcription;
  const profileId = tabOverrides.transcription ?? route.profileId;
  const model = settings.models.find((candidate) => candidate.id === profileId && candidate.enabled);
  if (!model) throw new Error('尚未配置语音识别模型。');
  if (!model.capabilities.includes('audioTranscription')) throw new Error(`模型“${model.label}”不支持语音识别。`);
  return { route: { ...route, profileId }, model, connection: connectionFor(settings, model) };
}
