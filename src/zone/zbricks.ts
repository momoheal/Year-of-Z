/**
 * zbricks.ts —— 域外探索的乐高零件库
 *
 * 规格见 doc/33 第 2 节：
 *   物品 = 一块积木（占格 w×h = 凸点数，形状 = 板/砖/杆/光面板/瓶）
 *   任务 = 一块挂牌（颜色编码类别，凸点数编码分量）
 *   系统 = 看得见的积木（噪音涟漪是薄板围成的环，光是地面暖色底板）
 *
 * 全部由 buildkit 的基础几何现搭，无远端资源。
 */

import * as THREE from 'three';
import {
  C, aoPatch, brickMat, canvasTexture, cyl, fadedWallMat, makePerson, mat, signTexture, sph, unitBox
} from '../buildkit';
import { ITEMS, type ItemDef, type ZKind } from './zdata';

// ---------------------------------------------------------------- 基础积木

/** 顶凸点：一块积木之所以是积木 */
export function studs(parent: THREE.Object3D, w: number, d: number, h: number, color: number, nx = 1, nz = 1): void {
  const r = Math.min(w / nx, d / nz) * 0.26;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -w / 2 + (i + 0.5) * (w / nx);
      const z = -d / 2 + (j + 0.5) * (d / nz);
      cyl(parent, r, 0.07, color, x, h / 2 + 0.035, z);
    }
  }
}

/** 一块带凸点的标准砖 */
export function brick(parent: THREE.Object3D, w: number, h: number, d: number, color: number,
                      x = 0, y = 0, z = 0, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  const body = new THREE.Mesh(unitBox, mat(color));
  body.scale.set(w, h, d);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  studs(g, w, d, h, color, Math.max(1, Math.round(w / 0.34)), Math.max(1, Math.round(d / 0.34)));
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- 物品 = 一块积木

const CELL = 0.32; // 背包一格在场景里的边长

const THICK: Record<ItemDef['shape'], number> = { plate: 0.1, brick: 0.22, rod: 0.14, tile: 0.055, bottle: 0.12 };

/** 单个物品的世界表现：占格即尺寸，凸点数即格数 */
export function brickItem(id: string): THREE.Group {
  const d = ITEMS[id];
  const g = new THREE.Group();
  if (!d) return g;
  const w = d.w * CELL;
  const dd = d.h * CELL; // 背包里的"高"在场景里是进深
  const th = THICK[d.shape];

  if (d.shape === 'rod') {
    // 撬棍 / 钢管 / 消防斧：一根长条 + 工作端
    const bar = new THREE.Mesh(unitBox, mat(d.color));
    bar.scale.set(Math.min(w, 0.16), th, dd);
    bar.castShadow = true;
    g.add(bar);
    const tip = new THREE.Mesh(unitBox, mat(d.color));
    tip.scale.set(0.2, th * 1.1, 0.22);
    tip.position.set(0.07, 0, -dd / 2 + 0.1);
    tip.rotation.y = 0.5;
    g.add(tip);
    if (id === 'axe') {
      const blade = new THREE.Mesh(unitBox, mat(0xd9d4c6));
      blade.scale.set(0.5, 0.05, 0.3);
      blade.position.set(0.18, 0.04, -dd / 2 + 0.22);
      g.add(blade);
    }
    g.position.y = th / 2;
    return g;
  }

  const body = new THREE.Mesh(unitBox, mat(d.color));
  body.scale.set(w, th, dd);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  if (d.shape === 'bottle') {
    const neck = cyl(g, Math.min(w, dd) * 0.26, 0.16, 0xf0ece0, 0, th / 2 + 0.08, 0);
    neck.castShadow = false;
  }
  if (d.shape === 'plate' || d.shape === 'brick') studs(g, w, dd, th, d.color, d.w, d.h);
  g.position.y = th / 2;
  return g;
}

/** 地上的一小堆（同 id 多件时叠几块） */
export function brickPile(id: string, n: number): THREE.Group {
  const g = new THREE.Group();
  const k = Math.min(3, Math.max(1, n));
  for (let i = 0; i < k; i++) {
    const one = brickItem(id);
    one.position.set((i % 2) * 0.16 - 0.08, 0.02 + i * 0.13, Math.floor(i / 2) * 0.14 - 0.07);
    one.rotation.y = i * 0.7;
    g.add(one);
  }
  return g;
}

// ---------------------------------------------------------------- 任务 = 一块挂牌

/** 挂牌：底板 + N 个凸点。颜色编码类别，凸点数编码分量 */
export function tagMesh(color: number, studsN: number): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(unitBox, mat(color));
  plate.scale.set(0.3, 0.07, 0.42);
  plate.castShadow = true;
  g.add(plate);
  for (let i = 0; i < studsN; i++) {
    cyl(g, 0.055, 0.06, 0xf0ece0, (i - (studsN - 1) / 2) * 0.13, 0.065, -0.06);
  }
  cyl(g, 0.03, 0.1, 0x8f979e, 0, 0.13, -0.28); // 挂钉
  return g;
}

