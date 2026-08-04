import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { ProviderProfile, WeaveSettings } from '../../lib/contracts';
import { DEFAULT_SETTINGS } from '../../lib/defaults';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

type Section = 'provider' | 'web' | 'selection' | 'video' | 'dock' | 'privacy' | 'license';
const sections: Array<{ id: Section; label: string; index: string }> = [
  { id:'provider', label:'模型服务', index:'01' }, { id:'web', label:'网页翻译', index:'02' }, { id:'selection', label:'划词翻译', index:'03' },
  { id:'video', label:'视频字幕', index:'04' }, { id:'dock', label:'侧边坞', index:'05' }, { id:'privacy', label:'缓存与隐私', index:'06' }, { id:'license', label:'关于与许可', index:'07' },
];

function Options(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<ProviderProfile>(DEFAULT_SETTINGS.provider);
  const [apiKey, setApiKey] = useState('');
  const [section, setSection] = useState<Section>('provider');
  const [permission, setPermission] = useState(false);
  const [status, setStatus] = useState<{ text:string; error?:boolean }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => { void Promise.all([
    sendRuntimeMessage<WeaveSettings>({ type:'GET_SETTINGS' }),
    sendRuntimeMessage<{allSites:boolean}>({ type:'GET_PERMISSION_STATE' }),
  ]).then(([loaded, access]) => { setSettings(loaded); setDraft(loaded.provider); setPermission(access.allSites); }); }, []);

  const update = async (patch: Partial<WeaveSettings>) => {
    const next = await sendRuntimeMessage<WeaveSettings>({ type:'SAVE_SETTINGS', patch });
    setSettings(next); setDraft(next.provider); return next;
  };

  const saveProvider = async (test = false) => {
    setBusy(true); setStatus(undefined);
    try {
      const endpoint = new URL(draft.endpoint);
      const originPattern = `${endpoint.origin}/*`;
      if (!permission && !(await browser.permissions.contains({ origins:[originPattern] }))) {
        const granted = await browser.permissions.request({ origins:[originPattern] });
        if (!granted) throw new Error('需要允许访问该模型接口，织语才能发送翻译请求。');
      }
      if (apiKey) await sendRuntimeMessage({ type:'SET_API_KEY', apiKey, persistence:draft.keyPersistence });
      const saved = await update({ provider:{ ...draft, hasApiKey:Boolean(apiKey || settings.provider.hasApiKey) }, targetLanguage:draft.targetLanguage });
      setApiKey('');
      if (test) {
        const result = await sendRuntimeMessage<{result?:string}>({ type:'TEST_PROVIDER', profile:{...draft, hasApiKey:undefined} as Omit<ProviderProfile,'hasApiKey'>, ...(apiKey ? { candidateKey:apiKey } : {}) });
        setStatus({ text:`连接成功：${result.result ?? '模型已响应'}` });
      } else setStatus({ text:'模型配置已保存。' });
      setSettings(saved);
    } catch (error) { setStatus({ text:error instanceof Error ? error.message : '保存失败。', error:true }); }
    finally { setBusy(false); }
  };

  const toggleAllSites = async () => {
    if (permission) {
      const removed = await browser.permissions.remove({ origins: ['http://*/*', 'https://*/*'] });
      setPermission(!removed);
      return;
    }
    const granted = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    if (!granted) return setStatus({ text:'未授予全站权限，你仍可从工具栏按页启用。' });
    const result = await sendRuntimeMessage<{ granted: boolean }>({ type:'SYNC_GLOBAL_CONTENT' });
    setPermission(result.granted);
    setStatus({ text:result.granted ? '全站侧边坞已启用。' : '权限同步失败，请重试。', error:!result.granted });
  };

  const currentSiteRules = useMemo(() => Object.entries(settings.siteRules), [settings.siteRules]);
  return <main className="settings-layout">
    <aside className="settings-nav">
      <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE SETTINGS</small></span></header>
      <nav>{sections.map((item)=><button key={item.id} className={section===item.id?'active':''} onClick={()=>setSection(item.id)}><span>{item.index}</span>{item.label}</button>)}</nav>
      <p>LOCAL FIRST<br/>APACHE-2.0</p>
    </aside>
    <section className="settings-content">
      <header className="content-header"><div><p className="eyebrow">{sections.find((item)=>item.id===section)?.index} / WEAVE</p><h1>{sections.find((item)=>item.id===section)?.label}</h1></div><span className={`permission-chip ${permission?'ready':''}`}>{permission?'全站侧边坞已启用':'按页授权'}</span></header>

      {section==='provider' && <div className="settings-card provider-grid">
        <label className="field"><span>服务类型</span><select value={draft.kind} onChange={(e)=>setDraft({...draft,kind:e.target.value as ProviderProfile['kind'],...(e.target.value==='deepseek'?{label:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-chat'}:{label:'自定义接口'})})}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
        <label className="field"><span>显示名称</span><input value={draft.label} onChange={(e)=>setDraft({...draft,label:e.target.value})}/></label>
        <label className="field full"><span>Chat Completions 完整地址</span><input value={draft.endpoint} spellCheck={false} onChange={(e)=>setDraft({...draft,endpoint:e.target.value})}/><small>远程地址必须使用 HTTPS；本机 localhost 可使用 HTTP。</small></label>
        <label className="field"><span>模型名称</span><input value={draft.model} spellCheck={false} onChange={(e)=>setDraft({...draft,model:e.target.value})}/></label>
        <label className="field"><span>目标语言</span><select value={draft.targetLanguage} onChange={(e)=>setDraft({...draft,targetLanguage:e.target.value})}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
        <label className="field full"><span>API Key {settings.provider.hasApiKey?'· 已保存':'· 尚未保存'}</span><input type="password" value={apiKey} autoComplete="new-password" placeholder={settings.provider.hasApiKey?'留空表示不修改':'sk-…'} onChange={(e)=>setApiKey(e.target.value)}/></label>
        <div className="key-mode full"><label><input type="radio" checked={draft.keyPersistence==='local'} onChange={()=>setDraft({...draft,keyPersistence:'local'})}/> 持久保存在本机扩展</label><label><input type="radio" checked={draft.keyPersistence==='session'} onChange={()=>setDraft({...draft,keyPersistence:'session'})}/> 仅本次浏览器会话</label></div>
        <div className="actions full"><button className="button-primary" disabled={busy} onClick={()=>void saveProvider(false)}>保存配置</button><button className="button-secondary" disabled={busy} onClick={()=>void saveProvider(true)}>保存并测试</button><button className="button-quiet danger" onClick={()=>void sendRuntimeMessage<WeaveSettings>({type:'CLEAR_API_KEY'}).then(setSettings)}>清除密钥</button></div>
        {status && <p className={`status full ${status.error?'is-error':''}`}>{status.text}</p>}
      </div>}

      {section==='web' && <div className="settings-card"><label className="switch"><span>智能上下文<small>先理解文章主题与术语，再翻译相邻段落</small></span><input type="checkbox" checked={settings.contextEnabled} onChange={(e)=>void update({contextEnabled:e.target.checked})}/></label><label className="field compact"><span>默认页面模式</span><select value={settings.dock.pageMode} onChange={(e)=>void update({dock:{...settings.dock,pageMode:e.target.value as WeaveSettings['dock']['pageMode']}})}><option value="bilingual">双语对照</option><option value="translated">仅译文</option><option value="original">原文</option></select></label><p className="note">翻译按视口优先进行。原始网页节点不会被覆盖，关闭翻译即可完整恢复。</p></div>}
      {section==='selection' && <div className="settings-card"><label className="switch"><span>启用划词翻译<small>选中文本后显示一个轻量翻译圆点</small></span><input type="checkbox" checked={settings.selectionEnabled} onChange={(e)=>void update({selectionEnabled:e.target.checked})}/></label><p className="note">划词请求会包含所在段落、相邻段落和最近标题；密码框、编辑器与代码块始终排除。</p></div>}
      {section==='video' && <div className="settings-card"><label className="field compact"><span>字幕显示</span><select value={settings.video.mode} onChange={(e)=>void update({video:{...settings.video,mode:e.target.value as WeaveSettings['video']['mode']}})}><option value="bilingual">原文 + 译文</option><option value="translated">仅译文</option></select></label><label className="range"><span>字号 {settings.video.fontScale.toFixed(2)}×</span><input type="range" min="0.75" max="1.6" step="0.05" value={settings.video.fontScale} onChange={(e)=>void update({video:{...settings.video,fontScale:Number(e.target.value)}})}/></label><label className="range"><span>底部位置 {settings.video.bottomOffset}%</span><input type="range" min="5" max="35" value={settings.video.bottomOffset} onChange={(e)=>void update({video:{...settings.video,bottomOffset:Number(e.target.value)}})}/></label><label className="range"><span>背景不透明度 {Math.round(settings.video.backgroundOpacity*100)}%</span><input type="range" min="0.2" max="1" step="0.05" value={settings.video.backgroundOpacity} onChange={(e)=>void update({video:{...settings.video,backgroundOpacity:Number(e.target.value)}})}/></label><p className="note">首版读取 YouTube/Bilibili 已有字幕，不包含无字幕语音识别。</p></div>}
      {section==='dock' && <div className="settings-card"><div className="permission-block"><div><h2>所有网页侧边坞</h2><p>授权只用于显示界面和读取你主动要求翻译的文本，不会自动调用模型。</p></div><button className={permission?'button-secondary':'button-primary'} onClick={()=>void toggleAllSites()}>{permission?'撤销全站权限':'启用所有网页'}</button></div><label className="switch"><span>固定展开<small>关闭后，离开侧边坞约 600ms 自动收回</small></span><input type="checkbox" checked={settings.dock.pinned} onChange={(e)=>void update({dock:{...settings.dock,pinned:e.target.checked}})}/></label><p className="note">快捷键 Alt+Shift+W：开始或停止当前页面翻译。可在 Chrome 扩展快捷键页面中修改。</p></div>}
      {section==='privacy' && <div className="settings-card"><h2>本地数据</h2><p className="note">API Key 与设置保存在 Chrome 扩展空间。持久密钥并非操作系统级加密；内容脚本、日志和导出均无法读取其明文。</p><div className="actions"><button className="button-secondary" onClick={()=>void sendRuntimeMessage({type:'CLEAR_CACHE',scope:'all'}).then(()=>setStatus({text:'全部翻译缓存已清除。'}))}>清除全部缓存</button></div>{currentSiteRules.length>0&&<div className="site-list"><h3>已保存站点规则</h3>{currentSiteRules.map(([host,rule])=><div key={host}><span>{host}</span><small>{rule.hidden?'已隐藏':rule.paused?'已暂停':rule.autoTranslate?'自动翻译':'手动翻译'}</small>{rule.hidden&&<button onClick={()=>void sendRuntimeMessage<WeaveSettings>({type:'SAVE_SITE_RULE',host,patch:{hidden:false}}).then(setSettings)}>恢复显示</button>}</div>)}</div>}{status&&<p className="status">{status.text}</p>}</div>}
      {section==='license' && <div className="settings-card prose"><p className="eyebrow">WEAVE TRANSLATE 0.1.0</p><h2>为阅读而做，不为账户而做。</h2><p>织语是一个本地优先、使用自有模型密钥的上下文翻译扩展。项目以 Apache License 2.0 发布。</p><p>设计与实现采用洁净室方式。第三方参考与许可证记录见项目内 <code>THIRD_PARTY_NOTICES.md</code>。</p><a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noreferrer">阅读 Apache-2.0 许可</a></div>}
    </section>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Options />);
