export const TOP_LAYER_Z_INDEX = '2147483647';

export function protectHost(host: HTMLElement): void {
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'relative', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('overflow', 'visible', 'important');
  host.style.setProperty('z-index', TOP_LAYER_Z_INDEX, 'important');
  if ('showPopover' in host) {
    host.setAttribute('popover', 'manual');
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch {
      // The host may be between document roots for a single mutation frame.
    }
  }
}

export function placeHostOnTop(
  host: HTMLElement,
  doc: Document = document,
  fullscreenTarget: Element | null = doc.fullscreenElement,
): Element | undefined {
  const target = fullscreenTarget && !host.contains(fullscreenTarget)
    ? fullscreenTarget
    : doc.documentElement;
  if (!target) return undefined;
  if (host.parentElement !== target || target.lastElementChild !== host) target.append(host);
  protectHost(host);
  return target;
}