/** 委托板：一块竖着的底板，挂牌钉在上面 */
export function contractBoard(): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(unitBox, fadedWallMat('#8a7f68'));
  board.scale.set(2.6, 1.7, 0.14);
  board.position.y = 1.5;
  board.castShadow = true; board.receiveShadow = true;
  g.add(board);
  for (const sx of [-1.35, 1.35]) {
    const post = new THREE.Mesh(unitBox, mat(C.wood));
    post.scale.set(0.16, 2.2, 0.16);
    post.position.set(sx, 1.1, 0);
    post.castShadow = true;
    g.add(post);
  }
  const tex = signTexture('委 托', 256, 96, '#2f3532', '#e2ded0');
  const head = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.64), new THREE.MeshLambertMaterial({ map: tex }));
  head.position.set(0, 2.05, 0.09);
  g.add(head);
  return g;
}

// ---------------------------------------------------------------- 系统 = 看得见的积木

/** 噪音涟漪：一圈薄板，随半径长开、变淡 */
export class BrickRing {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  constructor(private n = 30) {
    const m = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(unitBox, m, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = n;
  }
  /** r = 当前半径；fade = 0..1 寿命 */
  update(r: number, fade: number, color: number): void {
    const m = this.mesh.material as THREE.MeshLambertMaterial;
    m.color.setHex(color);
    m.opacity = 0.75 * fade;
    const circ = 2 * Math.PI * r;
    const len = Math.min(0.62, (circ / this.n) * 0.78);
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2;
      this.dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.dummy.rotation.set(0, -a, 0);
      this.dummy.scale.set(len, 0.07, 0.19);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export const NOISE_COLOR = [0x000000, 0x9fb0a4, 0xd3c98a, 0xd9a05b, 0xc97363, 0xff5a4a];

/** 地面暖色光斑（灯下安全岛的可视化） */
let poolTex: THREE.Texture | null = null;
function getPoolTexture(): THREE.Texture {
  if (!poolTex) {
    poolTex = canvasTexture(128, 128, (c) => {
      const grad = c.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255, 214, 150, 0.85)');
      grad.addColorStop(0.55, 'rgba(255, 198, 120, 0.32)');
      grad.addColorStop(1, 'rgba(255, 190, 110, 0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 128, 128);
    });
  }
  return poolTex;
}

export function lightPool(parent: THREE.Object3D, r: number, x: number, z: number, tint = 0xffd296): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2, r * 2),
    new THREE.MeshBasicMaterial({
      map: getPoolTexture(), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, color: tint
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  m.renderOrder = 2;
  parent.add(m);
  return m;
}

/**
 * 地面扇形光锥（手电 / 探照灯），俯视角读得清。
 * 返回的是枢轴 Group：用 setFanAngle(pivot, face) 指向朝向，避免欧拉顺序踩坑。
 */
export function coneFan(parent: THREE.Object3D, range: number, halfAngle: number, color = 0xfff0c0): THREE.Group {
  const pivot = new THREE.Group();
  const g = new THREE.CircleGeometry(range, 26, -halfAngle, halfAngle * 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  pivot.add(m);
  pivot.userData.fan = m;
  parent.add(pivot);
  return pivot;
}

/** 把光锥枢轴指向 face（face = atan2(dx, dz)） */
export function setFanAngle(pivot: THREE.Object3D, face: number): void {
  pivot.rotation.y = face - Math.PI / 2;
}

/** 地点标记圈（家 / 撤离点 / 掉下的包） */
export function markRing(parent: THREE.Object3D, r: number, x: number, z: number, color = 0x93b48c): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.16, r, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.05, z);
  m.renderOrder = 4;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- 路灯与火

export function lampPost(color = 0xffe0a8): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(unitBox, mat(C.metalDark));
  pole.scale.set(0.18, 5.4, 0.18);
  pole.position.y = 2.7;
  pole.castShadow = true;
  g.add(pole);
  const arm = new THREE.Mesh(unitBox, mat(C.metalDark));
  arm.scale.set(0.9, 0.14, 0.14);
  arm.position.set(0.45, 5.3, 0);
  g.add(arm);
  const head = new THREE.Mesh(unitBox, mat(color, { emissive: color, emissiveIntensity: 1.1 }));
  head.scale.set(0.5, 0.16, 0.34);
  head.position.set(0.88, 5.16, 0);
  g.add(head);
  return g;
}

export function campFire(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = brick(g, 0.34, 0.18, 0.24, 0x8b9187, Math.cos(a) * 0.62, 0.09, Math.sin(a) * 0.62, -a);
    s.rotation.z = 0.1;
  }
  const flame = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(unitBox, mat(i === 0 ? 0xffb066 : i === 1 ? 0xff8a3a : 0xffe08a, {
      emissive: i === 0 ? 0xffb066 : i === 1 ? 0xff8a3a : 0xffe08a, emissiveIntensity: 1.2
    }));
    f.scale.set(0.42 - i * 0.09, 0.5 - i * 0.1, 0.42 - i * 0.09);
    f.position.set(0, 0.3 + i * 0.26, 0);
    f.rotation.y = i * 0.6;
    flame.add(f);
  }
  flame.name = 'flame';
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

// ---------------------------------------------------------------- 容器（货架 / 货箱 / 柜台 / 尸体 / 铁柜 / 工作台）

export function shelfMesh(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(C.wood);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(unitBox, m);
    s.scale.set(2.2, 0.1, 0.7);
    s.position.y = 0.35 + i * 0.62;
    s.castShadow = true; s.receiveShadow = true;
    g.add(s);
  }
  for (const sx of [-1.05, 1.05]) {
    const p = new THREE.Mesh(unitBox, mat(0x8f979e));
    p.scale.set(0.1, 1.9, 0.7);
    p.position.set(sx, 0.95, 0);
    p.castShadow = true;
    g.add(p);
  }
  // 货架上零星摆几块积木
  for (let i = 0; i < 5; i++) {
    const c = [0xd08a4a, 0xb0b6b0, 0xd9a05b, 0xe8e4d6, 0x93b48c][i];
    const b = new THREE.Mesh(unitBox, mat(c));
    b.scale.set(0.3, 0.24, 0.26);
    b.position.set(-0.8 + i * 0.4, 0.4 + (i % 3) * 0.62, 0);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

export function crateMesh(color = 0x9a7f58): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(unitBox, mat(color));
  b.scale.set(1.5, 1.1, 1.1);
  b.position.y = 0.55;
  b.castShadow = true; b.receiveShadow = true;
  g.add(b);
  const lid = new THREE.Mesh(unitBox, mat(0x7d6a4a));
  lid.scale.set(1.56, 0.1, 1.16);
  lid.position.y = 1.14;
  g.add(lid);
  return g;
}

export function counterMesh(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(unitBox, mat(0xb0a894));
  top.scale.set(2.6, 0.16, 1.0);
  top.position.y = 0.95;
  top.castShadow = true;
  g.add(top);
  const body = new THREE.Mesh(unitBox, mat(0x8b9187));
  body.scale.set(2.4, 0.9, 0.9);
  body.position.y = 0.45;
  g.add(body);
  return g;
}

/** 伏尸：趴着的积木人仔（钥匙就挂在他身上） */
export function bodyMesh(): THREE.Group {
  const g = makePerson({ coat: 0x6d6a5e, pants: 0x4a4d50, skin: 0xa9a08c, scale: 0.98 });
  g.rotation.x = -Math.PI / 2.15;
  g.rotation.z = 0.4;
  g.position.y = 0.34;
  return g;
}

export function cageMesh(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(unitBox, mat(0x5b646c));
  frame.scale.set(1.9, 2.2, 0.7);
  frame.position.y = 1.1;
  frame.castShadow = true;
  g.add(frame);
  for (let i = 0; i < 6; i++) {
    const bar = new THREE.Mesh(unitBox, mat(0x8f979e));
    bar.scale.set(0.07, 2.0, 0.08);
    bar.position.set(-0.75 + i * 0.3, 1.1, 0.37);
    g.add(bar);
  }
  return g;
}

export function benchMesh(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(unitBox, mat(0x8b6f4e));
  top.scale.set(2.4, 0.16, 1.1);
  top.position.y = 0.92;
  top.castShadow = true;
  g.add(top);
  for (const sx of [-1.05, 1.05]) for (const sz of [-0.45, 0.45]) {
    const leg = new THREE.Mesh(unitBox, mat(0x6f5a3e));
    leg.scale.set(0.14, 0.9, 0.14);
    leg.position.set(sx, 0.45, sz);
    g.add(leg);
  }
  // 台面上的零件
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(unitBox, mat([0x8f979e, 0xd9a05b, 0x9a4f2f, 0xb0b6b0][i]));
    p.scale.set(0.26, 0.14, 0.26);
    p.position.set(-0.8 + i * 0.55, 1.07, (i % 2) * 0.3 - 0.15);
    g.add(p);
  }
  return g;
}

