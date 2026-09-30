/**
 * buildkit.ts —— 建景工具箱（调色板 / 基础几何 / 程序化材质 / 通用角色与车辆）
 *
 * 从 world.ts 抽出（YZ-06 的第一步）：world.ts 负责场景装配、物理与相机，
 * 各场景的"美术素材"全部在这里按程序生成——低多边形几何 + Canvas 纹理，无任何远端资源。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;

// ---------------------------------------------------------------- 调色板（湿润灰绿 / 褪色白墙 / 锈红 / 暖黄）
export const C = {
  ground: 0x57604f,
  groundDark: 0x454c3f,
  concrete: 0x8b9187,
  concreteDark: 0x6f7469,
  wallFade: 0xc9c5b8,
  wallGrey: 0x9aa096,
  rust: 0x9a4f2f,
  rustDark: 0x6f3a24,
  roofGrey: 0x7d8387,
  metal: 0x8f979e,
  metalDark: 0x5b646c,
  wood: 0x8b6f4e,
  green: 0x6f8a5a,
  amber: 0xd9a05b,
  truckBody: 0x7a8a94,
  truckCab: 0x5b6a74,
  cloth: 0xbdb6a8,
  sheet: 0xd8d4c8,
  dog: 0x8d8a84
};
export const PALLET = 0x9a7f58;

export const PLAYER_R = 0.45;
export const WALK_SPEED = 3.3;
export const RUN_SPEED = 5.2;

// ---------------------------------------------------------------- 材质与几何帮手（共享几何/材质）

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
export const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const unitSph = new THREE.SphereGeometry(0.5, 12, 10);

export function mat(color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material | number,
             x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox, typeof m === 'number' ? mat(m) : m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = h > 0.5;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function cyl(parent: THREE.Object3D, r: number, h: number, m: THREE.Material | number,
             x = 0, y = 0, z = 0, opts: { rx?: number; rz?: number } = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(unitCyl, typeof m === 'number' ? mat(m) : m);
  mesh.scale.set(r * 2, h, r * 2);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function sph(parent: THREE.Object3D, r: number, m: THREE.Material | number,
             x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(unitSph, typeof m === 'number' ? mat(m) : m);
  mesh.scale.setScalar(r * 2);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Canvas 生成材质 */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

export function plane(parent: THREE.Object3D, w: number, h: number, m: THREE.Material,
               x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function textBoard(parent: THREE.Object3D, w: number, h: number, tex: THREE.CanvasTexture,
                   x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.MeshLambertMaterial({ map: tex });
  return plane(parent, w, h, m, x, y, z, ry);
}

/** 地面纹理：湿色斑块 */
export function groundTexture(base: string, patch: string, blotches: number): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < blotches; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 12 + Math.random() * 44;
      g.fillStyle = patch;
      g.globalAlpha = 0.06 + Math.random() * 0.16;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 假环境光阴影贴片（径向渐变，无光照成本） */
let aoTexture: THREE.CanvasTexture | null = null;
export function getAOTexture(): THREE.CanvasTexture {
  if (!aoTexture) {
    aoTexture = canvasTexture(128, 128, (g) => {
      const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    });
  }
  return aoTexture;
}

export function aoPatch(parent: THREE.Object3D, w: number, d: number, x: number, z: number, opacity = 0.5): void {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: getAOTexture(), transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.021, z);
  parent.add(m);
}

/** 同材质静态盒体合并：一次绘制代替多次（散件、托盘、货架等） */
export function mergeColoredBoxes(
  parent: THREE.Object3D,
  items: { w: number; h: number; d: number; c: number; x: number; y: number; z: number; ry?: number }[]
): void {
  const buckets = new Map<number, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new V(0, 1, 0);
  for (const it of items) {
    const g = unitBox.clone();
    q.setFromAxisAngle(up, it.ry ?? 0);
    m4.compose(new V(it.x, it.y, it.z), q, new V(it.w, it.h, it.d));
    g.applyMatrix4(m4);
    if (!buckets.has(it.c)) buckets.set(it.c, []);
    buckets.get(it.c)!.push(g);
  }
  for (const [c, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat(c));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    for (const g of geos) g.dispose();
  }
}

// ---------------------------------------------------------------- 人物

