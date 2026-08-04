import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

function Onboarding(): React.ReactElement {
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void sendRuntimeMessage<{ allSites: boolean }>({ type: 'GET_PERMISSION_STATE' }).then((state) => setGranted(state.allSites));
  }, []);

  const grant = async () => {
    setBusy(true);
    try {
      const result = await sendRuntimeMessage<{ granted: boolean }>({ type: 'REQUEST_ALL_SITES' });
      setGranted(result.granted);
      setStatus(result.granted ? '侧边坞已启用。打开或刷新普通网页即可看到右侧把手。' : '你暂未授予权限，仍可从工具栏在单个页面临时启用。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '权限申请失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="onboarding">
      <header className="brand"><span className="brand-mark">织</span><span className="brand-copy"><strong>织语</strong><small>WEAVE TRANSLATE</small></span></header>
      <section className="hero">
        <div>
          <p className="eyebrow">READ BETWEEN LANGUAGES</p>
          <h1>让译文理解<br /><em>它所在的文章。</em></h1>
          <p className="lead">网页、划词和视频字幕共享同一套上下文与术语记忆。模型由你选择，密钥只留在本机扩展中。</p>
        </div>
        <div className="permission-card">
          <span className="folio">01 / 权限</span>
          <h2>在所有普通网页显示侧边坞</h2>
          <p>Chrome 会提示织语可以读取网页内容。这项权限用于注入侧边坞与提取你主动要求翻译的文本。</p>
          <ul>
            <li><b>不会</b>因为授权自动调用模型</li>
            <li><b>不会</b>读取密码框、编辑器或隐藏节点</li>
            <li><b>可以</b>随时在 Chrome 或设置页撤销</li>
          </ul>
          <button className="button-primary" onClick={() => void grant()} disabled={busy || granted}>{granted ? '全站侧边坞已启用' : busy ? '等待 Chrome 确认…' : '启用所有网页侧边坞'}</button>
          <button className="button-quiet" onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>先配置我的模型 →</button>
          {status && <p className="status">{status}</p>}
        </div>
      </section>
      <footer><span>APACHE-2.0 · LOCAL FIRST</span><span>默认译为简体中文，可在设置中修改</span></footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Onboarding />);