export function deskMesh(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(unitBox, mat(0x9a8f76));
  top.scale.set(1.8, 0.14, 0.9);
  top.position.y = 0.8;
  top.castShadow = true;
  g.add(top);
  for (const sx of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(unitBox, mat(0x7d7360));
    leg.scale.set(0.12, 0.8, 0.12);
    leg.position.set(sx, 0.4, 0);
    g.add(leg);
  }
  return g;
}

export function bedMesh(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(unitBox, mat(0x6f7469));
  frame.scale.set(2.2, 0.3, 1.0);
  frame.position.y = 0.35;
  frame.castShadow = true;
  g.add(frame);
  const quilt = new THREE.Mesh(unitBox, mat(0x7d8d7a));
  quilt.scale.set(1.9, 0.18, 0.9);
  quilt.position.y = 0.56;
  g.add(quilt);
  const pillow = new THREE.Mesh(unitBox, mat(0xd8d4c8));
  pillow.scale.set(0.6, 0.16, 0.7);
  pillow.position.set(-0.7, 0.6, 0);
  g.add(pillow);
  return g;
}

/** 门（会开合的一块板） */
export function doorPanel(w: number, h: number, locked: boolean): THREE.Group {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(unitBox, mat(locked ? 0x8b6f4e : 0x7d8387));
  panel.scale.set(w, h, 0.18);
  panel.position.y = h / 2;
  panel.castShadow = true; panel.receiveShadow = true;
  g.add(panel);
  if (locked) {
    const lock = new THREE.Mesh(unitBox, mat(0xc9b273, { emissive: 0x3a3220, emissiveIntensity: 0.4 }));
    lock.scale.set(0.22, 0.26, 0.1);
    lock.position.set(0, h * 0.5, 0.13);
    g.add(lock);
  }
  return g;
}