export interface PersonOpt { coat: number; pants?: number; skin?: number; cap?: number; vest?: number; scale?: number }

/** 原创积木人仔比例：方躯干、独立四肢、圆柱头与顶粒，全部由基础几何生成。 */
export function makePerson(o: PersonOpt): THREE.Group {
  const g = new THREE.Group();
  const s = o.scale ?? 1;
  const pants = o.pants ?? 0x4a4d50;
  const skin = o.skin ?? 0xd8b89a;

  // 双腿以髋为轴，脚块略向前，移动时能清楚读出交替步态。
  const mkLeg = (side: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.105 * s, 0.51 * s, 0);
    box(leg, 0.18 * s, 0.43 * s, 0.2 * s, pants, 0, -0.215 * s, 0);
    box(leg, 0.19 * s, 0.1 * s, 0.29 * s, pants, 0, -0.42 * s, 0.045 * s);
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // 方形躯干与肩臂给远景剪影一个明确的“积木人仔”轮廓。
  box(g, 0.43 * s, 0.52 * s, 0.3 * s, o.coat, 0, 0.79 * s, 0);
  const mkArm = (side: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.28 * s, 0.98 * s, 0);
    box(arm, 0.13 * s, 0.39 * s, 0.16 * s, o.coat, 0, -0.195 * s, 0);
    cyl(arm, 0.065 * s, 0.11 * s, skin, 0, -0.43 * s, 0);
    g.add(arm);
    return arm;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // 圆柱头（含顶粒/帽）成组，保留点头与跑动视线补偿。
  const head = new THREE.Group();
  head.position.set(0, 1.25 * s, 0);
  cyl(head, 0.155 * s, 0.25 * s, skin);
  if (o.cap) {
    cyl(head, 0.17 * s, 0.07 * s, o.cap, 0, 0.15 * s, 0);
    box(head, 0.2 * s, 0.035 * s, 0.16 * s, o.cap, 0, 0.12 * s, 0.14 * s);
  } else {
    cyl(head, 0.075 * s, 0.045 * s, skin, 0, 0.145 * s, 0);
  }
  g.add(head);

  if (o.vest) {
    const v = box(g, 0.45 * s, 0.43 * s, 0.32 * s, mat(o.vest), 0, 0.8 * s, 0);
    v.castShadow = false;
  }
  g.userData.legL = legL;
  g.userData.legR = legR;
  g.userData.armL = armL;
  g.userData.armR = armR;
  g.userData.head = head;
  return g;
}

/** 简易车 */
export function makeTruck(): THREE.Group {
  const g = new THREE.Group();
  box(g, 4.6, 1.9, 2.2, C.truckBody, -1.0, 1.55, 0);
  box(g, 1.7, 1.5, 2.1, C.truckCab, 2.4, 1.3, 0);
  box(g, 0.5, 0.5, 2.24, C.metalDark, -3.5, 0.85, 0); // 尾板
  const wheelM = mat(0x2a2d2e);
  const hub = mat(0x777d80);
  for (const wx of [-2.4, -1.2, 2.4]) {
    const w1 = cyl(g, 0.42, 0.3, wheelM, wx, 0.42, -1.02, { rx: Math.PI / 2 });
    const w2 = cyl(g, 0.42, 0.3, wheelM, wx, 0.42, 1.02, { rx: Math.PI / 2 });
    cyl(g, 0.16, 0.32, hub, wx, 0.42, -1.03, { rx: Math.PI / 2 });
    cyl(g, 0.16, 0.32, hub, wx, 0.42, 1.03, { rx: Math.PI / 2 });
    w2.castShadow = w1.castShadow = false;
  }
  return g;
}

