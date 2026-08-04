export default defineUnlistedScript(() => {
  const dispatch = (candidate: string) => {
    try {
      const url = new URL(candidate, location.href);
      if (url.hostname.endsWith('youtube.com') && url.pathname.includes('/api/timedtext')) {
        window.dispatchEvent(new CustomEvent('weave:youtube-caption-url', { detail: url.href }));
      }
    } catch {
      // Ignore non-URL request objects.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function weaveFetch(input: RequestInfo | URL, init?: RequestInit) {
    dispatch(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    return originalFetch.call(this, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function weaveOpen(method: string, url: string | URL, ...rest: unknown[]) {
    dispatch(String(url));
    if (rest.length) {
      return originalOpen.call(this, method, url, Boolean(rest[0]), rest[1] as string | undefined, rest[2] as string | undefined);
    }
    return originalOpen.call(this, method, url, true);
  };

  const inspectPlayer = () => {
    const player = (window as typeof window & {
      ytInitialPlayerResponse?: {
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string }> } };
      };
    }).ytInitialPlayerResponse;
    const track = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.baseUrl;
    if (track) dispatch(track);
  };
  inspectPlayer();
  window.addEventListener('yt-navigate-finish', inspectPlayer);
});