// ---------------------------------------------------------------- 人仔

export const PLAYER_LOOK = { coat: 0x8a7f6a, pants: 0x3f4448, skin: 0xd8b89a, cap: 0x5d6a5f };

export function playerMesh(): THREE.Group {
  return makePerson({ ...PLAYER_LOOK });
}

const Z_LOOK: Record<ZKind, { coat: number; pants: number; skin: number; scale: number }> = {
  shambler: { coat: 0x6f7d5e, pants: 0x4a4d50, skin: 0xb9b09a, scale: 1 },
  runner: { coat: 0x9a5230, pants: 0x51423a, skin: 0xc0a892, scale: 0.96 },
  croucher: { coat: 0x5f6f76, pants: 0x40474a, skin: 0xaeb0a2, scale: 0.94 },
  lurker: { coat: 0x7a5f6a, pants: 0x46403f, skin: 0xb2a08c, scale: 0.92 },
  screamer: { coat: 0xcfc08a, pants: 0x6f6a52, skin: 0xc8bda0, scale: 1.02 },
  brute: { coat: 0x565349, pants: 0x3a3833, skin: 0x9a9482, scale: 1.62 },
  phantom: { coat: 0x8fa0c4, pants: 0x6d7a99, skin: 0xc3cada, scale: 1 }
};

