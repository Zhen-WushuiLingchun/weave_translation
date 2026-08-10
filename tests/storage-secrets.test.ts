// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { clearApiKey, getApiKey, setApiKey } from '../src/background/storage';

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
