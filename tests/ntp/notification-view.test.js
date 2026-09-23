// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function setup(setTimeout) {
  dom = await createScriptDom({
    html: '<!doctype html><html><body><button id="anchor"></button></body></html>',
    animationFrames: 'immediate'
  });
  await executeWindowScript(dom, 'ntp/modules/notification-view.js');
  const anchor = dom.window.document.getElementById('anchor');
  anchor.getBoundingClientRect = () => ({ bottom: 30, right: 90 });
  const view = dom.window.EchoNtpNotificationView.create({
    document: dom.window.document,
    window: dom.window,
    setTimeout: setTimeout || dom.window.setTimeout.bind(dom.window)
  });
  return { anchor, view };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('NTP notification view', () => {
  it('positions a toast relative to its anchor', async () => {
    const { anchor, view } = await setup(vi.fn());
    Object.defineProperty(dom.window, 'innerWidth', { value: 200, configurable: true });

    view.showToast('Saved', anchor);
    await Promise.resolve();

    const toast = dom.window.document.querySelector('.wp-toast');
    expect(toast.textContent).toBe('Saved');
    expect(toast.style.top).toBe('40px');
    expect(toast.style.right).toBe('110px');
    expect(toast.classList.contains('visible')).toBe(true);
  });

  it('runs snackbar actions and replaces an existing toast', async () => {
    const scheduled = [];
    const { view } = await setup((callback) => {
      scheduled.push(callback);
      return scheduled.length;
    });
    const action = vi.fn();
    view.showToast('Old');

    view.showSnackbar('Choose', 'Apply', action);
    dom.window.document.querySelector('.wp-snackbar-action').click();
    scheduled.at(-1)();

    expect(action).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelector('.wp-toast')).toBeNull();
    expect(dom.window.document.querySelector('.wp-snackbar')).toBeNull();
  });
});
