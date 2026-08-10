import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type {
  GlossaryCollection,
  GlossaryEntry,
  GlossaryMode,
  ModelCapability,
  ModelProfile,
  PageMode,
  ProviderConnection,
  ReasoningMode,
  SiteRule,
  TaskRouteKey,
  TranslationTheme,
  WeaveSettings,
} from '../../lib/contracts';
import { DEFAULT_SETTINGS } from '../../lib/defaults';
import { normalizeSitePattern } from '../../lib/site-rules';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

type Section = 'models' | 'routes' | 'glossary' | 'web' | 'selection' | 'video' | 'dock' | 'privacy' | 'license';
type SiteDraft = {
  pattern: string; autoTranslate: boolean; pageMode: '' | PageMode; targetLanguage: string;
  reasoningMode: '' | ReasoningMode; theme: '' | TranslationTheme; pageProfileId: string; pageContextProfileId: string;
};

const sections: Array<{ id: Section; label: string; index: string }> = [
  { id: 'models', label: '服务与模型', index: '01' }, { id: 'routes', label: '任务路由', index: '02' },
  { id: 'glossary', label: '专业术语库', index: '03' }, { id: 'web', label: '网页翻译', index: '04' },
  { id: 'selection', label: '划词翻译', index: '05' }, { id: 'video', label: '视频字幕', index: '06' },
  { id: 'dock', label: '侧边坞', index: '07' }, { id: 'privacy', label: '缓存与隐私', index: '08' },
  { id: 'license', label: '关于与许可', index: '09' },
];

const routeLabels: Record<TaskRouteKey, { label: string; capability: ModelCapability; note: string }> = {
  pageContext: { label: '网页主题摘要', capability: 'chat', note: '理解文章主题与术语' },
  pageTranslation: { label: '整页翻译', capability: 'chat', note: '段落、列表与表格' },
  selectionTranslation: { label: '划词翻译', capability: 'chat', note: '选中文本的快速翻译' },
  selectionExplanation: { label: '语境解释', capability: 'chat', note: '词义、指代和术语解释' },
  videoContext: { label: '视频主题摘要', capability: 'chat', note: '字幕主题与人名术语' },
  subtitleTranslation: { label: '字幕翻译', capability: 'chat', note: '播放期间的字幕预取' },
  transcription: { label: '语音识别', capability: 'audioTranscription', note: '无字幕视频边播边生成' },
};

const reasoningOptions: Array<{ value: ReasoningMode; label: string }> = [
  { value: 'compatible', label: '兼容' }, { value: 'fast', label: '快速' },
  { value: 'balanced', label: '均衡' }, { value: 'deep', label: '深入' },
];