export function makeVan(): THREE.Group {
  const g = new THREE.Group();
  box(g, 4.2, 1.7, 1.9, 0xe6e8e4, 0, 1.35, 0);
  box(g, 1.1, 1.25, 1.86, 0xd2d5d0, 2.2, 1.1, 0);
  box(g, 4.24, 0.34, 1.92, 0xc0503f, 0, 1.05, 0);
  const lampMat = mat(0xd0503f, { emissive: 0xd0503f, emissiveIntensity: 0.7 });
  box(g, 0.5, 0.16, 0.3, lampMat, 0.4, 2.32, -0.4);
  box(g, 0.5, 0.16, 0.3, mat(0x3f6fd0, { emissive: 0x3f6fd0, emissiveIntensity: 0.7 }), 0.4, 2.32, 0.4);
  const wheelM = mat(0x2a2d2e);
  for (const wx of [-1.5, 1.6]) {
    cyl(g, 0.36, 0.26, wheelM, wx, 0.36, -0.92, { rx: Math.PI / 2 });
    cyl(g, 0.36, 0.26, wheelM, wx, 0.36, 0.92, { rx: Math.PI / 2 });
  }
  return g;
}

export function makeDog(): THREE.Group {
  const g = new THREE.Group();
  const body = box(g, 0.62, 0.3, 0.26, C.dog, 0, 0.36, 0);
  body.castShadow = false;
  box(g, 0.22, 0.2, 0.2, C.dog, 0.36, 0.5, 0);
  box(g, 0.1, 0.09, 0.12, 0x7d7a74, 0.5, 0.46, 0); // 吻部
  const tail = box(g, 0.26, 0.05, 0.05, C.dog, -0.4, 0.46, 0);
  tail.geometry = unitBox;
  tail.name = 'tail';
  for (const lx of [-0.2, 0.2]) {
    box(g, 0.06, 0.24, 0.06, 0x7d7a74, lx, 0.12, -0.07);
    box(g, 0.06, 0.24, 0.06, 0x7d7a74, lx, 0.12, 0.09);
  }
  g.userData.tail = tail;
  return g;
}


// ---------------------------------------------------------------- 通用建景零件（各场景共用）

/** 浮尘粒子：返回 Points，由调用方登记进动画列表 */
export function makeDust(count: number, r: { x: [number, number]; y: [number, number]; z: [number, number] }): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = r.x[0] + Math.random() * (r.x[1] - r.x[0]);
    pos[i * 3 + 1] = r.y[0] + Math.random() * (r.y[1] - r.y[0]);
    pos[i * 3 + 2] = r.z[0] + Math.random() * (r.z[1] - r.z[0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xd8d4c4, size: 0.06, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true
  }));
}

/** 褪色内墙材质（渗痕 + 踢脚线） */
export function fadedWallMat(tint = '#c9c5b8'): THREE.MeshLambertMaterial {
  const tex = canvasTexture(256, 256, (c) => {
    c.fillStyle = tint; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(130,120,100,0.10)';
      c.fillRect(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 60, 4 + Math.random() * 30);
    }
    c.fillStyle = 'rgba(110,90,70,0.20)';
    c.fillRect(0, 240, 256, 16);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: tex });
}

/** 旧砖墙材质（外立面） */
export function brickMat(base = '#8d7f74', line = '#6d6158'): THREE.MeshLambertMaterial {
  const tex = canvasTexture(256, 256, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = line; c.lineWidth = 2;
    for (let row = 0; row < 16; row++) {
      const y = row * 16;
      c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke();
      const off = row % 2 ? 16 : 0;
      for (let i = 0; i < 8; i++) {
        const x = off + i * 32;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 16); c.stroke();
      }
    }
    for (let i = 0; i < 26; i++) {
      c.fillStyle = 'rgba(60,54,48,0.10)';
      c.fillRect(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 6 + Math.random() * 22);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: tex });
}

/** 纸质告示 / 名单 / 表格贴图（手写感：横线 + 深浅不一的字块） */
export function paperTexture(title: string, rows = 6, bg = '#e6e2d4'): THREE.CanvasTexture {
  return canvasTexture(256, 320, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 256, 320);
    c.fillStyle = '#3c3a33';
    c.font = 'bold 22px "Noto Sans CJK SC", sans-serif';
    c.textAlign = 'center';
    c.fillText(title, 128, 40);
    c.strokeStyle = 'rgba(70,66,58,0.35)';
    for (let i = 0; i < rows; i++) {
      const y = 70 + i * ((240) / rows);
      c.beginPath(); c.moveTo(20, y); c.lineTo(236, y); c.stroke();
      c.fillStyle = `rgba(60,58,50,${0.35 + (i % 3) * 0.15})`;
      c.fillRect(28, y - 14, 60 + ((i * 37) % 110), 9);
      c.fillRect(190, y - 14, 30, 9);
    }
  });
}

