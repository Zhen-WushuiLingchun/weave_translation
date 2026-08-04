import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { injectScript } from 'wxt/utils/inject-script';
import { observeYoutubeCaptionUrls } from '../../content/subtitles/adapters';
import App from './App';
import './style.css';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  registration: 'runtime',
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  noScriptStartedPostMessage: true,
  async main(ctx) {
    if (document.documentElement.dataset.weaveLoaded === 'true') return;
    document.documentElement.dataset.weaveLoaded = 'true';

    let stopYoutubeObserver: (() => void) | undefined;
    if (location.hostname.endsWith('youtube.com')) {
      stopYoutubeObserver = observeYoutubeCaptionUrls();
      await injectScript('/youtube-main-world.js', { keepInDom: true }).catch(() => undefined);
    }

    const ui = await createShadowRootUi(ctx, {
      name: 'weave-translation-root',
      position: 'overlay',
      anchor: 'body',
      onMount(container) {
        const app = document.createElement('div');
        app.dataset.weaveRoot = 'true';
        container.append(app);
        const root = ReactDOM.createRoot(app);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
        stopYoutubeObserver?.();
        delete document.documentElement.dataset.weaveLoaded;
      },
    });
    ui.mount();
  },
});