const makeConnection = (): ProviderConnection => {
  const id = `connection-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id, label: '自定义服务', kind: 'openai-compatible', chatEndpoint: 'https://api.example.com/v1/chat/completions',
    transcriptionEndpoint: '', secretRef: id, keyPersistence: 'local', hasApiKey: false, transcriptionResponseMode: 'verbose_json',
  };
};

const makeModel = (connectionId: string): ModelProfile => ({
  id: `model-${crypto.randomUUID().slice(0, 8)}`, label: '新模型', connectionId, model: '', capabilities: ['chat'], enabled: true,
});

const emptySiteDraft = (): SiteDraft => ({
  pattern: '', autoTranslate: false, pageMode: '', targetLanguage: '', reasoningMode: '', theme: '', pageProfileId: '', pageContextProfileId: '',
});

const makeGlossaryEntry = (collectionId = 'general'): GlossaryEntry => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), collectionId, source: '', preferred: '', aliases: [], sourceLanguage: 'auto', targetLanguage: 'zh-CN',
    domain: '', scope: 'global', scopeValue: '', caseSensitive: false, priority: 0, note: '', enabled: true,
    status: 'approved', createdAt: now, updatedAt: now,
  };
};

function ruleSummary(rule: SiteRule, settings: WeaveSettings): string {
  const model = settings.models.find((candidate) => candidate.id === rule.pageProfileId)?.label;
  return [rule.autoTranslate ? '自动翻译' : '手动翻译', model, rule.reasoningMode, rule.theme, rule.targetLanguage].filter(Boolean).join(' · ');
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { result.push(value); value = ''; }
    else value += character;
  }
  result.push(value);
  return result;
}

function Options(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>(DEFAULT_SETTINGS);
  const [section, setSection] = useState<Section>('models');
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnection>(DEFAULT_SETTINGS.connections[0]!);
  const [modelDraft, setModelDraft] = useState<ModelProfile>(DEFAULT_SETTINGS.models[0]!);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(emptySiteDraft);
  const [editingPattern, setEditingPattern] = useState<string>();
  const [collections, setCollections] = useState<GlossaryCollection[]>([]);
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [entryDraft, setEntryDraft] = useState<GlossaryEntry>(makeGlossaryEntry());
  const [glossaryQuery, setGlossaryQuery] = useState('');

  const loadGlossary = async () => {
    const [nextCollections, nextEntries] = await Promise.all([
      sendRuntimeMessage<GlossaryCollection[]>({ type: 'GLOSSARY_COLLECTIONS' }),
      sendRuntimeMessage<GlossaryEntry[]>({ type: 'GLOSSARY_LIST' }),
    ]);
    setCollections(nextCollections); setEntries(nextEntries);
  };

  useEffect(() => {
    void sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }).then((loaded) => {
      setSettings(loaded); setConnectionDraft(loaded.connections[0] ?? makeConnection()); setModelDraft(loaded.models[0] ?? makeModel(loaded.connections[0]?.id ?? ''));
    });
    void loadGlossary();
  }, []);

  const update = async (patch: Partial<WeaveSettings>) => {
    const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SETTINGS', patch });
    setSettings(next); return next;
  };

  const saveConnection = async (test?: 'chat' | 'audioTranscription') => {
    setBusy(true); setStatus(undefined);
    try {
      if (!connectionDraft.label.trim()) throw new Error('请填写连接名称。');
      const connections = settings.connections.some((item) => item.id === connectionDraft.id)
        ? settings.connections.map((item) => item.id === connectionDraft.id ? connectionDraft : item)
        : [...settings.connections, connectionDraft];
      if (apiKey) await sendRuntimeMessage({ type: 'SET_API_KEY', secretRef: connectionDraft.secretRef, apiKey, persistence: connectionDraft.keyPersistence });
      const next = await update({ connections });
      setConnectionDraft(next.connections.find((item) => item.id === connectionDraft.id) ?? connectionDraft);
      if (test) {
        const model = settings.models.find((item) => item.connectionId === connectionDraft.id && item.capabilities.includes(test === 'chat' ? 'chat' : 'audioTranscription')) ?? modelDraft;
        const result = await sendRuntimeMessage<{ result: string }>({
          type: 'TEST_CONNECTION', connection: connectionDraft, model, capability: test, ...(apiKey ? { candidateKey: apiKey } : {}),
        });
        setStatus({ text: `连接成功：${result.result || '接口已响应'}` });
      } else setStatus({ text: '服务连接已保存。' });
      setApiKey('');
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : '连接保存失败。', error: true }); }
    finally { setBusy(false); }
  };

  const saveModel = async () => {
    if (!modelDraft.label.trim() || !modelDraft.model.trim()) { setStatus({ text: '请填写模型显示名称与模型标识。', error: true }); return; }
    const models = settings.models.some((item) => item.id === modelDraft.id)
      ? settings.models.map((item) => item.id === modelDraft.id ? modelDraft : item)
      : [...settings.models, modelDraft];
    await update({ models }); setStatus({ text: '模型配置已保存。' });
  };

  const deleteModel = async (id: string) => {
    const referenced = (Object.keys(settings.taskRoutes) as TaskRouteKey[]).find((key) => settings.taskRoutes[key].profileId === id);
    if (referenced) { setStatus({ text: `该模型仍由“${routeLabels[referenced].label}”使用，请先重新分配任务。`, error: true }); return; }
    const models = settings.models.filter((model) => model.id !== id);
    await update({ models }); setModelDraft(models[0] ?? makeModel(settings.connections[0]?.id ?? ''));
  };

  const updateRoute = async (key: TaskRouteKey, patch: Partial<WeaveSettings['taskRoutes'][TaskRouteKey]>) => {
    const taskRoutes = { ...settings.taskRoutes, [key]: { ...settings.taskRoutes[key], ...patch } };
    const reasoning = {
      ...settings.reasoning,
      ...(key === 'pageTranslation' ? { page: taskRoutes[key].reasoningMode } : {}),
      ...(key === 'selectionTranslation' ? { selection: taskRoutes[key].reasoningMode } : {}),
      ...(key === 'subtitleTranslation' ? { subtitle: taskRoutes[key].reasoningMode } : {}),
    };
    await update({ taskRoutes, reasoning });
  };

  const currentSiteRules = useMemo(() => Object.entries(settings.siteRules).sort(([left], [right]) => left.localeCompare(right)), [settings.siteRules]);
  const chatModels = settings.models.filter((model) => model.enabled && model.capabilities.includes('chat'));
  const filteredEntries = entries.filter((entry) => `${entry.source} ${entry.preferred} ${entry.aliases.join(' ')}`.toLocaleLowerCase().includes(glossaryQuery.toLocaleLowerCase()));

  const editRule = (pattern: string, rule: SiteRule) => {
    setEditingPattern(pattern);
    setSiteDraft({
      pattern, autoTranslate: rule.autoTranslate ?? false, pageMode: rule.pageMode ?? '', targetLanguage: rule.targetLanguage ?? '',
      reasoningMode: rule.reasoningMode ?? '', theme: rule.theme ?? '', pageProfileId: rule.pageProfileId ?? '', pageContextProfileId: rule.pageContextProfileId ?? '',
    });
  };

  const saveRule = async () => {
    const pattern = normalizeSitePattern(siteDraft.pattern);
    if (!pattern) { setStatus({ text: '请输入 example.com 形式的站点规则。', error: true }); return; }
    if (editingPattern && editingPattern !== pattern) await sendRuntimeMessage({ type: 'DELETE_SITE_RULE', pattern: editingPattern });
    const rule: SiteRule = {
      autoTranslate: siteDraft.autoTranslate,
      ...(siteDraft.pageMode ? { pageMode: siteDraft.pageMode } : {}), ...(siteDraft.targetLanguage ? { targetLanguage: siteDraft.targetLanguage } : {}),
      ...(siteDraft.reasoningMode ? { reasoningMode: siteDraft.reasoningMode } : {}), ...(siteDraft.theme ? { theme: siteDraft.theme } : {}),
      ...(siteDraft.pageProfileId ? { pageProfileId: siteDraft.pageProfileId } : {}),
      ...(siteDraft.pageContextProfileId ? { pageContextProfileId: siteDraft.pageContextProfileId } : {}),
    };
    const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SITE_RULE', host: pattern, patch: rule });
    setSettings(next); setSiteDraft(emptySiteDraft()); setEditingPattern(undefined); setStatus({ text: `已保存 ${pattern} 的站点规则。` });
  };

  const ensureCollection = async (): Promise<string> => {
    if (collections[0]) return collections[0].id;
    const now = Date.now();
    const collection = { id: 'general', name: '通用术语', description: '跨站点使用的默认术语集', enabled: true, createdAt: now, updatedAt: now } satisfies GlossaryCollection;
    await sendRuntimeMessage({ type: 'GLOSSARY_PUT_COLLECTION', collection });
    setCollections([collection]);
    return collection.id;
  };

  const saveGlossaryEntry = async (override?: GlossaryEntry) => {
    const source = override ?? entryDraft;
    if (!source.source.trim() || !source.preferred.trim()) { setStatus({ text: '原词和推荐译法不能为空。', error: true }); return; }
    const collectionId = source.collectionId || await ensureCollection();
    const entry = { ...source, collectionId, updatedAt: Date.now() };
    await sendRuntimeMessage({ type: 'GLOSSARY_PUT', entry });
    setEntryDraft(makeGlossaryEntry(collectionId)); await loadGlossary(); setStatus({ text: '术语已保存到本地词典。' });
  };

  const importGlossary = async (file: File) => {
    try {
      const content = await file.text();
      const now = Date.now();
      let imported: GlossaryEntry[];
      if (file.name.toLowerCase().endsWith('.json')) imported = JSON.parse(content) as GlossaryEntry[];
      else {
        const rows = content.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
        const headers = rows.shift()?.map((header) => header.trim()) ?? [];
        imported = rows.map((row) => {
          const value = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
          return { ...makeGlossaryEntry(String(value.collectionId || 'general')), id: String(value.id || crypto.randomUUID()), source: String(value.source), preferred: String(value.preferred), aliases: String(value.aliases || '').split('|').filter(Boolean), note: String(value.note || ''), createdAt: now, updatedAt: now };
        });
      }
      const existing = new Set(entries.map((entry) => entry.source.trim().toLocaleLowerCase()));
      const conflicts = imported.filter((entry) => existing.has(entry.source.trim().toLocaleLowerCase())).length;
      if (!window.confirm(`将导入 ${imported.length} 条术语，其中 ${conflicts} 条与现有原词重复并会覆盖。是否继续？`)) return;
      const existingBySource = new Map(entries.map((entry) => [entry.source.trim().toLocaleLowerCase(), entry]));
      imported = imported.map((entry) => {
        const current = existingBySource.get(entry.source.trim().toLocaleLowerCase());
        return current ? { ...entry, id: current.id, createdAt: current.createdAt, updatedAt: Date.now() } : entry;
      });
      await sendRuntimeMessage({ type: 'GLOSSARY_IMPORT', entries: imported }); await loadGlossary();
      setStatus({ text: `已导入 ${imported.length} 条术语。` });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : '词典导入失败。', error: true }); }
  };

  const addCollection = async () => {
    const name = window.prompt('术语集名称');
    if (!name?.trim()) return;
    const now = Date.now();
    const collection: GlossaryCollection = {
      id: `collection-${crypto.randomUUID().slice(0, 8)}`, name: name.trim(), description: '', enabled: true, createdAt: now, updatedAt: now,
    };
    await sendRuntimeMessage({ type: 'GLOSSARY_PUT_COLLECTION', collection });
    await loadGlossary(); setEntryDraft({ ...entryDraft, collectionId: collection.id });
  };

  const removeCollection = async (collection: GlossaryCollection) => {
    if (!window.confirm(`删除“${collection.name}”及其中全部词条？此操作不可撤销。`)) return;
    await sendRuntimeMessage({ type: 'GLOSSARY_DELETE_COLLECTION', id: collection.id });
    await loadGlossary();
    if (entryDraft.collectionId === collection.id) setEntryDraft({ ...entryDraft, collectionId: 'general' });
  };

  return <main className="settings-layout">
    <aside className="settings-nav">
      <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE SETTINGS</small></span></header>
      <nav>{sections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span>{item.index}</span>{item.label}</button>)}</nav>
      <p>LOCAL FIRST<br />APACHE-2.0</p>
    </aside>
    <section className="settings-content">
      <header className="content-header"><div><p className="eyebrow">{sections.find((item) => item.id === section)?.index} / WEAVE</p><h1>{sections.find((item) => item.id === section)?.label}</h1></div><span className="permission-chip ready">SCHEMA V2 · LOCAL</span></header>

      {section === 'models' && <div className="settings-stack">
        <section className="settings-card"><div className="card-heading"><div><p className="eyebrow">CONNECTIONS</p><h2>服务连接</h2></div><button className="button-secondary" onClick={() => { const draft = makeConnection(); setConnectionDraft(draft); setModelDraft(makeModel(draft.id)); }}>新增连接</button></div>
          <div className="record-tabs">{settings.connections.map((item) => <button key={item.id} className={item.id === connectionDraft.id ? 'active' : ''} onClick={() => setConnectionDraft(item)}><i className={item.hasApiKey ? 'ready' : ''} />{item.label}</button>)}</div>
          <div className="provider-grid">
            <label className="field"><span>服务类型</span><select value={connectionDraft.kind} onChange={(event) => { const kind = event.target.value as ProviderConnection['kind']; setConnectionDraft({ ...connectionDraft, kind, ...(kind === 'deepseek' ? { label: 'DeepSeek', chatEndpoint: 'https://api.deepseek.com/chat/completions', transcriptionEndpoint: '' } : {}) }); }}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
            <label className="field"><span>连接名称</span><input value={connectionDraft.label} onChange={(event) => setConnectionDraft({ ...connectionDraft, label: event.target.value })} /></label>
            <label className="field full"><span>Chat Completions 完整地址</span><input value={connectionDraft.chatEndpoint} spellCheck={false} onChange={(event) => setConnectionDraft({ ...connectionDraft, chatEndpoint: event.target.value })} /></label>
            <label className="field full"><span>Audio Transcriptions 完整地址</span><input value={connectionDraft.transcriptionEndpoint} spellCheck={false} placeholder="例如 http://localhost:8000/v1/audio/transcriptions" onChange={(event) => setConnectionDraft({ ...connectionDraft, transcriptionEndpoint: event.target.value })} /></label>
            <label className="field"><span>转录响应格式</span><select value={connectionDraft.transcriptionResponseMode} onChange={(event) => setConnectionDraft({ ...connectionDraft, transcriptionResponseMode: event.target.value as ProviderConnection['transcriptionResponseMode'] })}><option value="verbose_json">verbose_json</option><option value="json">json</option><option value="text">text</option></select></label>
            <label className="field"><span>API Key {connectionDraft.hasApiKey ? '· 已保存' : '· 可为空'}</span><input type="password" value={apiKey} placeholder={connectionDraft.hasApiKey ? '留空表示不修改' : 'sk-…'} onChange={(event) => setApiKey(event.target.value)} /></label>
            <div className="key-mode full"><label><input type="radio" checked={connectionDraft.keyPersistence === 'local'} onChange={() => setConnectionDraft({ ...connectionDraft, keyPersistence: 'local' })} /> 持久保存</label><label><input type="radio" checked={connectionDraft.keyPersistence === 'session'} onChange={() => setConnectionDraft({ ...connectionDraft, keyPersistence: 'session' })} /> 仅本次会话</label></div>
            <div className="actions full"><button className="button-primary" disabled={busy} onClick={() => void saveConnection()}>保存连接</button><button className="button-secondary" disabled={busy || !connectionDraft.chatEndpoint} onClick={() => void saveConnection('chat')}>测试聊天</button><button className="button-secondary" disabled={busy || !connectionDraft.transcriptionEndpoint} onClick={() => void saveConnection('audioTranscription')}>测试语音</button><button className="button-quiet danger" onClick={() => void sendRuntimeMessage<WeaveSettings>({ type: 'CLEAR_API_KEY', secretRef: connectionDraft.secretRef }).then(setSettings)}>清除密钥</button></div>
          </div>
        </section>
        <section className="settings-card"><div className="card-heading"><div><p className="eyebrow">MODEL PROFILES</p><h2>模型配置</h2></div><button className="button-secondary" onClick={() => setModelDraft(makeModel(connectionDraft.id))}>新增模型</button></div>
          <div className="model-list">{settings.models.map((model) => <button key={model.id} className={model.id === modelDraft.id ? 'active' : ''} onClick={() => setModelDraft(model)}><span>{model.label}<small>{model.model}</small></span><b>{model.capabilities.join(' · ')}</b></button>)}</div>
          <div className="provider-grid model-editor">
            <label className="field"><span>显示名称</span><input value={modelDraft.label} onChange={(event) => setModelDraft({ ...modelDraft, label: event.target.value })} /></label>
            <label className="field"><span>模型标识</span><input value={modelDraft.model} spellCheck={false} onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })} /></label>
            <label className="field"><span>服务连接</span><select value={modelDraft.connectionId} onChange={(event) => setModelDraft({ ...modelDraft, connectionId: event.target.value })}>{settings.connections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="switch"><span>启用模型</span><input type="checkbox" checked={modelDraft.enabled} onChange={(event) => setModelDraft({ ...modelDraft, enabled: event.target.checked })} /></label>
            <fieldset className="capabilities full"><legend>模型能力</legend>{(['chat', 'tools', 'audioTranscription', 'reasoningEffort'] as ModelCapability[]).map((capability) => <label key={capability}><input type="checkbox" checked={modelDraft.capabilities.includes(capability)} onChange={(event) => setModelDraft({ ...modelDraft, capabilities: event.target.checked ? [...new Set([...modelDraft.capabilities, capability])] : modelDraft.capabilities.filter((item) => item !== capability) })} />{capability}</label>)}</fieldset>
            <div className="actions full"><button className="button-primary" onClick={() => void saveModel()}>保存模型</button><button className="button-secondary" onClick={() => setModelDraft({ ...modelDraft, id: `model-${crypto.randomUUID().slice(0, 8)}`, label: `${modelDraft.label} 副本` })}>复制为新模型</button><button className="button-quiet danger" onClick={() => void deleteModel(modelDraft.id)}>删除模型</button></div>
          </div>
        </section>{status && <p className={`status ${status.error ? 'is-error' : ''}`}>{status.text}</p>}
      </div>}

      {section === 'routes' && <div className="settings-card"><p className="note">每种任务独立选择模型、思考深度和词典行为。被停用或能力不匹配的模型不会出现在列表中。</p><div className="route-list">{(Object.keys(routeLabels) as TaskRouteKey[]).map((key) => { const meta = routeLabels[key]; const route = settings.taskRoutes[key]; const models = settings.models.filter((model) => model.enabled && model.capabilities.includes(meta.capability)); return <article key={key}><header><strong>{meta.label}</strong><small>{meta.note}</small></header><label className="field"><span>模型</span><select value={route.profileId} onChange={(event) => void updateRoute(key, { profileId: event.target.value })}><option value="">未配置</option>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>{meta.capability === 'chat' && <><label className="field"><span>思考</span><select value={route.reasoningMode} onChange={(event) => void updateRoute(key, { reasoningMode: event.target.value as ReasoningMode })}>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="field"><span>术语库</span><select value={route.glossaryMode} onChange={(event) => void updateRoute(key, { glossaryMode: event.target.value as GlossaryMode })}><option value="off">关闭</option><option value="matched">仅本地命中</option><option value="hybrid">混合检索</option></select></label></>}</article>; })}</div></div>}

      {section === 'glossary' && <div className="settings-stack"><section className="settings-card"><div className="card-heading"><div><p className="eyebrow">LOCAL RETRIEVAL</p><h2>词条编辑</h2></div><div className="actions"><label className="button-secondary file-button">导入 CSV / JSON<input type="file" accept=".csv,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importGlossary(file); }} /></label><button className="button-secondary" onClick={() => download('weave-glossary.json', JSON.stringify(entries, null, 2), 'application/json')}>导出 JSON</button><button className="button-secondary" onClick={() => download('weave-glossary.csv', ['id,collectionId,source,preferred,aliases,note', ...entries.map((entry) => [entry.id, entry.collectionId, entry.source, entry.preferred, entry.aliases.join('|'), entry.note].map(csvEscape).join(','))].join('\n'), 'text/csv')}>导出 CSV</button></div></div>
          <div className="collection-bar"><button onClick={() => void addCollection()}>＋ 新建术语集</button>{collections.map((collection) => <span key={collection.id}>{collection.name}{!['general', 'suggestions'].includes(collection.id) && <button aria-label={`删除术语集 ${collection.name}`} onClick={() => void removeCollection(collection)}>×</button>}</span>)}</div>
          <div className="provider-grid">
            <label className="field"><span>原词</span><input value={entryDraft.source} onChange={(event) => setEntryDraft({ ...entryDraft, source: event.target.value })} /></label><label className="field"><span>推荐译法</span><input value={entryDraft.preferred} onChange={(event) => setEntryDraft({ ...entryDraft, preferred: event.target.value })} /></label>
            <label className="field"><span>别名（用 | 分隔）</span><input value={entryDraft.aliases.join('|')} onChange={(event) => setEntryDraft({ ...entryDraft, aliases: event.target.value.split('|').map((item) => item.trim()).filter(Boolean) })} /></label><label className="field"><span>术语集</span><select value={entryDraft.collectionId} onChange={(event) => setEntryDraft({ ...entryDraft, collectionId: event.target.value })}><option value="general">通用术语</option>{collections.filter((item) => item.id !== 'general').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span>作用范围</span><select value={entryDraft.scope} onChange={(event) => setEntryDraft({ ...entryDraft, scope: event.target.value as GlossaryEntry['scope'] })}><option value="global">全局</option><option value="domain">主域名及子域名</option><option value="host">精确主机名</option></select></label><label className="field"><span>域名</span><input disabled={entryDraft.scope === 'global'} value={entryDraft.scopeValue} placeholder="example.com" onChange={(event) => setEntryDraft({ ...entryDraft, scopeValue: normalizeSitePattern(event.target.value) })} /></label>
            <label className="field full"><span>说明</span><input value={entryDraft.note} onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })} /></label>
            <div className="actions full"><button className="button-primary" onClick={() => void saveGlossaryEntry()}>保存词条</button><button className="button-quiet" onClick={() => setEntryDraft(makeGlossaryEntry(entryDraft.collectionId))}>清空</button></div>
          </div>
        </section>
        <section className="settings-card"><div className="card-heading"><div><p className="eyebrow">DICTIONARY</p><h2>已保存与待确认</h2></div><input className="search-input" value={glossaryQuery} placeholder="搜索术语…" onChange={(event) => setGlossaryQuery(event.target.value)} /></div><div className="glossary-list">{filteredEntries.map((entry) => <article key={entry.id} className={entry.status === 'suggested' ? 'suggested' : ''}><span><strong>{entry.source}</strong><i>→</i><b>{entry.preferred}</b><small>{entry.note || entry.scope}</small></span><div>{entry.status === 'suggested' && <button onClick={() => void saveGlossaryEntry({ ...entry, status: 'approved', enabled: true })}>确认</button>}<button onClick={() => setEntryDraft(entry)}>编辑</button><button onClick={() => void sendRuntimeMessage({ type: 'GLOSSARY_DELETE', id: entry.id }).then(loadGlossary)}>删除</button></div></article>)}</div></section>{status && <p className={`status ${status.error ? 'is-error' : ''}`}>{status.text}</p>}</div>}

      {section === 'web' && <div className="settings-card"><label className="switch"><span>智能上下文<small>先理解文章主题与术语，再翻译相邻段落</small></span><input type="checkbox" checked={settings.contextEnabled} onChange={(event) => void update({ contextEnabled: event.target.checked })} /></label><div className="defaults-grid"><label className="field compact"><span>默认页面模式</span><select value={settings.dock.pageMode} onChange={(event) => void update({ dock: { ...settings.dock, pageMode: event.target.value as PageMode } })}><option value="bilingual">双语对照</option><option value="translated">仅译文</option><option value="original">原文</option></select></label><label className="field compact"><span>默认译文主题</span><select value={settings.pageTheme} onChange={(event) => void update({ pageTheme: event.target.value as TranslationTheme })}><option value="auto">自动识别网页</option><option value="light">始终浅色</option><option value="dark">始终深色</option></select></label></div><section className="rule-editor"><div className="rule-editor__heading"><div><p className="eyebrow">SITE PROFILES</p><h2>站点翻译档案</h2></div>{editingPattern && <button className="button-quiet" onClick={() => { setEditingPattern(undefined); setSiteDraft(emptySiteDraft()); }}>取消编辑</button>}</div><p className="note"><code>example.com</code> 覆盖全部路径和所有层级子域名；更具体的主机规则优先。</p><div className="rule-grid"><label className="field full"><span>域名规则</span><input value={siteDraft.pattern} placeholder="例如 arxiv.org" onChange={(event) => setSiteDraft({ ...siteDraft, pattern: event.target.value })} /></label><label className="field"><span>整页模型</span><select value={siteDraft.pageProfileId} onChange={(event) => setSiteDraft({ ...siteDraft, pageProfileId: event.target.value })}><option value="">跟随任务默认</option>{chatModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label className="field"><span>摘要模型</span><select value={siteDraft.pageContextProfileId} onChange={(event) => setSiteDraft({ ...siteDraft, pageContextProfileId: event.target.value })}><option value="">跟随任务默认</option>{chatModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label className="field"><span>页面模式</span><select value={siteDraft.pageMode} onChange={(event) => setSiteDraft({ ...siteDraft, pageMode: event.target.value as SiteDraft['pageMode'] })}><option value="">跟随默认</option><option value="bilingual">双语</option><option value="translated">译文</option><option value="original">原文</option></select></label><label className="field"><span>网页思考</span><select value={siteDraft.reasoningMode} onChange={(event) => setSiteDraft({ ...siteDraft, reasoningMode: event.target.value as SiteDraft['reasoningMode'] })}><option value="">跟随默认</option>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="field"><span>目标语言</span><select value={siteDraft.targetLanguage} onChange={(event) => setSiteDraft({ ...siteDraft, targetLanguage: event.target.value })}><option value="">跟随默认</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option></select></label><label className="field"><span>译文主题</span><select value={siteDraft.theme} onChange={(event) => setSiteDraft({ ...siteDraft, theme: event.target.value as SiteDraft['theme'] })}><option value="">跟随默认</option><option value="auto">自动</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="switch full"><span>进入页面时自动翻译<small>显示侧边坞不会消耗 API</small></span><input type="checkbox" checked={siteDraft.autoTranslate} onChange={(event) => setSiteDraft({ ...siteDraft, autoTranslate: event.target.checked })} /></label></div><button className="button-primary" onClick={() => void saveRule()}>{editingPattern ? '更新站点档案' : '添加站点档案'}</button>{currentSiteRules.length > 0 && <div className="site-list site-list--rules">{currentSiteRules.map(([pattern, rule]) => <div key={pattern}><span><strong>{pattern}</strong><small>{ruleSummary(rule, settings)}</small></span><button onClick={() => editRule(pattern, rule)}>编辑</button><button onClick={() => void sendRuntimeMessage<WeaveSettings>({ type: 'DELETE_SITE_RULE', pattern }).then(setSettings)}>删除</button></div>)}</div>}</section>{status && <p className={`status ${status.error ? 'is-error' : ''}`}>{status.text}</p>}</div>}

      {section === 'selection' && <div className="settings-card"><label className="switch"><span>启用划词翻译<small>选中文本后显示轻量翻译圆点</small></span><input type="checkbox" checked={settings.selectionEnabled} onChange={(event) => void update({ selectionEnabled: event.target.checked })} /></label><p className="note">划词与语境解释的模型、思考深度、术语模式在“任务路由”中分别设置。密码框、编辑器与代码块始终排除。</p></div>}
      {section === 'video' && <div className="settings-card"><label className="field compact"><span>字幕显示</span><select value={settings.video.mode} onChange={(event) => void update({ video: { ...settings.video, mode: event.target.value as WeaveSettings['video']['mode'] } })}><option value="bilingual">原文 + 译文</option><option value="translated">仅译文</option></select></label><label className="field compact"><span>ASR 原语言</span><input value={settings.video.asrLanguage} placeholder="auto / en / zh" onChange={(event) => void update({ video: { ...settings.video, asrLanguage: event.target.value } })} /></label><label className="range"><span>字号 {settings.video.fontScale.toFixed(2)}×</span><input type="range" min="0.75" max="1.6" step="0.05" value={settings.video.fontScale} onChange={(event) => void update({ video: { ...settings.video, fontScale: Number(event.target.value) } })} /></label><label className="range"><span>底部位置 {settings.video.bottomOffset}%</span><input type="range" min="5" max="35" value={settings.video.bottomOffset} onChange={(event) => void update({ video: { ...settings.video, bottomOffset: Number(event.target.value) } })} /></label><p className="note">YouTube/Bilibili 优先使用网站字幕；没有字幕时，由用户点击“生成并翻译字幕”后才请求标签页音频权限。原始音频不会保存。</p></div>}
      {section === 'dock' && <div className="settings-card"><div className="permission-block"><div><h2>所有普通网页默认显示</h2><p>侧边把手自动出现，但不会因为显示界面而读取正文或调用模型。</p></div><span className="permission-chip ready">已启用</span></div><label className="switch"><span>固定展开<small>关闭后必须点击把手才展开</small></span><input type="checkbox" checked={settings.dock.pinned} onChange={(event) => void update({ dock: { ...settings.dock, pinned: event.target.checked } })} /></label></div>}
      {section === 'privacy' && <div className="settings-card"><h2>本地数据</h2><p className="note">密钥仅在可信扩展上下文可读。术语库、设置和翻译缓存保存在本机；原始音频和 ASR 文本不持久化。</p><div className="actions"><button className="button-secondary" onClick={() => void sendRuntimeMessage({ type: 'CLEAR_CACHE', scope: 'all' }).then(() => setStatus({ text: '全部翻译缓存已清除。' }))}>清除翻译缓存</button></div>{status && <p className="status">{status.text}</p>}</div>}
      {section === 'license' && <div className="settings-card prose"><p className="eyebrow">WEAVE TRANSLATE 0.4.0</p><h2>为阅读而做，不为账户而做。</h2><p>织语是本地优先、使用自有模型服务的上下文翻译扩展，以 Apache License 2.0 发布。</p><p>发行构建使用的开源依赖与许可证记录见项目内 <code>THIRD_PARTY_NOTICES.md</code>。</p></div>}
    </section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Options />);
