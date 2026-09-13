// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { mergeSettings } from '../src/background/storage';
import { resolveChatRoute } from '../src/background/routing';
import { callProvider } from '../src/background/provider';
import type { ProviderProfile, TranslationTask } from '../src/lib/contracts';
import { blocksFromItems, contextWindow, needsVision, normalizeText } from '../src/pdf/context';
import { digest, imageMessage, validatePdfTask } from '../src/pdf/protocol';
import { evictedKeys, type PdfCacheRecord } from '../src/pdf/cache';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
const task: TranslationTask = { id: 'pdf-test', kind: 'selection', scope: 'pdf', sourceLanguage: 'auto', targetLanguage: 'zh-CN',
  units: [{ id: 'selection', text: 'The invariant is E = mc².', before: '[page 1] An energy relation.' }],
  pdf: { documentId: 'a'.repeat(64), pages: [1], budget: 8000 }, images: [{ page: 1, purpose: 'selection', dataUrl: png }] };
const profile: ProviderProfile = { id: 'vision', label: 'Vision', kind: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', capabilities: ['chat', 'vision'], reasoningMode: 'balanced', targetLanguage: 'zh-CN', hasApiKey: true, keyPersistence: 'session' };
describe('PDF routes and bounded visual input', () => {
  it('inherits existing selection and explanation models when adding PDF routes', () => {
    const old = structuredClone(DEFAULT_SETTINGS);
    const { pdf: _pdf, ...withoutPdf } = old;
    const { pdfTranslation: _t, pdfContext: _c, pdfExplanation: _e, ...routes } = withoutPdf.taskRoutes;
    routes.selectionTranslation.profileId = 'custom'; routes.selectionExplanation.profileId = 'expert'; routes.pageContext.profileId = 'brief';
    const migrated = mergeSettings({ ...withoutPdf, taskRoutes: routes as typeof old.taskRoutes });
    expect(migrated.taskRoutes.pdfTranslation.profileId).toBe('custom'); expect(migrated.taskRoutes.pdfExplanation.profileId).toBe('expert'); expect(migrated.taskRoutes.pdfContext.profileId).toBe('brief');
    expect(mergeSettings(migrated)).toEqual(migrated);
  });
  it('does not overwrite an explicitly disabled vision capability or apply website page routes to PDF', () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.models[0]!.capabilities = ['chat'];
    settings.siteRules['example.com'] = { pageProfileId: 'deleted' };
    expect(mergeSettings(settings).models[0]!.capabilities).toEqual(['chat']);
    expect(resolveChatRoute(settings, task, 'https://example.com/paper.pdf').key).toBe('pdfTranslation');
  });
  it('bounds imported cache settings and grants vision only for the known legacy official preset', () => {
    const old = { provider: { id: 'custom', kind: 'openai-compatible' as const, endpoint: 'https://example.com/chat/completions', model: 'text-only' } };
    expect(mergeSettings(old).models[0]!.capabilities).not.toContain('vision');
    const settings = mergeSettings({ ...DEFAULT_SETTINGS, pdf: { ...DEFAULT_SETTINGS.pdf, cacheMaxMb: -1 as 64, cacheDays: 999 as 7 } });
    expect(settings.pdf.cacheDays).toBe(7); expect(settings.pdf.cacheMaxMb).toBe(64);
  });
  it('rejects unsupported models, remote images, excessive images, pages and oversized context', () => {
    expect(() => validatePdfTask(task, profile)).not.toThrow();
    expect(() => validatePdfTask(task, { ...profile, capabilities: ['chat'] })).toThrow('图片输入');
    expect(() => validatePdfTask({ ...task, images: [{ ...task.images![0]!, dataUrl: 'https://example.com/image.png' }] }, profile)).toThrow('PNG');
    expect(() => validatePdfTask({ ...task, images: Array(3).fill(task.images![0]) }, profile)).toThrow('最多');
    expect(() => validatePdfTask({ ...task, images: [{ ...task.images![0]!, page: 99 }] }, profile)).toThrow('页码');
    expect(() => validatePdfTask({ ...task, units: [{ id: 'selection', text: '文'.repeat(9000) }] }, profile)).toThrow('预算');
  });
  it('puts images only in user message parts, enforces prompt contract and omits unsupported thinking', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('deepseek-flash'); expect(body.thinking).toBeUndefined();
      expect(body.messages[0].content).toContain('untrusted source');
      expect(body.messages[0].content).toContain('[unclear]');
      expect(body.messages[1].content[2]).toEqual({ type: 'image_url', image_url: { url: png, detail: 'high' } });
      expect(body.messages[1].content[0].text).not.toContain('base64');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: 'selection', text: '不变量是 $E=mc^2$。' }] }) } }] }));
    });
    const result = await callProvider(profile, 'fake-key', task, fetcher);
    expect(result.items[0]?.text).toContain('$E=mc^2$'); expect(fetcher).toHaveBeenCalledOnce();
    expect(imageMessage('text only', { ...task, images: [] })).toBe('text only');
  });
  it('cancels a request without retrying after abort', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => { controller.abort(); throw new Error('cancelled'); });
    await expect(callProvider(profile, '', task, fetcher, { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
describe('PDF local context and cache identities', () => {
  it('joins line-break words without losing formulas and separates columns', () => {
    const blocks = blocksFromItems([
      { str: 'Some contex-', x: 20, y: 30, width: 110, height: 12, hasEOL: true },
      { str: 'tual evidence.', x: 20, y: 46, width: 120, height: 12, hasEOL: true },
      { str: 'Other column', x: 320, y: 30, width: 110, height: 12, hasEOL: true },
    ], 1);
    expect(blocks).toHaveLength(2); expect(blocks[0]?.text).toBe('Some contextual evidence.');
    expect(normalizeText('ﬁnite  E = mc²')).toBe('finite E = mc²');
    expect(needsVision('E = mc²')).toBe(true);
  });
  it('retrieves a distant definition within the budget without sending unrelated pages', () => {
    const all = [
      { page: 1, index: 0, text: 'The quasiparticle is defined as an effective excitation.', heading: false, box: { x: 0, y: 0, width: 20, height: 20 } },
      { page: 50, index: 0, text: 'The quasiparticle carries energy.', heading: false, box: { x: 0, y: 0, width: 20, height: 20 } },
      { page: 99, index: 0, text: 'An irrelevant appendix.', heading: false, box: { x: 0, y: 0, width: 20, height: 20 } },
    ];
    const context = contextWindow('quasiparticle', 50, all, 8000, 1);
    expect(context.pages).toEqual([1, 50]); expect(context.text).not.toContain('irrelevant'); expect(context.estimatedTokens).toBeLessThanOrEqual(8000);
    expect(() => contextWindow('文'.repeat(10000), 50, all, 8000, 2)).toThrow('预算');
  });
  it('uses content hashes, not filenames, and changes identities when image/context/model changes', async () => {
    expect(await digest('same-name new contents')).not.toEqual(await digest('same-name old contents'));
    expect(await digest(JSON.stringify(task))).not.toEqual(await digest(JSON.stringify({ ...task, images: [] })));
    expect(await digest(JSON.stringify([task, profile]))).not.toEqual(await digest(JSON.stringify([task, { ...profile, model: 'other' }])));
  });
  it('evicts expired and least recently used entries, including after retention is reduced', () => {
    const record = (key: string, createdAt: number, accessedAt: number, bytes = 40): PdfCacheRecord => ({ key, documentId: 'a', createdAt, accessedAt, bytes, expiresAt: createdAt + 30 * 86400000, value: 'test' });
    const now = 10 * 86400000;
    expect(evictedKeys([record('expired', 0, now), record('old', now, 1), record('new', now, 2)], now, 7, 40).sort()).toEqual(['expired', 'old']);
    expect(evictedKeys([record('retention-change', now - 2 * 86400000, now)], now, 1, 100)).toEqual(['retention-change']);
  });
});
