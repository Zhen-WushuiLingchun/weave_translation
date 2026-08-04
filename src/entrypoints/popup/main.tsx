import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { WeaveSettings } from '../../lib/contracts';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>();
  const [allSites, setAllSites] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    void Promise.all([
      sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }),
      sendRuntimeMessage<{ allSites: boolean }>({ type: 'GET_PERMISSION_STATE' }),
    ]).then(([loaded, permission]) => { setSettings(loaded); setAllSites(permission.allSites); });
  }, []);
  const inject = async () => {
    try { await sendRuntimeMessage({ type: 'INJECT_ACTIVE_TAB' }); setStatus('已在当前网页启用织语。'); }
    catch (error) { setStatus(error instanceof Error ? error.message : '当前页面无法启用。'); }
  };
  return <main className="popup">
    <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE TRANSLATE</small></span></header>
    <p className="provider"><i className={settings?.provider.hasApiKey ? 'ready' : ''}/><span>{settings?.provider.label ?? '正在读取…'}</span><b>{settings?.provider.model}</b></p>
    <button className="button-primary" onClick={() => void inject()}>在当前网页显示侧边坞</button>
    {!allSites && <button className="button-secondary" onClick={() => void sendRuntimeMessage<{granted:boolean}>({ type:'REQUEST_ALL_SITES' }).then((value)=>setAllSites(value.granted))}>启用所有网页</button>}
    {status && <p className="status">{status}</p>}
    <footer><span>{allSites ? '全站侧边坞已授权' : '当前为按页启用'}</span><button onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>完整设置 →</button></footer>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Popup />);
