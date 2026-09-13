// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { clearApiKey, getApiKey, getSettings, mergeSettings, setApiKey } from '../src/background/storage';

function area(store: Map<string, unknown>) {
  return {
    async get(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map((key) => [key, store.get(key)]));
    },
    async set(values: Record<string, unknown>) { Object.entries(values).forEach(([key, value]) => store.set(key, value)); },
    async remove(keys: string | string[]) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => store.delete(key)); },
  };
}

describe('profile-scoped secret storage', () => {
  beforeEach(() => {
    const local = new Map<string, unknown>(); const session = new Map<string, unknown>();
    (globalThis as unknown as { browser: unknown }).browser = { storage: { local: area(local), session: area(session) } };
  });

  it.each(['v1', 'v2'])('persists the Flash upgrade from %s while preserving the existing secret', async (version) => {
    const storage = (globalThis as unknown as { browser: { storage: { local: ReturnType<typeof area> } } }).browser.storage.local;
    const base = mergeSettings();
    if (version === 'v1') {
      await storage.set({
        'weave.settings.v1': { provider: { id: 'deepseek', kind: 'deepseek', model: 'deepseek-v4-flash', keyPersistence: 'local' } },
        'weave.secret.local.v1': 'test-secret',
      });
    } else {
      await storage.set({ 'weave.settings.v2': { ...base, models: [{ ...base.models[0]!, model: 'deepseek-v4-flash' }] } });
      await setApiKey('deepseek', 'test-secret', 'local');
    }
    const settings = await getSettings();
    expect(settings.models[0]?.model).toBe('deepseek-flash');
    expect(settings.taskRoutes.selectionTranslation.profileId).toBe('deepseek-chat');
    expect(settings.connections[0]).toMatchObject({ secretRef: 'deepseek', hasApiKey: true });
    expect(await getApiKey('deepseek', 'local')).toBe('test-secret');
    const stored = (await storage.get('weave.settings.v2'))['weave.settings.v2'];
    expect(JSON.stringify(stored)).toContain('deepseek-flash');
    expect(JSON.stringify(stored)).not.toContain('test-secret');
    expect(await getSettings()).toEqual(settings);
  });

  it('keeps multiple keys isolated and moves a key between persistence areas', async () => {
    await setApiKey('alpha', 'key-a', 'local');
    await setApiKey('beta', 'key-b', 'session');
    expect(await getApiKey('alpha', 'local')).toBe('key-a');
    expect(await getApiKey('beta', 'session')).toBe('key-b');
    expect(await getApiKey('alpha', 'session')).toBe('');
    await setApiKey('alpha', 'key-a2', 'session');
    expect(await getApiKey('alpha', 'local')).toBe('');
    expect(await getApiKey('alpha', 'session')).toBe('key-a2');
    await clearApiKey('alpha');
    expect(await getApiKey('alpha', 'session')).toBe('');
    expect(await getApiKey('beta', 'session')).toBe('key-b');
  });
});
