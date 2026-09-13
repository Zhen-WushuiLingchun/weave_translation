import { defineConfig } from 'wxt';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  // Rolldown may emit Unicode non-characters from dependency regex tables
  // (KaTeX includes U+FFFF). Chrome rejects extension scripts containing them.
  experimental: { escapeUnicode: true },
  manifest: {
    name: '织语 Weave',
    short_name: '织语',
    description: '用自己的模型，在网页与视频中获得有上下文的自然翻译。',
    version: '0.5.0',
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'offscreen', 'sidePanel', 'contextMenus', 'activeTab'],
    side_panel: { default_path: 'pdf.html' },
    optional_permissions: ['tabCapture'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '织语 Weave',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    commands: {
      'toggle-page-translation': {
        suggested_key: { default: 'Alt+Shift+W' },
        description: '开始或停止整页翻译',
      },
    },
    web_accessible_resources: [
      {
        resources: ['youtube-main-world.js'],
        matches: ['*://*.youtube.com/*'],
      },
    ],
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
      const copy = (directory: string) => {
        for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
          const relative = `${directory}/${entry.name}`;
          if (entry.isDirectory()) copy(relative);
          else if (!entry.name.startsWith('quickjs-')) files.push({ absoluteSrc: path.join(root, relative), relativeDest: `pdf-assets/${relative}` });
        }
      };
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) copy(directory);
      files.push({ absoluteSrc: path.join(root, 'LICENSE'), relativeDest: 'pdf-assets/LICENSE' });
      const worker = readFileSync(path.join(root, 'legacy/build/pdf.worker.min.mjs'), 'utf8');
      files.push({ relativeDest: 'pdf-assets/pdf.worker.min.mjs', contents: worker.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) });
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
    },
  },
});
