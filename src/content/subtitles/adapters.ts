import type { SubtitleCue } from '../../lib/contracts';
import { sendRuntimeMessage } from '../../lib/message';

interface BilibiliSubtitleInfo {
  lan?: string;
  lan_doc?: string;
  subtitle_url?: string;
}

export interface SubtitleLoadResult {
  cues: SubtitleCue[];
  language: string;
  title: string;
}

function normalizeHttps(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:/, 'https:');
}

export async function loadBilibiliSubtitles(): Promise<SubtitleLoadResult> {
  const bvid = location.pathname.match(/\/video\/(BV[\w]+)/i)?.[1] ?? new URLSearchParams(location.search).get('bvid');
  const aidMatch = location.pathname.match(/\/video\/av(\d+)/i)?.[1];
  if (!bvid && !aidMatch) throw new Error('无法识别当前 Bilibili 视频。');
  const viewUrl = bvid
    ? `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
    : `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(aidMatch!)}`;
  const view = await sendRuntimeMessage<{ data?: { aid?: number; cid?: number; title?: string; pages?: Array<{ cid: number; page: number }> } }>({
    type: 'FETCH_CAPTION_JSON',
    url: viewUrl,
  });
  const aid = view.data?.aid;
  const page = Number(new URLSearchParams(location.search).get('p') ?? '1');
  const cid = view.data?.pages?.find((item) => item.page === page)?.cid ?? view.data?.cid;
  if (!aid || !cid) throw new Error('无法取得 Bilibili 视频分集信息。');
  const player = await sendRuntimeMessage<{ data?: { subtitle?: { subtitles?: BilibiliSubtitleInfo[] } } }>({
    type: 'FETCH_CAPTION_JSON',
    url: `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
  });
  const tracks = player.data?.subtitle?.subtitles?.filter((track) => track.subtitle_url) ?? [];
  const track = tracks.find((item) => item.lan?.toLowerCase().startsWith('en')) ?? tracks[0];
  if (!track?.subtitle_url) throw new Error('当前视频暂无可用字幕。');
  const body = await sendRuntimeMessage<{ body?: Array<{ from: number; to: number; content: string }> }>({
    type: 'FETCH_CAPTION_JSON',
    url: normalizeHttps(track.subtitle_url),
  });
  return {
    title: view.data?.title ?? document.title,
    language: track.lan ?? 'auto',
    cues: (body.body ?? []).map((item, index) => ({
      id: `bili-${index}`,
      start: item.from,
      end: item.to,
      text: item.content,
      language: track.lan ?? 'auto',
    })),
  };
}

let latestYoutubeCaptionUrl = '';

export function observeYoutubeCaptionUrls(): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    try {
      const url = new URL(detail);
      if (url.hostname.endsWith('youtube.com') && url.pathname.includes('/api/timedtext')) latestYoutubeCaptionUrl = url.href;
    } catch {
      // Ignore malformed events from the page world.
    }
  };
  window.addEventListener('weave:youtube-caption-url', listener);
  return () => window.removeEventListener('weave:youtube-caption-url', listener);
}

export async function loadYoutubeSubtitles(): Promise<SubtitleLoadResult> {
  if (!latestYoutubeCaptionUrl) throw new Error('尚未发现字幕轨，请先开启一次 YouTube 原生字幕。');
  const url = new URL(latestYoutubeCaptionUrl);
  url.searchParams.set('fmt', 'json3');
  const payload = await sendRuntimeMessage<{
    events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
  }>({ type: 'FETCH_CAPTION_JSON', url: url.href });
  const cues = (payload.events ?? [])
    .filter((event) => event.segs?.length && event.tStartMs != null)
    .map((event, index) => ({
      id: `yt-${index}`,
      start: event.tStartMs! / 1_000,
      end: (event.tStartMs! + (event.dDurationMs ?? 2_000)) / 1_000,
      text: event.segs!.map((segment) => segment.utf8 ?? '').join('').replace(/\n/g, ' '),
      language: url.searchParams.get('lang') ?? 'auto',
    }));
  if (!cues.length) throw new Error('字幕轨为空或暂不受支持。');
  return { title: document.title.replace(/\s*-\s*YouTube$/, ''), language: url.searchParams.get('lang') ?? 'auto', cues };
}
