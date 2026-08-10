import type {
  ContextBrief,
  GlossaryMatch,
  ProviderProfile,
  TranslationItem,
  TranslationResult,
  TranslationTask,
} from '../lib/contracts';
import { validateMathPlaceholders } from '../lib/math';

const RETRY_DELAYS = [800, 2_000, 5_000];

export class ProviderError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number) {
    super(message);
  }
}

export interface ProviderCallOptions {
  glossaryLookup?: (queries: string[]) => Promise<GlossaryMatch[]>;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface CompletionMessage {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export function validateEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new ProviderError('远程模型接口必须使用 HTTPS；HTTP 仅允许本机地址。', 'INSECURE_ENDPOINT');
  }
  if (url.username || url.password) throw new ProviderError('接口地址不能包含用户名或密码。', 'INVALID_ENDPOINT');
  return url;
}

export function reasoningParameters(profile: ProviderProfile): Record<string, unknown> {
  switch (profile.reasoningMode) {
    case 'fast':
      return profile.kind === 'deepseek' ? { thinking: { type: 'disabled' } } : { reasoning_effort: 'none' };
    case 'balanced':
      return profile.kind === 'deepseek'
        ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
        : { reasoning_effort: 'medium' };
    case 'deep':
      return profile.kind === 'deepseek'
        ? { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
        : { reasoning_effort: 'high' };
    default:
      return {};
  }
}

function systemPrompt(kind: TranslationTask['kind']): string {
  if (kind === 'summary') {
    return 'You are a context analyst. Return strict JSON: {"summary":"...","terms":[{"source":"...","preferred":"...","note":"..."}]}. Keep the summary concise and include at most 20 terms.';
  }
  if (kind === 'explain') {
    return 'You explain translation choices concisely. Return strict JSON: {"items":[{"id":"same id","text":"context-aware explanation"}],"suggestedTerms":[]}. Never add unrequested items. Suggested terms are optional and require user approval.\n' + structuredOutputContract();
  }
  if (kind === 'subtitle') {
    return 'You are a precise professional subtitle translator. Preserve meaning, tone, names, numbers, and formulas. Use context and matched glossary entries only to disambiguate. Return strict JSON: {"items":[{"id":"same id","text":"plain-text translation"}],"suggestedTerms":[]}. Return every input id exactly once and no extra prose. Do not use Markdown or HTML.';
  }
  return 'You are a precise professional translator. Preserve meaning, tone, names, numbers, citations, and formatting. Prefer supplied glossary translations when the sense matches. Return strict JSON: {"items":[{"id":"same id","text":"translation"}],"suggestedTerms":[]}. Return every input id exactly once and no extra prose. Suggested terms are optional and require user approval.\n' + structuredOutputContract();
}

function structuredOutputContract(): string {
  return [
    'FORMAT CONTRACT for every items[].text:',
    '- Use restricted Markdown only: paragraphs, line breaks, headings, lists, blockquotes, **bold**, *italic*, `code`, inline $LaTeX$, and display $$LaTeX$$.',
    '- Never emit HTML, script, style, images, remote resources, or fenced JSON.',
    '- A unit may contain math metadata {token, latex, display, fallback} for protected inline formulas and contextMath for nearby display equations. Read both LaTeX fields to understand references and terminology.',
    '- Copy every token shaped like ⟦WEAVE_MATH_*⟧ from that unit exactly once, unchanged and in the semantically correct position.',
    '- Never translate, rewrite, renumber, duplicate, delete, wrap, or place a math token inside Markdown emphasis or code.',
    '- Do not repeat a standalone display equation; the page keeps its original formula.',
  ].join('\n');
}

function userPrompt(task: TranslationTask): string {
  return JSON.stringify({
    task: task.kind,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    context: task.context ?? null,
    matchedGlossary: task.glossary ?? [],
    outputFormat: task.kind === 'page' || task.kind === 'selection' || task.kind === 'explain' ? 'restricted-markdown-latex-v1' : 'plain-text',
    units: task.units,
  });
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseSuggestions(parsed: unknown): TranslationResult['suggestedTerms'] {
  const values = (parsed as { suggestedTerms?: unknown }).suggestedTerms;
  if (!Array.isArray(values)) return undefined;
  const suggestions = values.filter((item): item is { source: string; preferred: string; note?: string } => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.source === 'string' && typeof candidate.preferred === 'string';
  }).slice(0, 10).map((item) => ({
    source: item.source.trim(),
    preferred: item.preferred.trim(),
    ...(typeof item.note === 'string' ? { note: item.note.trim() } : {}),
  })).filter((item) => item.source && item.preferred);
  return suggestions.length ? suggestions : undefined;
}

function parseResponse(task: TranslationTask, content: string, usage?: Record<string, number>): TranslationResult {
  const tokenUsage = usage ? {
    ...(usage.prompt_tokens != null ? { promptTokens: usage.prompt_tokens } : {}),
    ...(usage.completion_tokens != null ? { completionTokens: usage.completion_tokens } : {}),
  } : undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch {
    if (task.units.length === 1) return { taskId: task.id, items: [{ id: task.units[0]!.id, text: content.trim() }] };
    throw new ProviderError('模型返回了无法解析的格式，请重试或更换模型。', 'INVALID_MODEL_RESPONSE');
  }

  if (task.kind === 'summary') {
    const brief = parsed as Partial<ContextBrief>;
    return {
      taskId: task.id,
      items: [{ id: task.units[0]?.id ?? 'summary', text: JSON.stringify({ summary: brief.summary ?? '', terms: Array.isArray(brief.terms) ? brief.terms.slice(0, 20) : [] }) }],
      ...(tokenUsage ? { usage: tokenUsage } : {}),
    };
  }

  const rawItems = (parsed as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) throw new ProviderError('模型响应缺少 items 数组。', 'INVALID_MODEL_RESPONSE');
  const expected = new Set(task.units.map((unit) => unit.id));
  const items: TranslationItem[] = rawItems
    .filter((item): item is { id: string; text: string } => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.id === 'string' && typeof candidate.text === 'string' && expected.has(candidate.id);
    })
    .map((item) => {
      const unit = task.units.find((candidate) => candidate.id === item.id);
      const text = item.text.trim();
      const mathError = validateMathPlaceholders(text, unit?.math);
      return mathError ? { id: item.id, text: '', error: mathError } : { id: item.id, text };
    });
  for (const unit of task.units) {
    if (!items.some((item) => item.id === unit.id)) items.push({ id: unit.id, text: '', error: '模型未返回该段译文' });
  }
  const suggestedTerms = parseSuggestions(parsed);
  return {
    taskId: task.id,
    items,
    ...(tokenUsage ? { usage: tokenUsage } : {}),
    ...(suggestedTerms ? { suggestedTerms } : {}),
  };
}

