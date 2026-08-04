import ReactDOM from 'react-dom/client';
import { sendRuntimeMessage } from '../../lib/message';
import '../../ui/base.css';
import './style.css';

function Onboarding(): React.ReactElement {
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
          <span className="folio">01 / 已就绪</span>
          <h2>普通网页默认显示织语侧边栏</h2>
          <p>安装时授予的网页访问权限只用于显示界面，并读取你主动要求翻译的文本。</p>
          <ul>
            <li><b>不会</b>因为显示侧边栏自动调用模型</li>
            <li><b>不会</b>读取密码框、编辑器或隐藏节点</li>
            <li><b>可以</b>按站点暂停或永久隐藏</li>
          </ul>
          <div className="permission-ready"><span aria-hidden="true">✓</span><div><strong>全站侧边栏已启用</strong><small>刷新已经打开的网页即可看到侧边把手</small></div></div>
          <button className="button-primary" onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>配置我的模型 →</button>
        </div>
      </section>
      <footer><span>APACHE-2.0 · LOCAL FIRST</span><span>默认译为简体中文，可在设置中修改</span></footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Onboarding />);
