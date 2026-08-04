import { describe, expect, it } from 'vitest';
import { placeHostOnTop, protectHost, TOP_LAYER_Z_INDEX } from '../src/content/host-layer';

describe('floating host layer', () => {
  it('uses the maximum webpage z-index with important host protection', () => {
    const host = document.createElement('weave-translation-root');
    protectHost(host);
    expect(host.style.getPropertyValue('z-index')).toBe(TOP_LAYER_Z_INDEX);
    expect(host.style.getPropertyValue('overflow')).toBe('visible');
  });

  it('stays outside body replacements and returns to the last paint position', () => {
    const host = document.createElement('weave-translation-root');
    placeHostOnTop(host);
    document.body.replaceWith(document.createElement('body'));
    expect(host.isConnected).toBe(true);
    const laterLayer = document.createElement('aside');
    document.documentElement.append(laterLayer);
    placeHostOnTop(host);
    expect(document.documentElement.lastElementChild).toBe(host);
  });

  it('moves into a fullscreen container and back to the document root', () => {
    const host = document.createElement('weave-translation-root');
    const player = document.createElement('section');
    document.body.append(player);
    expect(placeHostOnTop(host, document, player)).toBe(player);
    expect(host.parentElement).toBe(player);
    expect(placeHostOnTop(host, document, null)).toBe(document.documentElement);
    expect(host.parentElement).toBe(document.documentElement);
  });
});
