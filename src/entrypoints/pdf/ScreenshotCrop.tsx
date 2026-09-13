import { useEffect, useRef, useState } from 'react';
import type { PdfBox } from '../../pdf/context';
import { MAX_IMAGE_BYTES } from '../../pdf/protocol';

export async function cropScreenshot(url: string, box?: PdfBox): Promise<string> {
  const image = new Image(); image.src = url; await image.decode();
  const region = box ?? { x: 0, y: 0, width: image.width, height: image.height };
  const scale = Math.min(1, 2048 / Math.max(region.width, region.height));
  const canvas = document.createElement('canvas');
  try {
    for (let reduction = 1; reduction >= .2; reduction *= .75) {
      canvas.width = Math.max(1, Math.floor(region.width * scale * reduction)); canvas.height = Math.max(1, Math.floor(region.height * scale * reduction));
      canvas.getContext('2d')!.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/png');
      if (result.length <= MAX_IMAGE_BYTES * 4 / 3) return result;
    }
    throw new Error('图片过大，请缩小区域。');
  } finally { canvas.width = canvas.height = 0; image.src = ''; }
}

export function ScreenshotCrop({ url, onSelect }: { url: string; onSelect: (url: string) => void }): React.ReactElement {
  const image = useRef<HTMLImageElement>(null);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const [box, setBox] = useState<PdfBox>();
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [url]);
  const point = (event: React.PointerEvent) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.min(rect.width, Math.max(0, event.clientX - rect.x)), y: Math.min(rect.height, Math.max(0, event.clientY - rect.y)) }; };
  return <div><p className="quiet">拖动圈选需要翻译的区域。截图尚未发送。</p><div className="screenshot-crop" aria-label="圈选截图区域"
    onPointerDown={(event) => { if (event.button !== 0) return; origin.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { if (!origin.current) return; const p = point(event); setBox({ x: Math.min(p.x, origin.current.x), y: Math.min(p.y, origin.current.y), width: Math.abs(p.x - origin.current.x), height: Math.abs(p.y - origin.current.y) }); }}
    onPointerCancel={() => { origin.current = undefined; setBox(undefined); }}
    onPointerUp={(event) => {
      const start = origin.current; if (event.button !== 0 || !start || !image.current) return;
      origin.current = undefined; const end = point(event); const scale = image.current.naturalWidth / image.current.width;
      const region = { x: Math.min(end.x, start.x) * scale, y: Math.min(end.y, start.y) * scale, width: Math.abs(end.x - start.x) * scale, height: Math.abs(end.y - start.y) * scale };
      if (region.width < 4 || region.height < 4) return;
      void cropScreenshot(url, region).then((image) => { if (alive.current) onSelect(image); }).catch((failure: unknown) => { if (alive.current) setError(String(failure)); });
    }}><img ref={image} src={url} alt="当前 PDF 可见画面，本地框选预览" draggable={false} />{box && <span style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}</div>{error && <p role="alert">{error}</p>}</div>;
}