export function zombieMesh(kind: ZKind): THREE.Group {
  const look = Z_LOOK[kind];
  const g = makePerson({ coat: look.coat, pants: look.pants, skin: look.skin, scale: look.scale });
  switch (kind) {
    case 'runner':
      g.userData.lean = 0.2;
      break;
    case 'croucher':
      g.userData.crouch = 0.62;
      break;
    case 'lurker':
      g.userData.prone = true;
      break;
    case 'screamer': {
      const mouth = new THREE.Mesh(unitBox, mat(0x3a2018));
      mouth.scale.set(0.13, 0.13, 0.06);
      mouth.position.set(0, 1.32 * look.scale, 0.14);
      g.add(mouth);
      break;
    }
    case 'brute': {
      // 加宽的肩与更粗的手臂，一眼看出"不是能打的东西"
      const shoulder = new THREE.Mesh(unitBox, mat(0x4a473f));
      shoulder.scale.set(1.0, 0.26, 0.42);
      shoulder.position.set(0, 1.22, 0);
      shoulder.castShadow = true;
      g.add(shoulder);
      break;
    }
    case 'phantom':
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const m = mesh.material as THREE.MeshLambertMaterial;
          m.transparent = true; m.opacity = 0.34; m.depthWrite = false;
        }
      });
      break;
    default:
      break;
  }
  return g;
}

export function militiaMesh(withLight: boolean): THREE.Group {
  const g = makePerson({ coat: 0x2f3a44, pants: 0x232b31, skin: 0xd8b89a, cap: 0x1d252c, vest: 0x3f4a52 });
  const baton = new THREE.Mesh(unitBox, mat(0x1d252c));
  baton.scale.set(0.09, 0.5, 0.09);
  baton.position.set(0.3, 0.85, 0.1);
  g.add(baton);
  if (withLight) {
    const torch = new THREE.Mesh(unitBox, mat(0xfff0cc, { emissive: 0xfff0cc, emissiveIntensity: 1.2 }));
    torch.scale.set(0.2, 0.2, 0.28);
    torch.position.set(-0.32, 0.9, 0.18);
    g.add(torch);
    g.userData.torch = torch;
  }
  return g;
}

// ---------------------------------------------------------------- 小零件

