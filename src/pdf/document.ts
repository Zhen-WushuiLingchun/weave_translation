import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { browser } from 'wxt/browser';
import { blocksFromItems, type PdfBlock, type PdfBox } from './context';
import { digest, MAX_IMAGE_BYTES } from './protocol';

const asset = (relative: string) => new URL(`pdf-assets/${relative}`, browser.runtime.getURL('/pdf.html')).href;
GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.mjs');
const MAX_DOCUMENT_BYTES = 100 * 1048576;

export function documentUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含账户密码的 HTTP/HTTPS PDF 地址；本地文件请用文件选择器。');
  return url;
}
export async function readPdf(source: File | string, signal: AbortSignal): Promise<Uint8Array> {
  if (typeof source !== 'string') {
    if (source.size > MAX_DOCUMENT_BYTES) throw new Error('首版单份 PDF 最大 100 MiB。');
    const data = new Uint8Array(await source.arrayBuffer()); signal.throwIfAborted(); return data;
  }
  const response = await fetch(documentUrl(source), { signal, credentials: 'include' });
  if (!response.ok) throw new Error(`无法读取 PDF（HTTP ${response.status}）。可先下载后选择本地文件。`);
  if (Number(response.headers.get('Content-Length')) > MAX_DOCUMENT_BYTES) throw new Error('首版单份 PDF 最大 100 MiB。');
  if (!response.body) throw new Error('文档内容为空。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_DOCUMENT_BYTES) throw new Error('首版单份 PDF 最大 100 MiB。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function openPdf(bytes: Uint8Array, signal: AbortSignal, password?: string): Promise<{ pdf: PDFDocumentProxy; id: string }> {
  signal.throwIfAborted();
  const id = await digest(bytes);
  const task = getDocument({ data: bytes, maxImageSize: 32 * 1024 * 1024, canvasMaxAreaInBytes: 64 * 1024 * 1024, ...(password ? { password } : {}),
    cMapUrl: asset('cmaps/'), cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'),
    wasmUrl: asset('wasm/'),
  });
  const abort = () => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try { const pdf = await task.promise; signal.throwIfAborted(); return { pdf, id }; }
  finally { signal.removeEventListener('abort', abort); }
}

export async function pageBlocks(page: PDFPageProxy): Promise<PdfBlock[]> {
  const content = await page.getTextContent(); const viewport = page.getViewport({ scale: 1 });
  return blocksFromItems(content.items.flatMap((item) => {
    if (!('str' in item)) return [];
    const [x, y] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
    return [{ str: item.str, x: x!, y: y! - item.height, width: item.width, height: item.height, hasEOL: item.hasEOL }];
  }), page.pageNumber);
}

/** Render at crop resolution, independently of the current reader zoom. */
export async function cropPage(page: PDFPageProxy, box: PdfBox, signal: AbortSignal): Promise<string> {
  if (box.width < 2 || box.height < 2) throw new Error('选区太小，请重新圈选。');
  const scale = Math.min(3, 2048 / Math.max(box.width, box.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(box.width * scale)); canvas.height = Math.max(1, Math.floor(box.height * scale));
  const render = page.render({ canvas, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -box.x * scale, -box.y * scale], background: 'white' });
  const abort = () => render.cancel(); signal.addEventListener('abort', abort, { once: true });
  try {
    await render.promise; signal.throwIfAborted();
    let dataUrl = canvas.toDataURL('image/png');
    while (dataUrl.length > MAX_IMAGE_BYTES * 4 / 3 && canvas.width > 256 && canvas.height > 64) {
      const reduced = document.createElement('canvas'); reduced.width = Math.floor(canvas.width * .75); reduced.height = Math.floor(canvas.height * .75);
      reduced.getContext('2d')!.drawImage(canvas, 0, 0, reduced.width, reduced.height);
      canvas.width = reduced.width; canvas.height = reduced.height;
      canvas.getContext('2d')!.drawImage(reduced, 0, 0); reduced.width = reduced.height = 0;
      dataUrl = canvas.toDataURL('image/png');
    }
    if (dataUrl.length > MAX_IMAGE_BYTES * 4 / 3) throw new Error('截图超过大小上限，请缩小选区。');
    return dataUrl;
  } finally { signal.removeEventListener('abort', abort); canvas.width = canvas.height = 0; }
}
