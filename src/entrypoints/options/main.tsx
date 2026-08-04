import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { PageMode, ProviderProfile, ReasoningMode, SiteRule, TranslationTheme, WeaveSettings } from '../../lib/contracts';
import { DEFAULT_SETTINGS } from '../../lib/defaults';
import { normalizeSitePattern } from '../../lib/site-rules';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

type Section = 'provider' | 'web' | 'selection' | 'video' | 'dock' | 'privacy' | 'license';
type SiteDraft = {
  pattern: string;
  autoTranslate: boolean;
  pageMode: '' | PageMode;
  targetLanguage: string;
  reasoningMode: '' | ReasoningMode;
  theme: '' | TranslationTheme;
};

const sections: Array<{ id: Section; label: string; index: string }> = [
  { id: 'provider', label: '模型服务', index: '01' }, { id: 'web', label: '网页翻译', index: '02' }, { id: 'selection', label: '划词翻译', index: '03' },
  { id: 'video', label: '视频字幕', index: '04' }, { id: 'dock', label: '侧边坞', index: '05' }, { id: 'privacy', label: '缓存与隐私', index: '06' }, { id: 'license', label: '关于与许可', index: '07' },
];

const reasoningOptions: Array<{ value: ReasoningMode; label: string }> = [
  { value: 'compatible', label: '兼容 · 不发送推理参数' },
  { value: 'fast', label: '快速 · 最低延迟' },
  { value: 'balanced', label: '均衡 · 兼顾速度与语境' },
  { value: 'deep', label: '深入 · 复杂内容优先' },
];

const emptySiteDraft = (): SiteDraft => ({
  pattern: '', autoTranslate: false, pageMode: '', targetLanguage: '', reasoningMode: '', theme: '',
});

function ReasoningField({ label, value, onChange, note }: { label: string; value: ReasoningMode; onChange: (mode: ReasoningMode) => void; note: string }): React.ReactElement {
  return <label className="field compact"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as ReasoningMode)}>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{note}</small></label>;
}

function ruleSummary(rule: SiteRule): string {
  const details = [
    rule.autoTranslate ? '自动翻译' : '手动翻译',
    rule.pageMode && { original: '原文', bilingual: '双语', translated: '仅译文' }[rule.pageMode],
    rule.reasoningMode && { compatible: '兼容', fast: '快速', balanced: '均衡', deep: '深入' }[rule.reasoningMode],
    rule.theme && { auto: '自动主题', light: '浅色', dark: '深色' }[rule.theme],
    rule.targetLanguage,
  ].filter(Boolean);
  return details.join(' · ');
}