export function nuclecShed(): THREE.Group {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(unitBox, mat(0xb0a894));
  roof.scale.set(4.6, 0.16, 3.2);
  roof.position.y = 3.0;
  roof.castShadow = true;
  g.add(roof);
  for (const sx of [-2.1, 2.1]) for (const sz of [-1.4, 1.4]) {
    const p = new THREE.Mesh(unitBox, mat(0x8f979e));
    p.scale.set(0.16, 3.0, 0.16);
    p.position.set(sx, 1.5, sz);
    g.add(p);
  }
  const tex = signTexture('核 酸', 256, 96, '#2f3532', '#e2ded0');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.75), new THREE.MeshLambertMaterial({ map: tex }));
  sign.position.set(0, 2.4, 1.62);
  g.add(sign);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.75), new THREE.MeshLambertMaterial({ map: tex }));
  back.position.set(0, 2.4, -1.62);
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}

/** 井盖：只回声，不撒谎，不推任务 */
export function manhole(): THREE.Group {
  const g = new THREE.Group();
  const lid = cyl(g, 0.62, 0.08, 0x5b646c, 0, 0.04, 0);
  lid.receiveShadow = true;
  const chalk = canvasTexture(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(232,228,216,0.85)';
    c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(30, 82); c.lineTo(52, 40); c.lineTo(76, 88); c.stroke();
    c.beginPath(); c.moveTo(40, 64); c.lineTo(70, 64); c.stroke();
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: chalk, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.09;
  g.add(m);
  return g;
}

export function shopSign(text: string, w = 2.6): THREE.Mesh {
  const tex = signTexture(text, 256, 96);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), new THREE.MeshLambertMaterial({ map: tex }));
  return m;
}

export function debrisPile(seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(unitBox, mat([0x6b6a5c, 0x7d7360, 0x5b646c][i % 3]));
    b.scale.set(0.4 + rnd() * 0.5, 0.24 + rnd() * 0.3, 0.4 + rnd() * 0.4);
    b.position.set((rnd() - 0.5) * 3.4, 0.14 + rnd() * 0.2, (rnd() - 0.5) * 3.0);
    b.rotation.y = rnd() * 3;
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

/** 被困的人：坐在地上、背靠墙 */
export function trappedPerson(): THREE.Group {
  const g = makePerson({ coat: 0x8a7f68, pants: 0x4a4d50, skin: 0xd8b89a });
  g.rotation.x = -0.5;
  g.position.y = 0.1;
  return g;
}

export function tunnelMouth(): THREE.Group {
  const g = new THREE.Group();
  const arch = new THREE.Mesh(unitBox, mat(0x3f4549));
  arch.scale.set(0.5, 3.4, 5.2);
  arch.position.y = 1.7;
  g.add(arch);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x05070a }));
  hole.position.set(0.27, 1.3, 0);
  hole.rotation.y = Math.PI / 2;
  g.add(hole);
  return g;
}

export function tentMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(unitBox, mat(0x9a8f76));
  body.scale.set(3.5, 2.4, 3.0);
  body.position.y = 1.2;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(unitBox, mat(0x7d7360));
  roof.scale.set(3.8, 0.18, 3.3);
  roof.position.y = 2.45;
  g.add(roof);
  const door = new THREE.Mesh(unitBox, mat(0x3a352c));
  door.scale.set(1.2, 1.8, 0.08);
  door.position.set(0, 0.9, 1.55);
  g.add(door);
  return g;
}

/** 车棚 / 自行车棚 */
export function bikeShed(): THREE.Group {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(unitBox, mat(0x9aa096));
  roof.scale.set(4.2, 0.14, 3.2);
  roof.position.y = 2.6;
  roof.castShadow = true;
  g.add(roof);
  for (const sx of [-1.9, 1.9]) for (const sz of [-1.3, 1.3]) {
    const p = new THREE.Mesh(unitBox, mat(0x6f7469));
    p.scale.set(0.14, 2.6, 0.14);
    p.position.set(sx, 1.3, sz);
    g.add(p);
  }
  return g;
}

export { aoPatch, brickMat, sph };
