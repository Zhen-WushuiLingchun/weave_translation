import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: '织语 Weave',
    short_name: '织语',
    description: '用自己的模型，在网页与视频中获得有上下文的自然翻译。',
    version: '0.1.0',
    minimum_chrome_version: '114',
    permissions: ['storage', 'scripting', 'activeTab'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '织语 Weave',
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
    'build:manifestGenerated': (_wxt, manifest) => {
      // The all-site grant is optional and requested from onboarding. WXT adds
      // runtime content-script matches as required hosts, so move them back out.
      manifest.host_permissions = (manifest.host_permissions ?? []).filter(
        (origin: string) => origin !== 'http://*/*' && origin !== 'https://*/*' && origin !== '<all_urls>',
      );
    },
  },
});
