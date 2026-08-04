import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { WeaveSettings } from '../../lib/contracts';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>();
  useEffect(() => {
    void sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }).then(setSettings);
  }, []);
  return <main className="popup">
    <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE TRANSLATE</small></span></header>
    <p className="provider"><i className={settings?.provider.hasApiKey ? 'ready' : ''}/><span>{settings?.provider.label ?? '正在读取…'}</span><b>{settings?.provider.model}</b></p>
    <div className="popup-ready"><span aria-hidden="true">✓</span><p><strong>普通网页已自动启用</strong><small>点击页面侧边把手打开织语</small></p></div>
    <button className="button-primary" onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>打开完整设置</button>
    <footer><span>仅用户操作时调用模型</span><button onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>设置 →</button></footer>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Popup />);
