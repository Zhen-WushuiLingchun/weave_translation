import type { RuntimeRequest, RuntimeResponse } from './contracts';

export async function sendRuntimeMessage<T>(request: RuntimeRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(request)) as RuntimeResponse<T>;
  if (!response?.ok) throw new Error(response?.error || '织语后台没有响应');
  return response.data;
}