/** 小牌子（门牌 / 路牌 / 编号牌）：深底白字 */
export function signTexture(text: string, w = 256, h = 96, bg = '#2f3532', fg = '#e2ded0'): THREE.CanvasTexture {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 3;
    c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = fg;
    c.font = `bold ${Math.round(h * 0.42)}px "Noto Sans CJK SC", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2);
  });
}

/** 一段带窗的旧楼立面（远景背板，不投影） */
export function facade(parent: THREE.Object3D, w: number, h: number, d: number,
                       x: number, z: number, opts: { floors?: number; cols?: number; tint?: number } = {}): void {
  const body = box(parent, w, h, d, brickMat(), x, h / 2, z);
  body.castShadow = false;
  const floors = opts.floors ?? Math.max(2, Math.round(h / 3));
  const cols = opts.cols ?? Math.max(2, Math.round(w / 2.6));
  const winM = mat(opts.tint ?? 0x39414a);
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < cols; i++) {
      const wx = x - w / 2 + (i + 0.5) * (w / cols);
      const wy = 1.4 + f * (h - 1.8) / floors;
      const win = box(parent, w / cols * 0.42, 0.9, 0.08, winM, wx, wy, z + d / 2 + 0.02);
      win.castShadow = false;
      const sill = box(parent, w / cols * 0.5, 0.08, 0.14, C.concrete, wx, wy - 0.5, z + d / 2 + 0.04);
      sill.castShadow = false;
    }
  }
}

/** 室内房间外壳：地面 + 四面墙（可留门洞）+ 压低的天花 */
export function roomShell(
  parent: THREE.Object3D,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  opts: { doorX?: number; doorW?: number; wallTint?: string; floor?: [string, string]; height?: number } = {}
): void {
  const h = opts.height ?? 2.9;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const [f1, f2] = opts.floor ?? ['#7b756a', '#5f5a51'];
  const gt = groundTexture(f1, f2, 40);
  gt.repeat.set(Math.max(2, Math.round(w / 3)), Math.max(2, Math.round(d / 3)));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: gt }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.01, cz);
  floor.receiveShadow = true;
  parent.add(floor);

  const wm = fadedWallMat(opts.wallTint);
  box(parent, w + 0.6, h, 0.3, wm, cx, h / 2, b.minZ - 0.15);
  box(parent, 0.3, h, d + 0.6, wm, b.minX - 0.15, h / 2, cz);
  box(parent, 0.3, h, d + 0.6, wm, b.maxX + 0.15, h / 2, cz);
  // 南墙留门洞
  const dw = opts.doorW ?? 1.6;
  const dx = opts.doorX ?? cx;
  const leftW = (dx - dw / 2) - b.minX;
  const rightW = b.maxX - (dx + dw / 2);
  if (leftW > 0.2) box(parent, leftW, h, 0.3, wm, b.minX + leftW / 2, h / 2, b.maxZ + 0.15);
  if (rightW > 0.2) box(parent, rightW, h, 0.3, wm, b.maxX - rightW / 2, h / 2, b.maxZ + 0.15);
  box(parent, dw + 0.2, h - 2.1, 0.3, wm, dx, h - (h - 2.1) / 2, b.maxZ + 0.15); // 门楣

  const ceil = box(parent, w + 0.6, 0.22, d + 0.6, mat(0x585c55), cx, h + 0.11, cz);
  ceil.castShadow = false;
  ceil.receiveShadow = false;
}

/** 顶灯（发光面片 + 点光源）：返回给调用方登记进昼夜列表 */
export function ceilingLamp(parent: THREE.Object3D, x: number, y: number, z: number):
  { glow: THREE.Mesh; light: THREE.PointLight } {
  const glow = box(parent, 1.4, 0.09, 0.28, mat(0xe6e2d2, { emissive: 0xe6e2d2, emissiveIntensity: 0.8 }), x, y, z);
  glow.castShadow = false;
  const light = new THREE.PointLight(0xf0ead8, 0, 9, 2);
  light.position.set(x, y - 0.2, z);
  parent.add(light);
  return { glow, light };
}
