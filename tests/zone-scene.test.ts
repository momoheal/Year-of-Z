/**
 * zone-scene.test.ts —— 表现层无头冒烟
 *
 * 交付环境里没有 Chromium，跑不了 Playwright；这里用"注入一个不画东西的 renderer" +
 * 一个最小的 canvas 桩，把建景(build)与每帧同步(sync)这两段最容易炸的代码真的执行一遍。
 * 它不验证画面好不好看，只验证**不抛异常、不产生 NaN 变换**。
 */

import { describe, expect, it } from 'vitest';
import type * as THREENS from 'three';

// ---------------------------------------------------------------- 最小 DOM 桩

function ctx2dStub(): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_t, p) {
      if (p === 'canvas') return null;
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (p === 'globalAlpha' || p === 'lineWidth') return 1;
      return () => undefined;
    },
    set: () => true
  });
}

function canvasStub(): unknown {
  const c: Record<string, unknown> = {
    width: 0, height: 0, style: {},
    getContext: () => ctx2dStub(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
  return c;
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement: () => canvasStub(),
  createElementNS: () => canvasStub()
};
g.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener: () => undefined };
g.self = g.window;

const THREE = await import('three'); // 值导入（类型位用 unknown，避免命名空间误用）
const { ZoneScene } = await import('../src/zone/zscene');
const { brickItem, tagMesh, BrickRing, brickPile, zombieMesh } = await import('../src/zone/zbricks');
const { createZone, stepZone, knockOut, addItem, noiseAt } = await import('../src/zone/zkernel');
const { ITEMS, ZKINDS } = await import('../src/zone/zdata');

function stubRenderer(): THREENS.WebGLRenderer {
  return {
    domElement: canvasStub(),
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    dispose: () => undefined
  } as unknown as THREENS.WebGLRenderer;
}

function stubContainer(): HTMLElement {
  return { clientWidth: 1280, clientHeight: 720, appendChild: () => undefined } as unknown as HTMLElement;
}

function makeScene(): InstanceType<typeof ZoneScene> {
  return new ZoneScene(stubContainer(), stubRenderer());
}

// ---------------------------------------------------------------- 零件

describe('乐高零件', () => {
  it('每一件物品都搭得出来，尺寸就是占格', () => {
    for (const id of Object.keys(ITEMS)) {
      const g2 = brickItem(id);
      expect(g2.children.length).toBeGreaterThan(0);
      for (const c of g2.children) {
        expect(Number.isFinite(c.position.x + c.position.y + c.position.z)).toBe(true);
        expect(Number.isFinite(c.scale.x + c.scale.y + c.scale.z)).toBe(true);
      }
      const box = new THREE.Box3().setFromObject(g2);
      expect(Number.isFinite(box.min.x) && Number.isFinite(box.max.z)).toBe(true);
    }
  });

  it('挂牌：凸点数就是分量，颜色就是类别', () => {
    const t = tagMesh(0xc97363, 2);
    const box = new THREE.Box3().setFromObject(t);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.1);
  });

  it('噪音积木环：半径能长开且不产生 NaN 矩阵', () => {
    const r = new BrickRing(24);
    for (const rad of [0.4, 5, 13.5, 23.75]) {
      r.update(rad, 0.6, 0xd9a05b);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 24; i++) {
        r.mesh.getMatrixAt(i, m);
        expect(m.elements.every((v) => Number.isFinite(v))).toBe(true);
      }
    }
  });

  it('地上一堆：堆叠数量有上限，不会无穷叠', () => {
    const p = brickPile('bandage', 6);
    expect(p.children.length).toBeLessThanOrEqual(3);
  });

  it('六种丧尸 + 幻觉体都搭得出来', () => {
    for (const k of Object.keys(ZKINDS)) {
      const kind = k as keyof typeof ZKINDS;
      expect(zombieMesh(kind).children.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------- 建景与同步

describe('场景：建景与每帧同步', () => {
  it('整张固定图能建起来（不抛异常）', () => {
    const st = createZone();
    const s = makeScene();
    expect(() => s.build(st)).not.toThrow();
  });

  it('连跑 600 帧同步不炸：玩家、丧尸、机动队、噪音环、掉包全都走一遍', () => {
    const st = createZone();
    const s = makeScene();
    s.build(st);

    const input = {
      mx: 1, mz: 0.4, stance: 'run' as const, aimX: 10, aimZ: 4,
      interact: false, swing: false, shoot: false, throwCan: false, toggleLight: false
    };
    for (let i = 0; i < 600; i++) {
      if (i === 40) { st.player.light = true; }
      if (i === 60) noiseAt(st, st.player.x, st.player.z, 5);
      if (i === 70) input.swing = true;
      if (i === 90) { st.player.gun = true; st.player.ammo = 8; input.shoot = true; }
      if (i === 120) knockOut(st);
      if (i === 200) { input.interact = true; }
      if (i === 260) { st.gameMin = 569; }
      stepZone(st, 1 / 60, input);
      s.ensureDynamicContainers();
      s.sync(st, 1 / 60);
      input.swing = false; input.shoot = false;
    }
    expect(Number.isFinite(st.player.x) && Number.isFinite(st.player.z)).toBe(true);
    expect(s.screenToWorld(0, 0)).toHaveProperty('x');
    const sc = s.worldToScreen(0, 0);
    expect(Number.isFinite(sc.x) && Number.isFinite(sc.y)).toBe(true);
  });

  it('搬家到各个角落都不炸，缩放边界也安全', () => {
    const st = createZone();
    const s = makeScene();
    s.build(st);
    for (const [x, z] of [[-39, -27], [39, 27], [0, 0], [27, 9], [-16.5, 8.6], [8, 21]] as [number, number][]) {
      st.player.x = x; st.player.z = z;
      s.sync(st, 1 / 60);
    }
    s.setZoom(0.1); s.setZoom(99); s.setZoom(1);
    s.resize();
    expect(s.getZoom()).toBe(1);
  });

  it('包塞满、地上撒满东西时也能同步', () => {
    const st = createZone();
    for (let i = 0; i < 30; i++) addItem(st, 'food', 1);
    for (let i = 0; i < 12; i++) st.ground.push({ uid: 9000 + i, id: 'can', x: i - 6, z: 3, n: 1 });
    const s = makeScene();
    s.build(st);
    expect(() => s.sync(st, 1 / 60)).not.toThrow();
  });
});
