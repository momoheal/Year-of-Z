/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://localhost/zone.html?e2e=1"}
 *
 * zone-ui.test.ts —— 页面与 UI 接线的无头冒烟
 *
 * 交付环境没有 Chromium，这里是替代方案：把真实的 zone.html 灌进 jsdom，
 * 注入一个"不画东西的 renderer"，然后真的 import zmain、真的驱动帧循环。
 * 验证的是接线与事件，不是画面好不好看。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------- canvas / rAF 桩

function ctx2dStub(): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_t, p) {
      if (p === 'canvas') return null;
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set: () => true
  });
}

const rafQueue: FrameRequestCallback[] = [];

beforeAll(() => {
  const html = readFileSync(resolve(__dirname, '../zone.html'), 'utf-8');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  document.body.innerHTML = body;

  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx2dStub();
  (window as unknown as { devicePixelRatio: number }).devicePixelRatio = 1;

  // 帧循环由测试手动驱动，避免跑成野循环
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
    (cb) => { rafQueue.push(cb); return rafQueue.length; };

  (window as unknown as Record<string, unknown>).__ZONE_TEST_RENDERER__ = {
    domElement: document.createElement('canvas'),
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    dispose: () => undefined
  };
});

let clockMs = 0; // 单调递增，避免负 dt
const tick = (n: number, dt = 16.7) => {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.pop();
    if (!cb) break;
    clockMs += dt;
    cb(clockMs);
  }
};

const $ = (id: string) => document.getElementById(id)!;

describe('域外探索 · 页面接线', () => {
  it('zmain 能启动，标题画面在，没有 WebGL 报错', async () => {
    await import('../src/zone/zmain');
    expect($('webgl-error').classList.contains('hidden')).toBe(true);
    expect($('title-screen').classList.contains('hidden')).toBe(false);
  });

  it('点「出门」进入夜晚，时钟开始走', async () => {
    ($('btn-start') as HTMLButtonElement).click();
    tick(120);
    expect($('title-screen').classList.contains('hidden')).toBe(true);
    const clock = $('clock').textContent ?? '';
    expect(clock).toMatch(/^2[0-3]:\d{2}$/);
    expect($('dawn-in').textContent).toContain('距天亮');
  });

  it('WASD 会让人走起来，Shift 疾跑会掉体力', () => {
    const before = $('clock').textContent;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    tick(180);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect($('clock').textContent).not.toBe(before);
    const sta = Number($('v-sta-n').textContent);
    expect(sta).toBeLessThan(100);
  });

  it('HUD 上的四个条都在，且都是数字（文字层不撒谎）', () => {
    for (const id of ['v-hp-n', 'v-san-n', 'v-sta-n', 'v-bat-n']) {
      expect(Number.isFinite(Number($(id).textContent))).toBe(true);
    }
    expect($('gear').textContent).toContain('撬棍');
    expect($('home-dist').textContent).toContain('家');
  });

  it('四个面板都能开关，背包画得出占格底板', () => {
    ($('btn-bag') as HTMLButtonElement).click();
    expect($('panel-bag').classList.contains('hidden')).toBe(false);
    expect($('bag-grid').children.length).toBeGreaterThan(10); // 30 格：空格 + 物品
    ($('btn-bag') as HTMLButtonElement).click();

    ($('btn-log') as HTMLButtonElement).click();
    expect($('log-body').textContent).toContain('撤离路线');
    expect($('log-body').textContent).toContain('地道');
    ($('btn-log') as HTMLButtonElement).click();

    ($('btn-map') as HTMLButtonElement).click();
    expect($('minimap')).toBeTruthy();
    ($('btn-map') as HTMLButtonElement).click();

    ($('btn-menu') as HTMLButtonElement).click();
    expect($('panel-menu').textContent).toContain('两根钟');
    ($('panel-menu').querySelector('[data-close]') as HTMLButtonElement).click();
    expect($('panel-menu').classList.contains('hidden')).toBe(true);
  });

  it('面板打开时世界停住（两根钟也停，这是明说的规则）', () => {
    const c0 = $('clock').textContent;
    ($('btn-bag') as HTMLButtonElement).click();
    tick(120);
    expect($('clock').textContent).toBe(c0);
    ($('btn-bag') as HTMLButtonElement).click();
  });

  it('05:30 天亮：在街上会被记录，画面给出明确提示', () => {
    const api = (window as unknown as {
      __zone: { state: () => { gameMin: number; flags: Record<string, number>; zombies: unknown[]; militia: unknown[]; player: { hp: number } } }
    }).__zone;
    const st = api.state();
    // 这一条只测时钟法则：先把活物清掉，免得测到一半被咬（那只属于另一条用例）
    st.zombies = []; st.militia = []; st.player.hp = 100;
    st.gameMin = 569.4;
    tick(120);
    expect(st.flags.recorded).toBe(1);
    expect($('phase-tag').textContent).toBe('天亮');
  });

  it('走进门廊灯 = 到家：结算档案出来，登记两个选项都在', () => {
    const api = (window as unknown as {
      __zone: { state: () => { gameMin: number; player: { x: number; z: number; hp: number }; zombies: unknown[]; militia: unknown[] } }
    }).__zone;
    const st = api.state();
    st.zombies = []; st.militia = []; st.player.hp = 100; st.gameMin = 300;
    st.player.x = -30; st.player.z = 20;
    tick(10);
    expect($('end-screen').classList.contains('hidden')).toBe(false);
    const text = $('end-body').textContent ?? '';
    expect(text).toContain('心神');
    expect(text).toContain('诚实兑现');
    expect($('end-register').classList.contains('hidden')).toBe(false);
    ($('btn-reg-honest') as HTMLButtonElement).click();
    tick(4);
    expect(($('end-body').textContent ?? '')).toContain('照实写');
    expect(($('end-body').textContent ?? '')).toContain('核酸');
  });

  it('再来一夜：时钟回到 20:00，结算画面收起', () => {
    ($('btn-end-again') as HTMLButtonElement).click();
    tick(10);
    expect($('end-screen').classList.contains('hidden')).toBe(true);
    expect($('clock').textContent).toBe('20:00');
  });
});
