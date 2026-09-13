import { describe, expect, it } from 'vitest';
import { mergeSettings, migrateDeepSeekFlash, migrateLocalAsrToQwen } from '../src/background/storage';

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

describe('DeepSeek V4.1 Flash migration', () => {
  it('upgrades official Flash aliases without changing route IDs or custom names', () => {
    const base = mergeSettings();
    const settings = {
      ...base,
      models: [
        { ...base.models[0]!, label: 'DeepSeek Chat', model: 'deepseek-v4-flash' },
        { ...base.models[0]!, id: 'research', label: '论文模型', model: 'deepseek-v4-flash-vision-exp', enabled: false },
      ],
    };
    const migrated = migrateDeepSeekFlash(settings);
    expect(migrated.changed).toBe(true);
    expect(migrated.settings.models[0]).toMatchObject({ id: 'deepseek-chat', label: 'DeepSeek V4.1 Flash', model: 'deepseek-flash' });
    expect(migrated.settings.models[1]).toMatchObject({ id: 'research', label: '论文模型', model: 'deepseek-flash', enabled: false });
    expect(migrated.settings.connections).toEqual(settings.connections);
    expect(migrated.settings.taskRoutes).toEqual(settings.taskRoutes);
    expect(settings.models[0]?.model).toBe('deepseek-v4-flash');
    expect(migrateDeepSeekFlash(migrated.settings)).toEqual({ settings: migrated.settings, changed: false });
  });

  it('leaves third-party endpoints, Pro and custom models untouched', () => {
    const base = mergeSettings();
    for (const endpoint of ['https://proxy.example/v1/chat/completions', 'https://api.deepseek.com.evil.example/chat/completions', 'invalid']) {
      const settings = { ...base, connections: [{ ...base.connections[0]!, chatEndpoint: endpoint }],
        models: [{ ...base.models[0]!, model: 'deepseek-v4-flash' }] };
      expect(migrateDeepSeekFlash(settings)).toEqual({ settings, changed: false });
    }
    for (const model of ['deepseek-v4-pro', 'custom-model', 'deepseek-flash']) {
      const settings = { ...base, models: [{ ...base.models[0]!, model }] };
      expect(migrateDeepSeekFlash(settings)).toEqual({ settings, changed: false });
    }
  });
});

describe('local ASR migration', () => {
  it('moves the former 8765 OpenVINO profile to Qwen without changing its route id', () => {
    const base = mergeSettings();
    const settings = {
      ...base,
      connections: [...base.connections, {
        id: 'local-asr', label: 'Local ASR', kind: 'openai-compatible' as const,
        chatEndpoint: '', transcriptionEndpoint: 'http://127.0.0.1:8765/v1/audio/transcriptions',
        secretRef: 'local-asr', keyPersistence: 'local' as const, hasApiKey: false,
        transcriptionResponseMode: 'verbose_json' as const,
      }],
      models: [...base.models, {
        id: 'local-asr-model', label: 'OpenVINO Whisper', connectionId: 'local-asr',
        model: 'openvino-whisper-base-int8-gpu', capabilities: ['audioTranscription' as const], enabled: true,
      }],
      taskRoutes: { ...base.taskRoutes, transcription: { ...base.taskRoutes.transcription, profileId: 'local-asr-model' } },
    };

    const migrated = migrateLocalAsrToQwen(settings);

    expect(migrated.changed).toBe(true);
    expect(migrated.settings.models.at(-1)).toMatchObject({
      id: 'local-asr-model', model: 'qwen3-asr-1.7b-cuda', label: 'Qwen3-ASR 1.7B (Local CUDA)',
    });
    expect(migrated.settings.taskRoutes.transcription.profileId).toBe('local-asr-model');
  });
});