async function readSse(response: Response): Promise<string> {
  if (!response.body) throw new ProviderError('模型返回了空的流式响应。', 'EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '');
      if (!data || data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        content += chunk.choices?.[0]?.delta?.content ?? '';
      } catch {
        // Vendor keepalive frame.
      }
    }
  }
  return content;
}

async function postWithRetry(endpoint: URL, headers: Record<string, string>, body: Record<string, unknown>, fetcher: typeof fetch): Promise<Response> {
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      if (attempt === RETRY_DELAYS.length - 1) throw new ProviderError('无法连接模型接口。', 'NETWORK_ERROR');
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) throw new ProviderError('API Key 无效或没有访问该模型的权限。', 'AUTH_ERROR', response.status);
    if ((response.status === 429 || response.status >= 500) && attempt < RETRY_DELAYS.length - 1) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1_000 : RETRY_DELAYS[attempt]));
      continue;
    }
    throw new ProviderError(`模型接口请求失败（HTTP ${response.status}）。`, 'HTTP_ERROR', response.status);
  }
  throw new ProviderError('模型请求失败。', 'UNKNOWN_ERROR');
}

function toolDefinition() {
  return [{
    type: 'function',
    function: {
      name: 'lookup_glossary',
      description: 'Look up ambiguous professional terms in the user\'s local glossary. Call only when supplied matchedGlossary is insufficient.',
      parameters: {
        type: 'object',
        properties: { queries: { type: 'array', items: { type: 'string' }, maxItems: 12 } },
        required: ['queries'],
        additionalProperties: false,
      },
    },
  }];
}

function parseToolQueries(call: ToolCall): string[] {
  if (call.function.name !== 'lookup_glossary') return [];
  try {
    const parsed = JSON.parse(call.function.arguments) as { queries?: unknown };
    return Array.isArray(parsed.queries)
      ? parsed.queries.filter((query): query is string => typeof query === 'string').map((query) => query.trim()).filter(Boolean).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

export async function callProvider(
  profile: ProviderProfile,
  apiKey: string,
  task: TranslationTask,
  fetcher: typeof fetch = fetch,
  options: ProviderCallOptions = {},
): Promise<TranslationResult> {
  const endpoint = validateEndpoint(profile.endpoint);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const supportsReasoning = profile.capabilities == null || profile.capabilities.includes('reasoningEffort');
  const reasoning = supportsReasoning ? reasoningParameters(profile) : {};
  const messages: CompletionMessage[] = [
    { role: 'system', content: systemPrompt(task.kind) },
    { role: 'user', content: userPrompt(task) },
  ];
  const supportsTools = !task.stream && profile.glossaryMode === 'hybrid' && profile.capabilities?.includes('tools') && options.glossaryLookup;
  const baseBody: Record<string, unknown> = {
    model: profile.model,
    ...(profile.reasoningMode === 'compatible' ? { temperature: 0.2 } : {}),
    ...reasoning,
    stream: Boolean(task.stream),
    messages,
    ...(supportsTools ? { tools: toolDefinition(), tool_choice: 'auto' } : {}),
  };
  const response = await postWithRetry(endpoint, headers, baseBody, fetcher);
  if (task.stream) return parseResponse(task, await readSse(response));
  let payload = await response.json() as { choices?: Array<{ message?: CompletionMessage }>; usage?: Record<string, number> };
  let message = payload.choices?.[0]?.message;
  const toolCall = supportsTools ? message?.tool_calls?.[0] : undefined;
  if (toolCall && options.glossaryLookup) {
    const queries = parseToolQueries(toolCall);
    const matches = queries.length ? await options.glossaryLookup(queries) : [];
    const secondMessages: CompletionMessage[] = [
      ...messages,
      { role: 'assistant', content: message?.content ?? null, tool_calls: [toolCall] },
      { role: 'tool', content: JSON.stringify({ matches }), tool_call_id: toolCall.id },
    ];
    const secondResponse = await postWithRetry(endpoint, headers, { ...baseBody, stream: false, messages: secondMessages, tools: toolDefinition(), tool_choice: 'none' }, fetcher);
    payload = await secondResponse.json() as typeof payload;
    message = payload.choices?.[0]?.message;
  }
  const content = message?.content;
  if (!content) throw new ProviderError('模型返回了空响应。', 'EMPTY_RESPONSE');
  return parseResponse(task, content, payload.usage);
}
