import { describe, expect, it } from 'vitest';
import { mergeSettings } from '../src/background/storage';

describe('settings migration', () => {
  it('copies the old global reasoning mode into every scene', () => {
    const settings = mergeSettings({ provider: { reasoningMode: 'deep' } as never });
    expect(settings.reasoning).toEqual({ page: 'deep', selection: 'deep', subtitle: 'deep' });
  });

  it('uses the new independent defaults for a fresh install', () => {
    expect(mergeSettings().reasoning).toEqual({ page: 'balanced', selection: 'fast', subtitle: 'fast' });
  });

  it('migrates a legacy provider into one connection, model and routed chat tasks', () => {
    const settings = mergeSettings({ provider: {
      id: 'legacy', label: 'Legacy API', kind: 'openai-compatible', endpoint: 'https://legacy.example/v1/chat/completions',
      model: 'legacy-model', reasoningMode: 'fast', targetLanguage: 'zh-CN', keyPersistence: 'session', hasApiKey: true,
    } as never });
    expect(settings.schemaVersion).toBe(2);
    expect(settings.connections[0]).toMatchObject({ id: 'legacy', secretRef: 'legacy', hasApiKey: false });
    expect(settings.models[0]).toMatchObject({ id: 'legacy-chat', connectionId: 'legacy', model: 'legacy-model' });
    expect(settings.taskRoutes.pageTranslation.profileId).toBe('legacy-chat');
    expect(settings.taskRoutes.transcription.profileId).toBe('');
  });
});