function Options(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<ProviderProfile>(DEFAULT_SETTINGS.provider);
  const [apiKey, setApiKey] = useState('');
  const [section, setSection] = useState<Section>('provider');
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(() => emptySiteDraft());
  const [editingPattern, setEditingPattern] = useState<string>();

  useEffect(() => { void sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }).then((loaded) => { setSettings(loaded); setDraft(loaded.provider); setSiteDraft(emptySiteDraft()); }); }, []);

  const update = async (patch: Partial<WeaveSettings>) => {
    const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SETTINGS', patch });
    setSettings(next); setDraft(next.provider); return next;
  };

  const saveProvider = async (test = false) => {
    setBusy(true); setStatus(undefined);
    try {
      new URL(draft.endpoint);
      if (apiKey) await sendRuntimeMessage({ type: 'SET_API_KEY', apiKey, persistence: draft.keyPersistence });
      const saved = await update({ provider: { ...draft, hasApiKey: Boolean(apiKey || settings.provider.hasApiKey) }, targetLanguage: draft.targetLanguage });
      if (test) {
        const result = await sendRuntimeMessage<{ result?: string }>({
          type: 'TEST_PROVIDER',
          profile: { ...draft, reasoningMode: settings.reasoning.selection, hasApiKey: undefined } as Omit<ProviderProfile, 'hasApiKey'>,
          ...(apiKey ? { candidateKey: apiKey } : {}),
        });
        setStatus({ text: `连接成功：${result.result ?? '模型已响应'}` });
      } else setStatus({ text: '模型配置已保存。' });
      setApiKey(''); setSettings(saved);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : '保存失败。', error: true }); }
    finally { setBusy(false); }
  };

  const currentSiteRules = useMemo(() => Object.entries(settings.siteRules).sort(([left], [right]) => left.localeCompare(right)), [settings.siteRules]);

  const editRule = (pattern: string, rule: SiteRule) => {
    setEditingPattern(pattern);
    setSiteDraft({
      pattern,
      autoTranslate: rule.autoTranslate ?? false,
      pageMode: rule.pageMode ?? '',
      targetLanguage: rule.targetLanguage ?? '',
      reasoningMode: rule.reasoningMode ?? '',
      theme: rule.theme ?? '',
    });
  };

  const resetRuleDraft = () => { setEditingPattern(undefined); setSiteDraft(emptySiteDraft()); };

  const saveRule = async () => {
    const pattern = normalizeSitePattern(siteDraft.pattern);
    if (!pattern || (pattern.includes('*') && !pattern.startsWith('*.'))) {
      setStatus({ text: '请输入 example.com 或 *.example.com 形式的站点规则。', error: true });
      return;
    }
    setBusy(true); setStatus(undefined);
    try {
      if (editingPattern) await sendRuntimeMessage<WeaveSettings>({ type: 'DELETE_SITE_RULE', pattern: editingPattern });
      const existing = editingPattern ? settings.siteRules[editingPattern] : undefined;
      const rule: SiteRule = {
        autoTranslate: siteDraft.autoTranslate,
        ...(siteDraft.pageMode ? { pageMode: siteDraft.pageMode } : {}),
        ...(siteDraft.targetLanguage ? { targetLanguage: siteDraft.targetLanguage } : {}),
        ...(siteDraft.reasoningMode ? { reasoningMode: siteDraft.reasoningMode } : {}),
        ...(siteDraft.theme ? { theme: siteDraft.theme } : {}),
        ...(existing?.paused != null ? { paused: existing.paused } : {}),
        ...(existing?.hidden != null ? { hidden: existing.hidden } : {}),
      };
      const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SITE_RULE', host: pattern, patch: rule });
      setSettings(next); setDraft(next.provider); resetRuleDraft(); setStatus({ text: `已保存 ${pattern} 的网页翻译规则。` });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : '站点规则保存失败。', error: true }); }
    finally { setBusy(false); }
  };

  const deleteRule = async (pattern: string) => {
    const next = await sendRuntimeMessage<WeaveSettings>({ type: 'DELETE_SITE_RULE', pattern });
    setSettings(next); if (editingPattern === pattern) resetRuleDraft();
  };

  return <main className="settings-layout">
    <aside className="settings-nav">
      <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE SETTINGS</small></span></header>
      <nav>{sections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span>{item.index}</span>{item.label}</button>)}</nav>
      <p>LOCAL FIRST<br />APACHE-2.0</p>
    </aside>
    <section className="settings-content">
      <header className="content-header"><div><p className="eyebrow">{sections.find((item) => item.id === section)?.index} / WEAVE</p><h1>{sections.find((item) => item.id === section)?.label}</h1></div><span className="permission-chip ready">普通网页默认启用</span></header>

      {section === 'provider' && <div className="settings-card provider-grid">
        <label className="field"><span>服务类型</span><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ProviderProfile['kind'], ...(event.target.value === 'deepseek' ? { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash' } : { label: '自定义接口' }) })}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
        <label className="field"><span>显示名称</span><input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label className="field full"><span>Chat Completions 完整地址</span><input value={draft.endpoint} spellCheck={false} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} /><small>远程地址必须使用 HTTPS；本机 localhost 可使用 HTTP。</small></label>
        <label className="field"><span>模型名称</span><input value={draft.model} spellCheck={false} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
        <label className="field"><span>默认目标语言</span><select value={draft.targetLanguage} onChange={(event) => setDraft({ ...draft, targetLanguage: event.target.value })}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
        <p className="note full">网页、划词和视频的思考强度已拆分到各自页面；连接测试采用“划词翻译”的强度。</p>
        <label className="field full"><span>API Key {settings.provider.hasApiKey ? '· 已保存' : '· 尚未保存'}</span><input type="password" value={apiKey} autoComplete="new-password" placeholder={settings.provider.hasApiKey ? '留空表示不修改' : 'sk-…'} onChange={(event) => setApiKey(event.target.value)} /></label>
        <div className="key-mode full"><label><input type="radio" checked={draft.keyPersistence === 'local'} onChange={() => setDraft({ ...draft, keyPersistence: 'local' })} /> 持久保存在本机扩展</label><label><input type="radio" checked={draft.keyPersistence === 'session'} onChange={() => setDraft({ ...draft, keyPersistence: 'session' })} /> 仅本次浏览器会话</label></div>
        <div className="actions full"><button className="button-primary" disabled={busy} onClick={() => void saveProvider(false)}>保存配置</button><button className="button-secondary" disabled={busy} onClick={() => void saveProvider(true)}>保存并测试</button><button className="button-quiet danger" onClick={() => void sendRuntimeMessage<WeaveSettings>({ type: 'CLEAR_API_KEY' }).then(setSettings)}>清除密钥</button></div>
        {status && <p className={`status full ${status.error ? 'is-error' : ''}`}>{status.text}</p>}
      </div>}

      {section === 'web' && <div className="settings-card">
        <label className="switch"><span>智能上下文<small>先理解文章主题与术语，再翻译相邻段落</small></span><input type="checkbox" checked={settings.contextEnabled} onChange={(event) => void update({ contextEnabled: event.target.checked })} /></label>
        <div className="defaults-grid">
          <label className="field compact"><span>默认页面模式</span><select value={settings.dock.pageMode} onChange={(event) => void update({ dock: { ...settings.dock, pageMode: event.target.value as PageMode } })}><option value="bilingual">双语对照</option><option value="translated">仅译文</option><option value="original">原文</option></select></label>
          <label className="field compact"><span>默认译文主题</span><select value={settings.pageTheme} onChange={(event) => void update({ pageTheme: event.target.value as TranslationTheme })}><option value="auto">自动识别网页</option><option value="light">始终浅色</option><option value="dark">始终深色</option></select></label>
          <ReasoningField label="默认网页思考强度" value={settings.reasoning.page} onChange={(page) => void update({ reasoning: { ...settings.reasoning, page } })} note="长文通常适合均衡；复杂论文可改为深入。" />
        </div>
        <p className="note">自动主题读取网页实际背景色，并为译文块选择相应的墨色或暖纸配色。原始网页节点不会被覆盖。</p>
        <section className="rule-editor">
          <div className="rule-editor__heading"><div><p className="eyebrow">SITE PROFILES</p><h2>站点翻译档案</h2></div>{editingPattern && <button className="button-quiet" onClick={resetRuleDraft}>取消编辑</button>}</div>
          <p className="note"><code>example.com</code> 会匹配该主机下的全部路径（即 <code>example.com/*</code>）；<code>*.example.com</code> 同时匹配主域名及所有层级子域名的全部路径。更具体的规则会覆盖通配规则。</p>
          <div className="rule-grid">
            <label className="field full"><span>域名规则</span><input value={siteDraft.pattern} placeholder="例如 *.arxiv.org" spellCheck={false} onChange={(event) => setSiteDraft({ ...siteDraft, pattern: event.target.value })} /></label>
            <label className="field"><span>页面模式</span><select value={siteDraft.pageMode} onChange={(event) => setSiteDraft({ ...siteDraft, pageMode: event.target.value as SiteDraft['pageMode'] })}><option value="">跟随默认</option><option value="bilingual">双语对照</option><option value="translated">仅译文</option><option value="original">原文</option></select></label>
            <label className="field"><span>目标语言</span><select value={siteDraft.targetLanguage} onChange={(event) => setSiteDraft({ ...siteDraft, targetLanguage: event.target.value })}><option value="">跟随默认</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
            <label className="field"><span>网页思考</span><select value={siteDraft.reasoningMode} onChange={(event) => setSiteDraft({ ...siteDraft, reasoningMode: event.target.value as SiteDraft['reasoningMode'] })}><option value="">跟随默认</option>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="field"><span>译文主题</span><select value={siteDraft.theme} onChange={(event) => setSiteDraft({ ...siteDraft, theme: event.target.value as SiteDraft['theme'] })}><option value="">跟随默认</option><option value="auto">自动识别</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label className="switch full"><span>进入匹配页面时自动翻译<small>显示侧边坞本身不会消耗 API</small></span><input type="checkbox" checked={siteDraft.autoTranslate} onChange={(event) => setSiteDraft({ ...siteDraft, autoTranslate: event.target.checked })} /></label>
          </div>
          <div className="actions"><button className="button-primary" disabled={busy} onClick={() => void saveRule()}>{editingPattern ? '更新站点档案' : '添加站点档案'}</button></div>
          {currentSiteRules.length > 0 && <div className="site-list site-list--rules">{currentSiteRules.map(([pattern, rule]) => <div key={pattern}><span><strong>{pattern}</strong><small>{ruleSummary(rule)}</small></span><button onClick={() => editRule(pattern, rule)}>编辑</button><button onClick={() => void deleteRule(pattern)}>删除</button></div>)}</div>}
        </section>
        {status && <p className={`status ${status.error ? 'is-error' : ''}`}>{status.text}</p>}
      </div>}

      {section === 'selection' && <div className="settings-card"><label className="switch"><span>启用划词翻译<small>选中文本后显示一个轻量翻译圆点</small></span><input type="checkbox" checked={settings.selectionEnabled} onChange={(event) => void update({ selectionEnabled: event.target.checked })} /></label><ReasoningField label="划词思考强度" value={settings.reasoning.selection} onChange={(selection) => void update({ reasoning: { ...settings.reasoning, selection } })} note="推荐快速；遇到术语歧义时再切换均衡或深入。" /><p className="note">划词请求会包含所在段落、相邻段落和最近标题；密码框、编辑器与代码块始终排除。</p></div>}
      {section === 'video' && <div className="settings-card"><ReasoningField label="字幕思考强度" value={settings.reasoning.subtitle} onChange={(subtitle) => void update({ reasoning: { ...settings.reasoning, subtitle } })} note="推荐快速，确保播放时预取译文的延迟更低。" /><label className="field compact"><span>字幕显示</span><select value={settings.video.mode} onChange={(event) => void update({ video: { ...settings.video, mode: event.target.value as WeaveSettings['video']['mode'] } })}><option value="bilingual">原文 + 译文</option><option value="translated">仅译文</option></select></label><label className="range"><span>字号 {settings.video.fontScale.toFixed(2)}×</span><input type="range" min="0.75" max="1.6" step="0.05" value={settings.video.fontScale} onChange={(event) => void update({ video: { ...settings.video, fontScale: Number(event.target.value) } })} /></label><label className="range"><span>底部位置 {settings.video.bottomOffset}%</span><input type="range" min="5" max="35" value={settings.video.bottomOffset} onChange={(event) => void update({ video: { ...settings.video, bottomOffset: Number(event.target.value) } })} /></label><label className="range"><span>背景不透明度 {Math.round(settings.video.backgroundOpacity * 100)}%</span><input type="range" min="0.2" max="1" step="0.05" value={settings.video.backgroundOpacity} onChange={(event) => void update({ video: { ...settings.video, backgroundOpacity: Number(event.target.value) } })} /></label><p className="note">首版读取 YouTube/Bilibili 已有字幕，不包含无字幕语音识别。</p></div>}
      {section === 'dock' && <div className="settings-card"><div className="permission-block"><div><h2>所有普通网页默认显示</h2><p>侧边把手会自动出现，但不会因为显示界面而读取正文或调用模型。Chrome 内部页与扩展商店受浏览器保护，无法注入。</p></div><span className="permission-chip ready">已启用</span></div><label className="switch"><span>固定展开<small>关闭后，离开侧边坞约 600ms 自动收回</small></span><input type="checkbox" checked={settings.dock.pinned} onChange={(event) => void update({ dock: { ...settings.dock, pinned: event.target.checked } })} /></label><p className="note">关闭状态只响应可见把手，必须点击才会展开。快捷键 Alt+Shift+W 可开始或停止当前页面翻译。</p></div>}
      {section === 'privacy' && <div className="settings-card"><h2>本地数据</h2><p className="note">API Key 与设置保存在 Chrome 扩展空间。持久密钥并非操作系统级加密；内容脚本、日志和导出均无法读取其明文。</p><div className="actions"><button className="button-secondary" onClick={() => void sendRuntimeMessage({ type: 'CLEAR_CACHE', scope: 'all' }).then(() => setStatus({ text: '全部翻译缓存已清除。' }))}>清除全部缓存</button></div>{currentSiteRules.length > 0 && <div className="site-list"><h3>已保存站点规则</h3>{currentSiteRules.map(([pattern, rule]) => <div key={pattern}><span>{pattern}</span><small>{rule.hidden ? '已隐藏' : rule.paused ? '已暂停' : ruleSummary(rule)}</small>{rule.hidden && <button onClick={() => void sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SITE_RULE', host: pattern, patch: { hidden: false } }).then(setSettings)}>恢复显示</button>}</div>)}</div>}{status && <p className="status">{status.text}</p>}</div>}
      {section === 'license' && <div className="settings-card prose"><p className="eyebrow">WEAVE TRANSLATE 0.3.0</p><h2>为阅读而做，不为账户而做。</h2><p>织语是一个本地优先、使用自有模型密钥的上下文翻译扩展。项目以 Apache License 2.0 发布。</p><p>发行构建使用的开源依赖与许可证记录见项目内 <code>THIRD_PARTY_NOTICES.md</code>。</p><a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noreferrer">阅读 Apache-2.0 许可</a></div>}
    </section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Options />);
