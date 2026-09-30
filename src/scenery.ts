/**
 * scenery.ts —— 第二—四章各场景的正式建景（不再是占位）
 *
 * 这些场景此前统一用"地面 + 边界墙 + 一块名牌"顶着。本文件按 doc/06—11 的描写
 * 把每一处都建成可辨认的地方：旧楼立面、铁网门、下穿道、临时食堂的发餐窗口、
 * 观察处的教室编号、家里的那把椅子、工坊里拆了一半的推车、维修点空着的第二个工位、
 * 网格员桌上的报表、铁路边码好的箱堆。
 *
 * 全部素材仍由程序生成（低多边形几何 + Canvas 纹理），**不引入任何图片/模型文件**，
 * 与"零远端资源、离线可玩"的约束一致。
 *
 * 约定：
 *   - 节点坐标（story 数据里的 target）不因建景变化，建景只围绕它布置；
 *   - 每个场景同时给出 BLOCKERS（静物阻挡矩形），由 world.ts 生成物理体，
 *     保证"看得见的东西挡得住"；
 *   - 需要参与昼夜的灯具通过 ctx 登记，world.ts 统一在光照切换时开关。
 */

import * as THREE from 'three';
import type { SceneId } from './story';
import { SCENE_BOUNDS, type WallRect } from './mapdata';
import {
  C, PALLET, mat, box, cyl, sph, canvasTexture, textBoard, groundTexture, aoPatch,
  makePerson, makeVan, makeDust, brickMat, fadedWallMat, facade, paperTexture, signTexture,
  roomShell, ceilingLamp
} from './buildkit';

export interface SceneryCtx {
  /** 需要随昼夜开关的发光面片 */
  lampGlow: THREE.Mesh[];
  /** 需要随昼夜开关的点光源 */
  lampLights: THREE.PointLight[];
  /** 浮尘粒子 */
  dusts: THREE.Points[];
}

function lamp(g: THREE.Group, ctx: SceneryCtx, x: number, y: number, z: number): void {
  const { glow, light } = ceilingLamp(g, x, y, z);
  ctx.lampGlow.push(glow);
  ctx.lampLights.push(light);
}

function dust(g: THREE.Group, ctx: SceneryCtx, count: number,
              r: { x: [number, number]; y: [number, number]; z: [number, number] }): void {
  const pts = makeDust(count, r);
  g.add(pts);
  ctx.dusts.push(pts);
}

/** 室外地面（带边缘压实的土色） */
function outdoorGround(g: THREE.Group, id: SceneId, base: string, patch: string): void {
  const b = SCENE_BOUNDS[id];
  const w = b.maxX - b.minX + 6;
  const d = b.maxZ - b.minZ + 6;
  const gt = groundTexture(base, patch, 90);
  gt.repeat.set(Math.max(3, Math.round(w / 5)), Math.max(3, Math.round(d / 5)));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  g.add(ground);
}

/** 水泥路面条带 */
function pavement(g: THREE.Group, w: number, d: number, x: number, z: number, color = C.concreteDark): void {
  const p = box(g, w, 0.06, d, mat(color), x, 0.03, z);
  p.castShadow = false;
}

/** 一辆板车 / 送餐推车 */
function makeCart(broken = false): THREE.Group {
  const c = new THREE.Group();
  box(c, 2.8, 0.16, 1.5, C.wood, 0, 0.36, 0);
  box(c, 2.4, 0.12, 0.12, C.metalDark, 0, 0.55, -0.66);
  box(c, 0.1, 0.5, 0.1, C.metalDark, 1.3, 0.62, -0.5);
  box(c, 0.1, 0.5, 0.1, C.metalDark, 1.3, 0.62, 0.5);
  box(c, 0.12, 0.08, 1.1, C.metalDark, 1.35, 0.86, 0);   // 把手
  cyl(c, 0.34, 0.14, C.metalDark, -0.9, 0.34, -0.72, { rx: Math.PI / 2 });
  if (!broken) cyl(c, 0.34, 0.14, C.metalDark, -0.9, 0.34, 0.72, { rx: Math.PI / 2 });
  else cyl(c, 0.34, 0.14, C.metalDark, -0.4, 0.14, 1.25, { rz: Math.PI / 2 }); // 卸下来躺在地上的那只
  return c;
}

/** 麻袋堆 */
function sacks(g: THREE.Group, n: number, x: number, z: number, ry = 0): void {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = ry;
  g.add(grp);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const s = box(grp, 0.62, 0.3, 0.44, mat(row % 2 ? 0xc2b89c : 0xb9ae92), -0.7 + col * 0.7, 0.16 + row * 0.31, row % 2 ? 0.08 : -0.06);
    s.rotation.y = (i % 3) * 0.1;
  }
  aoPatch(grp, 2.6, 1.6, 0, 0, 0.35);
}

// ================================================================ 第二章

function buildYard(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'yard', '#5f6a58', '#454e40');
  pavement(g, 9, 6, 0, 6.5);
  // 三面旧楼围出的院子
  facade(g, 14, 13, 5, -1, -6.5, { floors: 4, cols: 5 });
  facade(g, 6, 10, 5, 8.5, -3.5, { floors: 3, cols: 2 });
  // 单元门与门牌
  box(g, 1.5, 2.3, 0.2, mat(0x4d5a52), -3.4, 1.15, -3.9);
  textBoard(g, 1.1, 0.34, signTexture('三单元', 220, 70), -3.4, 2.6, -3.88);
  // 那辆要推去柳岸里的板车
  const cart = makeCart();
  cart.position.set(0, 0, 6);
  cart.rotation.y = 0.2;
  g.add(cart);
  aoPatch(g, 3.6, 2.4, 0, 6, 0.4);
  // 工具架与雨衣箱
  box(g, 1.2, 1.5, 0.6, C.metalDark, -4.5, 0.75, 6.5);
  for (let i = 0; i < 3; i++) box(g, 1.1, 0.06, 0.5, C.metal, -4.5, 0.45 + i * 0.45, 6.5);
  box(g, 0.9, 0.5, 0.7, mat(0x6d7a6a), 2.9, 0.25, 5.6);
  box(g, 0.92, 0.06, 0.72, C.cloth, 2.9, 0.53, 5.6);
  // 自行车棚与两辆车
  box(g, 5, 0.12, 2.2, mat(0x6f757a), 5.4, 2.2, 7.6);
  for (const px of [3.4, 7.2]) box(g, 0.12, 2.2, 0.12, C.metalDark, px, 1.1, 8.4);
  for (const bx of [4.2, 6.2]) {
    cyl(g, 0.3, 0.06, 0x2c2f30, bx, 0.3, 7.2, { rx: Math.PI / 2 });
    cyl(g, 0.3, 0.06, 0x2c2f30, bx, 0.3, 8.0, { rx: Math.PI / 2 });
    box(g, 0.08, 0.5, 0.06, mat(0x7b6a55), bx, 0.62, 7.6);
  }
  // 宣传栏：贴着配送通知
  box(g, 2.4, 1.5, 0.1, mat(0x4a5450), -6.2, 1.5, 2.2);
  textBoard(g, 2.1, 1.25, paperTexture('本周配送安排', 6), -6.2, 1.5, 2.16);
  // 水管与晾衣绳
  cyl(g, 0.07, 6, C.metalDark, 5.6, 3, -3.9);
  for (let i = 0; i < 4; i++) box(g, 0.5, 0.6, 0.02, mat(i % 2 ? 0xa9b0ae : 0xc4b9a6), -1 + i * 0.8, 1.6, 1.2);
  dust(g, ctx, 40, { x: [-7, 7], y: [0.4, 2.6], z: [-1, 13] });
}

function buildRoad(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'road', '#6a675c', '#4c493f');
  pavement(g, 22, 5.5, 6, 0);
  // 铁路下穿道：桥体 + 桥墩 + 限高牌
  box(g, 20, 3.6, 3.0, brickMat('#7d7469', '#5f584f'), 6, 2.4, -5.6).castShadow = false;
  box(g, 20, 0.6, 3.4, mat(0x6b6f6a), 6, 4.4, -5.6).castShadow = false;
  for (const px of [-1.5, 13]) box(g, 0.9, 4.2, 3.2, C.concreteDark, px, 2.1, -5.6);
  box(g, 3.2, 0.5, 0.12, mat(0xd4b84e), 6, 3.4, -4.0);
  textBoard(g, 2.6, 0.42, signTexture('限高 3.2 米', 260, 60, '#2b2f2c', '#e8e2cc'), 6, 3.4, -3.93);
  // 卡点：岗亭、隔离墩、横杆
  box(g, 1.8, 2.4, 1.8, mat(0x8e9490), 1.2, 1.2, 2.6);
  box(g, 1.9, 0.14, 1.9, mat(0x5d6360), 1.2, 2.5, 2.6);
  box(g, 1.1, 1.0, 0.1, mat(0xbfcac6, { emissive: 0xbfcac6, emissiveIntensity: 0.18 }), 1.2, 1.5, 1.72).castShadow = false;
  for (let i = 0; i < 5; i++) {
    const m = box(g, 0.4, 0.75, 0.4, mat(i % 2 ? 0xd05a3a : 0xe4e0d2), 3.2 + i * 1.2, 0.38, 1.6);
    m.rotation.y = (i % 2) * 0.2;
  }
  box(g, 4.4, 0.12, 0.12, mat(0xd8522f), 5.4, 1.05, 0.6);
  // 积水带（下穿道口）
  const water = box(g, 12, 0.03, 1.4, mat(0x53666a, { emissive: 0x2a3436, emissiveIntensity: 0.12 }), 6, 0.04, -2.9);
  water.castShadow = false;
  // 侧停的白色面包车
  const van = makeVan();
  van.position.set(10, 0, -1.6);
  van.rotation.y = 0.12;
  g.add(van);
  aoPatch(g, 5, 2.6, 10, -1.6, 0.4);
  // 站在卡点边的执勤人员
  const guard = makePerson({ coat: 0x4e5a63, pants: 0x3a4149, cap: 0x3f4a52, vest: 0xd8c14a });
  guard.position.set(2.6, 0, 1.9);
  guard.rotation.y = -1.2;
  g.add(guard);
  dust(g, ctx, 36, { x: [-3, 15], y: [0.3, 2.4], z: [-7, 5] });
}

function buildPump(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'pump', '#5a6468', '#40484c');
  // 碎石便道
  pavement(g, 4.5, 15, 1.5, 4, 0x77786f);
  // 泵站小屋与管道
  box(g, 4.0, 3.4, 3.4, brickMat('#87837a', '#65625b'), 7, 1.7, 6);
  box(g, 4.4, 0.3, 3.8, mat(0x6e7378), 7, 3.5, 6);
  box(g, 0.9, 1.9, 0.12, mat(0x55504a), 5.1, 0.95, 5.2);
  cyl(g, 0.5, 4.6, C.metalDark, 5.0, 2.3, 4.4);
  cyl(g, 0.22, 5.5, C.metal, 5.0, 3.6, 1.8, { rx: Math.PI / 2 });
  for (const vx of [4.6, 5.4]) cyl(g, 0.12, 0.5, C.rust, vx, 3.95, 1.0);
  // 沙袋墙
  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 5);
    box(g, 0.66, 0.26, 0.4, mat(row % 2 ? 0xb3a88c : 0xa79c82), -4.4 + (i % 5) * 0.7 + row * 0.3, 0.14 + row * 0.27, 8);
  }
  // 铁路围栏与轨道
  for (let i = 0; i < 9; i++) box(g, 0.08, 1.6, 0.08, C.metalDark, -7 + i * 2.2, 0.8, -1.2);
  box(g, 20, 0.06, 0.1, C.metalDark, 2, 1.5, -1.2).castShadow = false;
  box(g, 20, 0.1, 0.16, mat(0x6d6a60), 2, 0.06, -2.6).castShadow = false;
  box(g, 20, 0.1, 0.16, mat(0x6d6a60), 2, 0.06, -3.4).castShadow = false;
  for (let i = 0; i < 14; i++) box(g, 0.24, 0.08, 1.3, C.wood, -7 + i * 1.5, 0.04, -3.0).castShadow = false;
  // 便道尽头的杂草与积水
  for (let i = 0; i < 14; i++) {
    const s = sph(g, 0.14 + Math.random() * 0.12, mat(0x5f7250), -6 + Math.random() * 16, 0.08, 9 + Math.random() * 2.5);
    s.castShadow = false;
  }
  textBoard(g, 1.4, 0.4, signTexture('检修便道 禁止通行', 300, 72, '#3a3f38', '#e0dcc8'), 1.2, 1.5, -1.1);
  dust(g, ctx, 34, { x: [-7, 11], y: [0.3, 2.4], z: [-3, 11] });
}

function buildLiuanli(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'liuanli', '#63665c', '#484a40');
  pavement(g, 8, 9, 2, 7);
  // 卸货口雨棚与库房立面
  facade(g, 12, 9, 4, 1, -3.6, { floors: 3, cols: 4 });
  box(g, 7, 0.18, 3.2, mat(0x74797c), 2.2, 3.0, -0.4);
  for (const px of [-0.8, 5.2]) box(g, 0.14, 3.0, 0.14, C.metalDark, px, 1.5, 0.9);
  // 交接窗口（人在里面，隔着窗递单子）
  box(g, 2.2, 1.3, 0.12, mat(0xb9c4c0, { emissive: 0xb9c4c0, emissiveIntensity: 0.2 }), 2.2, 1.5, -1.5).castShadow = false;
  box(g, 2.6, 0.14, 0.5, C.wood, 2.2, 0.95, -1.35);
  textBoard(g, 1.3, 0.34, signTexture('物资交接', 240, 64), 2.2, 2.35, -1.48);
  // 铁网门（西侧）
  for (let i = 0; i < 8; i++) box(g, 0.07, 2.4, 0.07, C.metalDark, -3.8, 1.2, 1.6 + i * 1.7);
  box(g, 0.1, 0.08, 13, C.metalDark, -3.8, 2.4, 8.2).castShadow = false;
  // 蓝色托盘与物资
  box(g, 3.4, 0.16, 1.9, PALLET, 1.5, 0.25, 5.2);
  sacks(g, 6, 1.4, 5.2);
  sacks(g, 3, 4.2, 6.6, 0.4);
  // 地秤与记录板
  box(g, 1.3, 0.12, 1.3, mat(0x7c8288), -1.6, 0.06, 7.6);
  box(g, 0.12, 1.1, 0.12, C.metalDark, -2.2, 0.6, 7.6);
  textBoard(g, 0.5, 0.7, paperTexture('过磅', 4), -2.2, 1.25, 7.55);
  // 交接的人
  const clerk = makePerson({ coat: 0x6b7a6a, pants: 0x3f4550, cap: 0x5a6656 });
  clerk.position.set(3.4, 0, 3.0);
  clerk.rotation.y = 2.4;
  g.add(clerk);
  dust(g, ctx, 36, { x: [-5, 7], y: [0.3, 2.6], z: [-1, 15] });
}

function buildCanteen(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.canteen;
  roomShell(g, b, { doorX: 0, doorW: 2.0, floor: ['#7a7468', '#5e594f'] });
  lamp(g, ctx, -2.6, 2.74, -1.0);
  lamp(g, ctx, 2.6, 2.74, -1.0);
  // 发餐窗口（北墙）
  box(g, 9, 0.3, 0.5, mat(0x9aa096), 0, 1.6, -7.4);
  box(g, 2.6, 1.0, 0.16, mat(0x2f3833), 0, 1.45, -7.2);
  box(g, 3.0, 0.14, 0.6, C.metal, 0, 0.95, -6.95);
  textBoard(g, 1.8, 0.4, signTexture('打饭窗口 · 一人一份', 340, 72), 0, 2.3, -7.15);
  // 两张长桌与条凳
  for (const tz of [0.8, 3.2]) {
    box(g, 6.0, 0.14, 0.95, C.wood, 0, 0.78, tz);
    for (const lx of [-2.6, 2.6]) {
      box(g, 0.1, 0.78, 0.1, C.metalDark, lx, 0.39, tz - 0.34);
      box(g, 0.1, 0.78, 0.1, C.metalDark, lx, 0.39, tz + 0.34);
    }
    box(g, 6.0, 0.1, 0.32, C.wood, 0, 0.44, tz - 0.85);
    box(g, 6.0, 0.1, 0.32, C.wood, 0, 0.44, tz + 0.85);
    aoPatch(g, 6.6, 2.4, 0, tz, 0.35);
  }
  // 登记桌（门边）
  box(g, 1.8, 0.1, 0.9, C.wood, -4.6, 0.76, 2.4);
  for (const [lx, lz] of [[0.8, 0.38], [-0.8, 0.38], [0.8, -0.38], [-0.8, -0.38]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, -4.6 + lx, 0.38, 2.4 + lz);
  }
  textBoard(g, 0.5, 0.62, paperTexture('领餐登记', 5), -4.6, 0.83, 2.4).rotation.x = -Math.PI / 2;
  // 餐盘与保温桶
  for (let i = 0; i < 6; i++) cyl(g, 0.12, 0.05, 0xe0dccb, -1.6 + i * 0.6, 0.88, 0.8);
  cyl(g, 0.34, 0.62, mat(0xcfd3d0), 2.6, 0.31, -6.0);
  cyl(g, 0.36, 0.06, mat(0xa8aca8), 2.6, 0.64, -6.0);
  // 墙上的公告
  textBoard(g, 1.3, 1.6, paperTexture('临时供餐须知', 7), -5.0, 1.8, -7.35);
  dust(g, ctx, 40, { x: [-7, 7], y: [0.4, 2.5], z: [-7, 7] });
}

// ================================================================ 第三章

function buildDongjie(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'dongjie', '#63605a', '#474540');
  pavement(g, 14, 5, 0, 5.6);
  // 两栋旧楼（临街的二栋与四栋）与楼号
  facade(g, 8, 14, 7, -7.5, -8.0, { floors: 5, cols: 3 });
  facade(g, 8, 16, 7, 7.5, -8.0, { floors: 6, cols: 3 });
  textBoard(g, 1.1, 0.5, signTexture('二栋', 200, 90), -7.5, 3.0, -4.45);
  textBoard(g, 1.1, 0.5, signTexture('四栋', 200, 90), 7.5, 3.0, -4.45);
  // 铁网门：立柱 + 网面 + 挂着的塑料条 + 压住缺口的砖
  const meshM = canvasTexture(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(70,76,74,0.9)'; c.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, 128); c.stroke();
      c.beginPath(); c.moveTo(0, i * 16); c.lineTo(128, i * 16); c.stroke();
    }
  });
  meshM.wrapS = meshM.wrapT = THREE.RepeatWrapping;
  meshM.repeat.set(10, 2);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.2),
    new THREE.MeshLambertMaterial({ map: meshM, transparent: true, side: THREE.DoubleSide }));
  net.position.set(0, 1.1, -2.4);
  g.add(net);
  for (let i = 0; i < 10; i++) box(g, 0.08, 2.3, 0.08, C.metalDark, -9 + i * 2, 1.15, -2.4);
  box(g, 1.5, 2.2, 0.12, mat(0x6f766e), 0.4, 1.1, -2.42);   // 门扇
  cyl(g, 0.04, 0.3, C.metal, 1.05, 1.1, -2.3, { rx: Math.PI / 2 });
  for (let i = 0; i < 7; i++) box(g, 0.5, 0.18, 0.3, mat(0x9a6a55), -6 + i * 2.1, 0.09, -2.3);
  for (let i = 0; i < 12; i++) {
    const strip = box(g, 0.06, 0.5, 0.02, mat(i % 3 ? 0xc8ccc4 : 0xd9b7a0), -8 + i * 1.4, 1.9, -2.36);
    strip.castShadow = false;
    strip.rotation.z = (i % 4) * 0.08;
  }
  // 社区小货车与卸下来的餐箱
  box(g, 3.8, 1.6, 1.9, mat(0x9aa39c), -6.5, 1.05, 6.5);
  box(g, 1.4, 1.3, 1.8, mat(0x7d8a86), -4.0, 0.9, 6.5);
  for (const wx of [-7.6, -4.4]) {
    cyl(g, 0.34, 0.24, mat(0x2a2d2e), wx, 0.34, 5.6, { rx: Math.PI / 2 });
    cyl(g, 0.34, 0.24, mat(0x2a2d2e), wx, 0.34, 7.4, { rx: Math.PI / 2 });
  }
  for (let i = 0; i < 4; i++) box(g, 0.72, 0.42, 0.52, C.sheet, -1.4 + i * 0.85, 0.21, -1.1);
  // 墙边那辆电动车（后架两只筐、车把上一副洗旧的布手套、筐里的硬纸牌）
  const ev = new THREE.Group();
  ev.position.set(4.6, 0, -0.6);
  ev.rotation.y = -0.5;
  g.add(ev);
  box(ev, 1.3, 0.16, 0.36, mat(0x6f7a80), 0, 0.55, 0);
  box(ev, 0.1, 0.5, 0.1, C.metalDark, 0.6, 0.8, 0);
  box(ev, 0.1, 0.06, 0.5, C.metalDark, 0.66, 1.02, 0);
  cyl(ev, 0.27, 0.1, mat(0x2a2d2e), -0.55, 0.27, 0, { rx: Math.PI / 2 });
  cyl(ev, 0.27, 0.1, mat(0x2a2d2e), 0.55, 0.27, 0, { rx: Math.PI / 2 });
  box(ev, 0.52, 0.36, 0.5, mat(0xb8b1a0), -0.5, 0.82, 0);
  box(ev, 0.52, 0.36, 0.5, mat(0x9aa8b0), 0.36, 0.82, 0);
  box(ev, 0.16, 0.08, 0.3, C.cloth, 0.66, 1.1, 0);
  textBoard(ev, 0.42, 0.3, paperTexture('房号 · 忌口', 3), -0.5, 1.06, 0).rotation.x = -Math.PI / 2.2;
  // 晾衣绳与楼前的旧椅
  for (let i = 0; i < 5; i++) box(g, 0.45, 0.6, 0.02, mat(i % 2 ? 0xa9b0ae : 0xc4b9a6), -9 + i * 0.9, 2.2, -3.6);
  box(g, 0.44, 0.06, 0.44, C.wood, 8.4, 0.46, -0.4);
  box(g, 0.44, 0.5, 0.06, C.wood, 8.4, 0.72, -0.2);
  dust(g, ctx, 44, { x: [-9, 9], y: [0.3, 3.0], z: [-5, 9] });
}

function buildObsroom(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.obsroom;
  roomShell(g, b, { doorX: 0.5, doorW: 1.4, floor: ['#767b7c', '#5a5f60'], wallTint: '#c6c9c4' });
  lamp(g, ctx, -2.0, 2.74, 0.4);
  lamp(g, ctx, 2.4, 2.74, 0.4);
  // 床 + 床头柜 + 教室编号牌
  box(g, 1.05, 0.36, 2.1, mat(0x8c8f8a), -3.6, 0.36, 0.6);
  box(g, 1.1, 0.18, 2.15, C.sheet, -3.6, 0.62, 0.6);
  box(g, 0.92, 0.14, 0.42, mat(0xd8d4c8), -3.6, 0.76, -0.3);
  box(g, 0.5, 0.5, 0.42, mat(0x7f837e), -3.6, 0.25, 1.9);
  cyl(g, 0.06, 0.24, mat(0xcfd3cc), -3.6, 0.62, 1.9);
  textBoard(g, 0.9, 0.45, signTexture('三 · 12', 200, 100), -3.6, 2.2, -3.72);
  // 收了一半的投影幕（白色下沿停在窗前）
  box(g, 4.6, 0.08, 0.14, mat(0xe4e0d4), 0.5, 2.3, -3.7).castShadow = false;
  box(g, 4.4, 1.35, 0.04, mat(0xf0ece0), 0.5, 1.6, -3.7).castShadow = false;
  // 补充询问用的桌子（通风的门边），两侧留距离
  box(g, 1.8, 0.1, 0.95, C.wood, 1.6, 0.76, -1.2);
  for (const [lx, lz] of [[0.85, -0.4], [-0.85, -0.4], [0.85, 0.4], [-0.85, 0.4]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, 1.6 + lx, 0.38, -1.2 + lz);
  }
  textBoard(g, 0.5, 0.64, paperTexture('询问记录', 6), 1.5, 0.82, -1.2).rotation.x = -Math.PI / 2;
  box(g, 0.44, 0.06, 0.44, C.wood, 2.9, 0.46, -1.2);
  box(g, 0.44, 0.5, 0.06, C.wood, 3.1, 0.72, -1.2);
  box(g, 0.44, 0.06, 0.44, C.wood, 0.3, 0.46, -1.2);
  box(g, 0.44, 0.5, 0.06, C.wood, 0.1, 0.72, -1.2);
  // 折叠桌：名单、续餐材料与那个笔记本都摊在这里（C03-05 / C04-01 的交互点）
  box(g, 1.2, 0.08, 0.7, mat(0xb9ae93), -2.4, 0.74, 2.2);
  for (const [lx, lz] of [[0.5, 0.28], [-0.5, 0.28], [0.5, -0.28], [-0.5, -0.28]] as const) {
    box(g, 0.05, 0.74, 0.05, C.metalDark, -2.4 + lx, 0.37, 2.2 + lz);
  }
  textBoard(g, 0.42, 0.55, paperTexture('配送名单', 5), -2.6, 0.79, 2.2).rotation.x = -Math.PI / 2;
  box(g, 0.3, 0.04, 0.22, mat(0x6d6a5c), -2.0, 0.78, 2.28);     // 合着的笔记本
  cyl(g, 0.05, 0.1, mat(0xcfd3cc), -2.0, 0.81, 1.95);           // 半杯水
  aoPatch(g, 1.8, 1.4, -2.4, 2.2, 0.35);

  // 走廊侧的门与窗（夜里推餐车的声音从这边过）
  box(g, 1.4, 2.1, 0.1, mat(0x7c7a6e), 0.5, 1.05, 4.9).castShadow = false;
  box(g, 0.5, 0.5, 0.06, mat(0xb9c4c0, { emissive: 0xb9c4c0, emissiveIntensity: 0.25 }), 0.5, 1.7, 4.84).castShadow = false;
  // 洗手台（夜里撞到胳膊的那只水龙头）
  box(g, 0.7, 0.16, 0.5, mat(0xd6d8d2), 5.2, 0.86, 2.4);
  box(g, 0.7, 0.86, 0.06, mat(0xb9bcb6), 5.2, 0.43, 2.66);
  cyl(g, 0.03, 0.22, C.metal, 5.2, 1.02, 2.6);
  dust(g, ctx, 30, { x: [-5, 5], y: [0.4, 2.4], z: [-3, 4] });
}

// ================================================================ 第四章

function buildHome(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.home;
  roomShell(g, b, { doorX: 0, doorW: 1.2, floor: ['#7d6f5c', '#5e5347'], wallTint: '#cdc6b4' });
  lamp(g, ctx, 0, 2.74, -0.6);
  // 门厅：入户门、门口的两双鞋、挂钩
  box(g, 1.1, 2.1, 0.1, mat(0x7a6a55), 0, 1.05, 4.4).castShadow = false;
  cyl(g, 0.035, 0.12, C.metal, 0.42, 1.05, 4.32, { rx: Math.PI / 2 });
  box(g, 0.28, 0.1, 0.5, mat(0x6a5f52), -0.6, 0.05, 3.7);
  box(g, 0.28, 0.1, 0.5, mat(0x6a5f52), -0.25, 0.05, 3.7);
  box(g, 0.6, 0.06, 0.12, C.wood, 0.9, 1.7, 4.36);
  box(g, 0.3, 0.5, 0.1, mat(0x6d7a6a), 0.9, 1.4, 4.3);
  // 那把递过来的椅子（正对门口）
  box(g, 0.46, 0.06, 0.46, C.wood, 0.8, 0.46, -0.9);
  box(g, 0.46, 0.52, 0.06, C.wood, 0.8, 0.74, -0.68);
  for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as const) {
    box(g, 0.05, 0.46, 0.05, C.metalDark, 0.8 + lx, 0.23, -0.9 + lz);
  }
  aoPatch(g, 1.2, 1.2, 0.8, -0.9, 0.4);
  // 桌子：按日期排好的病历、药盒、座机
  box(g, 1.7, 0.1, 0.95, C.wood, -1.6, 0.76, -1.6);
  for (const [lx, lz] of [[0.75, 0.38], [-0.75, 0.38], [0.75, -0.38], [-0.75, -0.38]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, -1.6 + lx, 0.38, -1.6 + lz);
  }
  for (let i = 0; i < 5; i++) {
    const f = box(g, 0.3, 0.035, 0.42, mat(i % 2 ? 0xe0dccb : 0xd5cfba), -2.2 + i * 0.3, 0.83 + i * 0.012, -1.6);
    f.rotation.y = (i % 3) * 0.04;
  }
  box(g, 0.22, 0.09, 0.14, mat(0xcf6d5a), -0.95, 0.85, -1.9);
  box(g, 0.3, 0.1, 0.22, mat(0x4d5259), -0.95, 0.86, -1.2);
  aoPatch(g, 2.4, 1.6, -1.6, -1.6, 0.4);
  // 窗、日历、挂钟
  box(g, 1.8, 1.2, 0.06, mat(0xb9c4c0, { emissive: 0xb9c4c0, emissiveIntensity: 0.22 }), -3.0, 1.7, -3.86).castShadow = false;
  box(g, 1.9, 0.08, 0.16, C.wood, -3.0, 1.05, -3.8);
  textBoard(g, 0.55, 0.7, paperTexture('透析 · 接送', 5), 1.9, 1.8, -3.83);
  cyl(g, 0.22, 0.05, mat(0xe2ded0), 3.4, 2.1, -3.84, { rx: Math.PI / 2 });
  // 母亲：在桌边打电话核对下一轮接送
  const mom = makePerson({ coat: 0x8a6f72, pants: 0x4a4d50, skin: 0xd6b79a, scale: 0.96 });
  mom.position.set(-1.2, 0, -0.9);
  mom.rotation.y = 0.9;
  g.add(mom);
  dust(g, ctx, 26, { x: [-4, 4], y: [0.4, 2.4], z: [-3, 4] });
}

function buildRepair(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'repair', '#5e6166', '#43464a');
  pavement(g, 8.5, 6.5, 2.0, 0.4);
  // 工具棚（灰灰待的地方）：三面墙 + 斜顶 + 垫子与食盆
  const shed = new THREE.Group();
  shed.position.set(-4.6, 0, 3.0);
  g.add(shed);
  box(shed, 2.8, 2.0, 2.4, mat(0x6f757a), 0, 1.0, 0);
  box(shed, 3.1, 0.14, 2.7, mat(0x596066), 0, 2.07, 0);
  box(shed, 2.0, 1.4, 0.1, mat(0x2f3833), 0, 0.7, -1.22).castShadow = false;
  box(shed, 0.9, 0.1, 0.7, C.cloth, 0.2, 0.06, -1.9);
  cyl(shed, 0.16, 0.08, mat(0xb8b1a0), -0.7, 0.04, -1.9);
  textBoard(shed, 0.9, 0.3, signTexture('工具棚', 200, 68), 0, 2.4, -1.3);
  // 工坊：半开放棚架 + 工作台 + 拆了一半的送餐推车
  box(g, 8.0, 0.16, 6.0, mat(0x6b7176), 2.6, 3.0, 0.4).castShadow = false;
  for (const [px, pz] of [[-1.2, -2.4], [6.4, -2.4], [-1.2, 3.2], [6.4, 3.2]] as const) {
    box(g, 0.16, 3.0, 0.16, C.metalDark, px, 1.5, pz);
  }
  const cart = makeCart(true);
  cart.position.set(1.2, 0, 1.0);
  cart.rotation.y = -0.25;
  g.add(cart);
  aoPatch(g, 3.8, 2.6, 1.2, 1.0, 0.42);
  // 工作台、台钳、散落的零件
  box(g, 2.6, 0.14, 1.0, C.wood, 4.4, 0.86, -1.4);
  for (const lx of [-1.1, 1.1]) box(g, 0.12, 0.86, 0.12, C.metalDark, 4.4 + lx, 0.43, -1.4);
  box(g, 0.28, 0.24, 0.2, mat(0x6b7278), 3.6, 1.05, -1.4);
  for (let i = 0; i < 6; i++) {
    box(g, 0.12, 0.06, 0.12, mat(i % 2 ? 0x8f979e : 0x9a4f2f), 4.2 + (i % 3) * 0.28, 0.96, -1.1 + Math.floor(i / 3) * 0.3);
  }
  // 登记可拆的报废架
  for (let i = 0; i < 3; i++) box(g, 3.0, 0.1, 0.8, C.metal, 4.6, 0.5 + i * 0.7, -2.4);
  for (const px of [3.2, 6.0]) box(g, 0.1, 1.9, 0.1, C.metalDark, px, 0.95, -2.4);
  textBoard(g, 1.1, 0.3, signTexture('报废 · 可拆', 240, 64, '#5a3b2c', '#e8dcc8'), 4.6, 2.05, -2.32);
  // 待修的旧板车（还在等车轮的那辆）
  const broken = makeCart(true);
  broken.position.set(-1.6, 0, -2.8);
  broken.rotation.y = 1.2;
  g.add(broken);
  // 陈工
  const chen = makePerson({ coat: 0x5d6a72, pants: 0x3f4550, cap: 0x4b565c });
  chen.position.set(2.4, 0, -0.2);
  chen.rotation.y = 2.6;
  g.add(chen);
  dust(g, ctx, 40, { x: [-6, 6], y: [0.3, 2.6], z: [-4, 5] });
}

function buildWaterfix(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'waterfix', '#576066', '#3e454a');
  pavement(g, 9, 6, 0, -1.2);
  // 维修点山墙与卷帘门
  box(g, 10, 4.0, 0.5, brickMat('#82878a', '#61666a'), 0, 2.0, -4.6).castShadow = false;
  box(g, 3.2, 2.6, 0.12, mat(0x7b8288), -3.0, 1.3, -4.3);
  for (let i = 0; i < 9; i++) box(g, 3.2, 0.1, 0.16, mat(0x878e94), -3.0, 0.3 + i * 0.29, -4.24).castShadow = false;
  textBoard(g, 2.2, 0.44, signTexture('净水设备维修点', 380, 76), 2.4, 2.6, -4.32);
  // 第一行：修好的净水支架（现场看得见）
  const rig = new THREE.Group();
  rig.position.set(-1.2, 0, -1.8);
  g.add(rig);
  box(rig, 1.5, 0.14, 1.5, C.metal, 0, 0.86, 0);
  for (const [lx, lz] of [[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]] as const) {
    box(rig, 0.1, 0.86, 0.1, C.metalDark, lx, 0.43, lz);
  }
  cyl(rig, 0.5, 1.3, mat(0xc9ccc6), 0, 1.58, 0);
  cyl(rig, 0.52, 0.08, mat(0x9aa0a4), 0, 2.26, 0);
  cyl(rig, 0.07, 1.2, C.metal, 0.62, 1.3, 0.4, { rz: Math.PI / 2 });
  cyl(rig, 0.07, 0.9, C.metal, 0, 0.5, 0.9, { rx: Math.PI / 2 });
  aoPatch(rig, 2.4, 2.4, 0, 0, 0.4);
  textBoard(g, 0.42, 0.5, paperTexture('已装', 2), -1.2, 1.1, -0.98);
  // 第二行：空着的工位——地上只剩固定孔与一圈没擦掉的印子
  const slab = box(g, 1.6, 0.06, 1.6, mat(0x6b6f72), 2.0, 0.03, -1.8);
  slab.castShadow = false;
  for (const [hx, hz] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]] as const) {
    cyl(g, 0.06, 0.05, mat(0x3b3f42), 2.0 + hx, 0.07, -1.8 + hz);
  }
  aoPatch(g, 2.0, 2.0, 2.0, -1.8, 0.3);
  // 料堆、水箱与推车
  for (let i = 0; i < 5; i++) cyl(g, 0.06, 2.4, C.metal, 4.2 + i * 0.16, 0.07, 1.4, { rz: Math.PI / 2 });
  box(g, 1.6, 1.0, 1.0, mat(0x9aa8b0), -4.4, 0.5, 1.6);
  cyl(g, 0.05, 0.8, C.metal, -3.6, 0.9, 1.6, { rz: Math.PI / 2 });
  const cart = makeCart();
  cart.position.set(3.8, 0, 2.6);
  cart.rotation.y = 1.4;
  g.add(cart);
  dust(g, ctx, 34, { x: [-5, 5], y: [0.3, 2.6], z: [-4, 4] });
}

function buildGridoffice(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.gridoffice;
  roomShell(g, b, { doorX: 1.6, doorW: 1.4, floor: ['#77736a', '#5a5750'], wallTint: '#cbc8ba' });
  lamp(g, ctx, -1.2, 2.74, -1.0);
  lamp(g, ctx, 2.2, 2.74, 1.2);
  // 办公桌：摊开的报表、电话、笔筒
  box(g, 1.9, 0.1, 1.0, C.wood, -1.4, 0.76, -1.6);
  for (const [lx, lz] of [[0.85, 0.42], [-0.85, 0.42], [0.85, -0.42], [-0.85, -0.42]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, -1.4 + lx, 0.38, -1.6 + lz);
  }
  textBoard(g, 0.56, 0.7, paperTexture('转移登记表', 6), -1.6, 0.82, -1.6).rotation.x = -Math.PI / 2;
  box(g, 0.3, 0.1, 0.22, mat(0x4d5259), -0.6, 0.86, -1.9);
  cyl(g, 0.05, 0.12, mat(0x6f7a80), -0.5, 0.87, -1.3);
  aoPatch(g, 2.6, 1.8, -1.4, -1.6, 0.4);
  // 椅子（桌前一把、墙边一把）
  for (const [cx2, cz2, ry] of [[-1.4, -0.4, 0], [3.2, -2.4, 1.2]] as const) {
    box(g, 0.44, 0.06, 0.44, C.wood, cx2, 0.46, cz2).rotation.y = ry;
    box(g, 0.44, 0.5, 0.06, C.wood, cx2, 0.72, cz2 + 0.2).rotation.y = ry;
  }
  // 文件柜与堆着的档案盒
  box(g, 0.95, 1.35, 0.5, mat(0x767c80), 0.9, 0.67, -2.0);
  for (let i = 0; i < 3; i++) box(g, 0.88, 0.05, 0.46, mat(0x5d6367), 0.9, 0.35 + i * 0.4, -1.76).castShadow = false;
  for (let i = 0; i < 3; i++) {
    box(g, 0.34, 0.26, 0.42, mat(i % 2 ? 0xbdb6a4 : 0xa9a292), 0.9, 1.48 + i * 0.28, -2.0);
  }
  // 墙上的片区图与公告
  const map = canvasTexture(320, 220, (c) => {
    c.fillStyle = '#d6d2c2'; c.fillRect(0, 0, 320, 220);
    c.strokeStyle = '#6f7468'; c.lineWidth = 2;
    for (let i = 1; i < 5; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64 - 20, 220); c.stroke(); }
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, i * 55); c.lineTo(320, i * 55 - 10); c.stroke(); }
    c.fillStyle = 'rgba(190,90,60,0.35)'; c.fillRect(120, 60, 74, 52);
    c.fillStyle = '#3c3a33'; c.font = 'bold 18px "Noto Sans CJK SC", sans-serif';
    c.fillText('片区网格图', 14, 28);
  });
  textBoard(g, 2.4, 1.6, map, 2.4, 1.8, -3.86);
  textBoard(g, 0.9, 1.15, paperTexture('暂扣通知', 5), -3.6, 1.7, -3.86);
  // 饮水机
  box(g, 0.4, 1.0, 0.4, mat(0xd2d5d0), -4.0, 0.5, 1.4);
  cyl(g, 0.22, 0.44, mat(0x9fc0cc), -4.0, 1.22, 1.4);
  // 赵网格
  const zhao = makePerson({ coat: 0x6b6f62, pants: 0x42474c, skin: 0xd2b193 });
  zhao.position.set(-1.4, 0, -2.6);
  zhao.rotation.y = 0.1;
  g.add(zhao);
  dust(g, ctx, 26, { x: [-4, 4], y: [0.4, 2.4], z: [-3, 4] });
}

function buildTrackside(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'trackside', '#6a6a63', '#4b4b46');
  // 路基、轨道与车皮
  box(g, 20, 0.5, 3.4, mat(0x6d6a60), 0, 0.25, -3.8).castShadow = false;
  for (const tz of [-4.4, -3.2]) box(g, 20, 0.12, 0.16, C.metalDark, 0, 0.56, tz).castShadow = false;
  for (let i = 0; i < 16; i++) box(g, 0.26, 0.1, 1.6, C.wood, -8 + i * 1.05, 0.5, -3.8).castShadow = false;
  const wagon = new THREE.Group();
  wagon.position.set(-1.6, 0, -3.8);
  g.add(wagon);
  box(wagon, 7.6, 2.5, 2.6, mat(0x6e7a74), 0, 1.75, 0);
  box(wagon, 7.8, 0.3, 2.8, mat(0x55605c), 0, 3.1, 0);
  for (const wx of [-2.6, 2.6]) {
    cyl(wagon, 0.42, 0.2, mat(0x2f3234), wx, 0.5, -1.2, { rx: Math.PI / 2 });
    cyl(wagon, 0.42, 0.2, mat(0x2f3234), wx, 0.5, 1.2, { rx: Math.PI / 2 });
  }
  textBoard(wagon, 1.6, 0.4, signTexture('食品 · 出库批次', 300, 72, '#3a403c', '#e2ded0'), 1.2, 1.9, 1.32);
  // 验收过的箱子一层层码好
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 4);
    box(g, 0.82, 0.52, 0.62, mat(row % 2 ? 0xc8bfa4 : 0xbdb49a), 3.0 + (i % 4) * 0.92, 0.26 + row * 0.53, 0.6);
  }
  aoPatch(g, 4.6, 1.6, 4.4, 0.6, 0.4);
  // 卸车的工人与推车
  const worker = makePerson({ coat: 0x6a7360, pants: 0x3f4550, vest: 0xd8c14a });
  worker.position.set(2.2, 0, 1.2);
  worker.rotation.y = -0.9;
  g.add(worker);
  const cart = makeCart();
  cart.position.set(0.4, 0, 2.6);
  cart.rotation.y = 0.5;
  g.add(cart);
  // 道口信号灯与护栏
  box(g, 0.12, 2.4, 0.12, C.metalDark, -5.6, 1.2, -0.8);
  box(g, 0.5, 0.5, 0.14, mat(0x3c4340), -5.6, 2.4, -0.8);
  sph(g, 0.12, mat(0xd05a3a, { emissive: 0xd05a3a, emissiveIntensity: 0.5 }), -5.75, 2.4, -0.72);
  sph(g, 0.12, mat(0x3f4a44), -5.45, 2.4, -0.72);
  for (let i = 0; i < 8; i++) box(g, 0.08, 1.0, 0.08, C.metalDark, -7.5 + i * 2.0, 0.5, -1.6);
  box(g, 15.5, 0.08, 0.1, C.metalDark, -0.5, 1.0, -1.6).castShadow = false;
  dust(g, ctx, 46, { x: [-8, 8], y: [0.3, 3.0], z: [-5, 5] });
}


// ================================================================ 第五章《签过的纸》

/** 带小窗口的柜台墙：本章反复出现的"隔着窗口说话" */
function counterWall(g: THREE.Group, x: number, z: number, w: number, label: string, ry = 0): void {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = ry;
  g.add(grp);
  box(grp, w, 3.0, 0.4, fadedWallMat('#c4c2b6'), 0, 1.5, 0).castShadow = false;
  box(grp, 1.9, 1.05, 0.14, mat(0x2f3833), 0, 1.35, 0.2);                 // 窗洞（暗）
  box(grp, 2.3, 0.14, 0.7, C.metal, 0, 0.92, 0.42);                       // 台面
  box(grp, 0.5, 0.02, 0.36, mat(0xe6e2d4), -0.5, 1.0, 0.42);              // 台面上的单子
  textBoard(grp, 1.5, 0.34, signTexture(label, 300, 70), 0, 2.25, 0.21);
  box(grp, 0.24, 0.3, 0.02, mat(0xd6d2c2), 0.75, 1.5, 0.21).castShadow = false; // 贴着的值班表
  aoPatch(grp, w, 1.6, 0, 0.5, 0.35);
}

function buildRecvstation(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.recvstation;
  roomShell(g, b, { doorX: 0, doorW: 1.8, floor: ['#77787a', '#5a5b5e'], wallTint: '#c8c9c2' });
  lamp(g, ctx, -2.2, 2.74, -0.6);
  lamp(g, ctx, 2.2, 2.74, 1.4);
  // 北墙：接收窗口（C05-00 在这里被拒收）
  counterWall(g, 1.8, -3.6, 5.2, '接收窗口 · 凭授权签收');
  // 西侧：档案柜与翻开的卷宗（C05-05）
  for (let i = 0; i < 3; i++) {
    box(g, 1.0, 1.9, 0.5, mat(0x767c80), -4.6, 0.95, -0.6 + i * 1.5);
    for (let k = 0; k < 4; k++) {
      box(g, 0.94, 0.05, 0.46, mat(0x5d6367), -4.6, 0.4 + k * 0.42, -0.36 + i * 1.5).castShadow = false;
    }
  }
  box(g, 1.6, 0.1, 0.9, C.wood, -2.2, 0.76, 1.8);
  for (const [lx, lz] of [[0.7, 0.36], [-0.7, 0.36], [0.7, -0.36], [-0.7, -0.36]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, -2.2 + lx, 0.38, 1.8 + lz);
  }
  textBoard(g, 0.5, 0.62, paperTexture('回执 · 交接联', 6), -2.35, 0.82, 1.8).rotation.x = -Math.PI / 2;
  textBoard(g, 0.42, 0.54, paperTexture('更正说明', 4), -1.9, 0.82, 1.9).rotation.x = -Math.PI / 2;
  // 排队线与两把等候椅
  box(g, 3.6, 0.02, 0.1, mat(0xb8a24e), 1.8, 0.02, -1.6).castShadow = false;
  for (const cx2 of [3.8, 4.6]) {
    box(g, 0.44, 0.06, 0.44, C.wood, cx2, 0.46, 2.6);
    box(g, 0.44, 0.5, 0.06, C.wood, cx2, 0.72, 2.8);
  }
  // 走廊末端的广播喇叭（"状态不变的按旧类别转运"）
  box(g, 0.34, 0.3, 0.26, mat(0x6b6f72), 5.2, 2.5, 1.0);
  cyl(g, 0.16, 0.12, mat(0x3f4446), 5.0, 2.5, 1.0, { rz: Math.PI / 2 });
  // 赵网格与接待员
  const zhao = makePerson({ coat: 0x6b6f62, pants: 0x42474c, skin: 0xd2b193 });
  zhao.position.set(-1.2, 0, 2.6);
  zhao.rotation.y = 0.4;
  g.add(zhao);
  const clerk = makePerson({ coat: 0x5f6a72, pants: 0x3f4550 });
  clerk.position.set(1.8, 0, -2.6);
  clerk.rotation.y = 0;
  g.add(clerk);
  dust(g, ctx, 30, { x: [-5, 5], y: [0.4, 2.4], z: [-3, 4] });
}

function buildMedpoint(g: THREE.Group, ctx: SceneryCtx): void {
  const b = SCENE_BOUNDS.medpoint;
  roomShell(g, b, { doorX: 0.4, doorW: 1.4, floor: ['#7a7b74', '#5c5d57'], wallTint: '#ccccc2' });
  lamp(g, ctx, -1.6, 2.74, -1.0);
  lamp(g, ctx, 2.0, 2.74, 1.2);
  // 值班桌：压着杯子的那张旧纸（C05-02）
  box(g, 1.8, 0.1, 0.95, C.wood, 1.4, 0.76, 0.6);
  for (const [lx, lz] of [[0.8, 0.4], [-0.8, 0.4], [0.8, -0.4], [-0.8, -0.4]] as const) {
    box(g, 0.07, 0.76, 0.07, C.metalDark, 1.4 + lx, 0.38, 0.6 + lz);
  }
  textBoard(g, 0.44, 0.56, paperTexture('处理决定', 4, '#ded9c8'), 1.2, 0.82, 0.6).rotation.x = -Math.PI / 2;
  cyl(g, 0.055, 0.12, mat(0xcfd3cc), 1.32, 0.86, 0.5);   // 压着纸角的杯子
  box(g, 0.3, 0.1, 0.22, mat(0x4d5259), 2.0, 0.86, 0.3); // 座机
  aoPatch(g, 2.4, 1.6, 1.4, 0.6, 0.4);
  // 药品交接台：退回的箱子、封签与温度记录
  box(g, 1.6, 0.9, 0.8, mat(0x8f958c), -1.2, 0.45, -1.0);
  box(g, 1.7, 0.08, 0.86, C.metal, -1.2, 0.94, -1.0);
  for (let i = 0; i < 2; i++) {
    box(g, 0.66, 0.42, 0.5, mat(i ? 0xbfc6c2 : 0xd0d5d0), -1.55 + i * 0.72, 1.19, -1.0);
    box(g, 0.2, 0.02, 0.12, mat(0xd8524a), -1.55 + i * 0.72, 1.41, -0.78).castShadow = false; // 封签
  }
  textBoard(g, 0.4, 0.5, paperTexture('温度记录', 4), -0.4, 1.0, -1.0).rotation.x = -Math.PI / 2;
  // 病床区：三张床与床尾的交接卡
  for (let i = 0; i < 3; i++) {
    const bz = -2.6 + i * 1.5;
    box(g, 1.9, 0.34, 0.85, mat(0x8c8f8a), -3.2, 0.34, bz);
    box(g, 1.95, 0.16, 0.9, C.sheet, -3.2, 0.58, bz);
    box(g, 0.44, 0.12, 0.34, mat(0xd8d4c8), -3.95, 0.72, bz);
    box(g, 0.3, 0.02, 0.2, mat(0xe6e2d4), -2.3, 0.6, bz).castShadow = false;
  }
  // 药柜与洗手台
  box(g, 0.9, 1.8, 0.45, mat(0xd2d5d0), 3.6, 0.9, -2.6);
  for (let i = 0; i < 3; i++) box(g, 0.84, 0.05, 0.42, mat(0xa9aeb0), 3.6, 0.5 + i * 0.5, -2.4).castShadow = false;
  box(g, 0.7, 0.16, 0.5, mat(0xd6d8d2), 4.2, 0.86, 1.8);
  cyl(g, 0.03, 0.22, C.metal, 4.2, 1.02, 1.9);
  // 梁医生（常驻同行：此后几段路都有他在场）
  const liang = makePerson({ coat: 0xd8dbd6, pants: 0x4a5058, skin: 0xd2b193 });
  liang.position.set(1.4, 0, 1.8);
  liang.rotation.y = Math.PI;
  g.add(liang);
  dust(g, ctx, 26, { x: [-4, 4], y: [0.4, 2.4], z: [-3, 4] });
}

function buildSafezone(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'safezone', '#60635e', '#464942');
  pavement(g, 7, 5, 0, 1.4);
  // 安全区外墙与那扇侧窗（挡门的桶就在窗下）
  facade(g, 12, 9, 4, 0, -4.4, { floors: 3, cols: 4 });
  counterWall(g, 0.6, -2.4, 3.4, '职工安全区 · 侧窗');
  cyl(g, 0.3, 0.8, mat(0x6f7a6a), 1.9, 0.4, -1.7);   // 挡门的桶（搬开过一次）
  cyl(g, 0.3, 0.8, mat(0x6f7a6a), 2.6, 0.4, -1.5);
  for (let i = 0; i < 3; i++) cyl(g, 0.055, 0.11, mat(0xdfe3dc), -0.2 + i * 0.3, 1.0, -1.98); // 送出来的几杯水
  // 围栏、出入登记牌与晾着的工服
  for (let i = 0; i < 9; i++) box(g, 0.08, 1.5, 0.08, C.metalDark, -5 + i * 1.2, 0.75, 2.6);
  box(g, 11, 0.07, 0.1, C.metalDark, -0.2, 1.5, 2.6).castShadow = false;
  textBoard(g, 1.5, 0.4, signTexture('出入须登记', 300, 72), -3.4, 1.9, -2.2);
  for (let i = 0; i < 4; i++) box(g, 0.5, 0.7, 0.02, mat(i % 2 ? 0x8a9298 : 0xa9a292), -4.6 + i * 0.7, 1.9, -1.9);
  // 交接车停在路边
  const van = makeVan();
  van.position.set(3.6, 0, 1.8);
  van.rotation.y = -1.5;
  g.add(van);
  // 梁医生不在这里摆静态人物：C05-03 之后他是跟随的同行者（world.ts setCompanion）
  dust(g, ctx, 30, { x: [-5, 5], y: [0.3, 2.6], z: [-3, 3] });
}

function buildCheckgate(g: THREE.Group, ctx: SceneryCtx): void {
  outdoorGround(g, 'checkgate', '#67655c', '#4a4840');
  pavement(g, 16, 5.5, 0, 0.6);
  // 岗亭、横杆与路锥
  box(g, 2.0, 2.5, 2.0, mat(0x8e9490), -3.6, 1.25, -1.4);
  box(g, 2.2, 0.16, 2.2, mat(0x5d6360), -3.6, 2.6, -1.4);
  box(g, 1.2, 1.0, 0.1, mat(0xbfcac6, { emissive: 0xbfcac6, emissiveIntensity: 0.2 }), -3.6, 1.6, -0.36).castShadow = false;
  box(g, 0.24, 0.3, 0.16, mat(0x3f4446), -2.7, 1.5, -0.5);  // 对讲机
  box(g, 5.0, 0.12, 0.12, mat(0xd8522f), 0.2, 1.05, -0.4);
  cyl(g, 0.12, 1.05, C.metalDark, -2.3, 0.52, -0.4);
  for (let i = 0; i < 4; i++) {
    const cone = cyl(g, 0.22, 0.55, mat(0xd05a3a), 2.6 + i * 1.1, 0.27, 1.6);
    cone.scale.set(0.44, 0.55, 0.44);
  }
  // 停在杆前的交接车、等核查的人与摊开的证件
  const van = makeVan();
  van.position.set(2.4, 0, 2.6);
  van.rotation.y = 0.05;
  g.add(van);
  // 同上：岗亭这一段梁是跟着来的，不在建景里摆
  const zhao = makePerson({ coat: 0x6b6f62, pants: 0x42474c });
  zhao.position.set(-0.6, 0, 2.4);
  zhao.rotation.y = -1.2;
  g.add(zhao);
  const guard = makePerson({ coat: 0x4e5a63, pants: 0x3a4149, cap: 0x3f4a52, vest: 0xd8c14a });
  guard.position.set(-2.4, 0, 0.4);
  guard.rotation.y = 1.4;
  g.add(guard);
  textBoard(g, 1.8, 0.42, signTexture('核查点 · 请出示证件', 360, 76), -3.6, 2.9, -0.35);
  dust(g, ctx, 34, { x: [-6, 6], y: [0.3, 2.6], z: [-3, 4] });
}

// ================================================================ 装配表

type Builder = (g: THREE.Group, ctx: SceneryCtx) => void;

const BUILDERS: Partial<Record<SceneId, Builder>> = {
  yard: buildYard,
  road: buildRoad,
  pump: buildPump,
  liuanli: buildLiuanli,
  canteen: buildCanteen,
  dongjie: buildDongjie,
  obsroom: buildObsroom,
  home: buildHome,
  repair: buildRepair,
  waterfix: buildWaterfix,
  gridoffice: buildGridoffice,
  trackside: buildTrackside,
  recvstation: buildRecvstation,
  medpoint: buildMedpoint,
  safezone: buildSafezone,
  checkgate: buildCheckgate
};

/** 建景入口：有正式建景就用，没有的场景回退为空（由 world.ts 的兜底地面负责） */
export function buildScenery(g: THREE.Group, id: SceneId, ctx: SceneryCtx): boolean {
  const b = BUILDERS[id];
  if (!b) return false;
  b(g, ctx);
  return true;
}

/**
 * 静物阻挡：与上面的建景一一对应（"看得见的东西挡得住"）。
 * 语义同 mapdata.WallRect：中心 + 半宽/半深（+ 可选高度）。
 */
export const SCENERY_BLOCKERS: Partial<Record<SceneId, WallRect[]>> = {
  yard: [
    { x: -1, z: -6.5, hx: 7, hz: 2.5, h: 13 },
    { x: 8.5, z: -3.5, hx: 3, hz: 2.5, h: 10 },
    { x: 0, z: 6, hx: 1.5, hz: 0.9, h: 0.8 },      // 板车
    { x: -4.5, z: 6.5, hx: 0.6, hz: 0.35, h: 1.5 },// 工具架
    { x: -6.2, z: 2.2, hx: 1.2, hz: 0.2, h: 2.2 }  // 宣传栏
  ],
  road: [
    { x: 6, z: -5.6, hx: 10, hz: 1.6, h: 3.6 },    // 桥体
    { x: 1.2, z: 2.6, hx: 0.9, hz: 0.9, h: 2.4 },  // 岗亭
    { x: 10, z: -1.6, hx: 2.2, hz: 1.0, h: 1.8 }   // 面包车
  ],
  pump: [
    { x: 7, z: 6, hx: 2.0, hz: 1.7, h: 3.4 },      // 泵站
    { x: 5.0, z: 4.4, hx: 0.5, hz: 0.5, h: 4.6 },  // 立管
    { x: -3.4, z: 8, hx: 1.9, hz: 0.25, h: 0.6 }   // 沙袋墙
  ],
  liuanli: [
    { x: 1, z: -3.6, hx: 6, hz: 2, h: 9 },         // 库房
    { x: -3.8, z: 8, hx: 0.2, hz: 6.5, h: 2.4 },   // 铁网
    { x: 1.5, z: 5.2, hx: 1.8, hz: 1.0, h: 0.9 },  // 托盘与麻袋
    { x: 4.2, z: 6.6, hx: 1.0, hz: 0.7, h: 0.7 }
  ],
  canteen: [
    { x: 0, z: -7.2, hx: 4.5, hz: 0.35, h: 1.8 },  // 发餐窗口台
    { x: 0, z: 0.8, hx: 3.0, hz: 0.9, h: 0.9 },    // 长桌一
    { x: 0, z: 3.2, hx: 3.0, hz: 0.9, h: 0.9 },    // 长桌二
    { x: -4.6, z: 2.4, hx: 0.9, hz: 0.5, h: 0.8 }  // 登记桌
  ],
  dongjie: [
    { x: -4.8, z: -2.4, hx: 4.4, hz: 0.25, h: 2.3 },
    { x: 4.8, z: -2.4, hx: 4.4, hz: 0.25, h: 2.3 },
    { x: -7.5, z: -8.0, hx: 4, hz: 3.5, h: 14 },
    { x: 7.5, z: -8.0, hx: 4, hz: 3.5, h: 16 },
    { x: -6.5, z: 6.5, hx: 1.9, hz: 0.95, h: 1.6 },
    { x: 4.6, z: -0.6, hx: 0.7, hz: 0.5, h: 1.0 }
  ],
  obsroom: [
    { x: -3.6, z: 0.6, hx: 0.55, hz: 1.1, h: 0.8 },
    { x: -2.4, z: 2.2, hx: 0.6, hz: 0.35, h: 0.75 },
    { x: 1.6, z: -1.2, hx: 0.9, hz: 0.5, h: 0.8 },
    { x: 5.2, z: 2.4, hx: 0.35, hz: 0.25, h: 0.9 }
  ],
  home: [
    { x: -1.6, z: -1.6, hx: 0.85, hz: 0.5, h: 0.8 },
    { x: 0.8, z: -0.9, hx: 0.25, hz: 0.25, h: 0.9 }
  ],
  repair: [
    { x: -4.6, z: 3.0, hx: 1.4, hz: 1.2, h: 2.0 },
    { x: 1.2, z: 1.0, hx: 1.5, hz: 0.9, h: 0.9 },
    { x: 4.4, z: -1.4, hx: 1.3, hz: 0.5, h: 0.9 },
    { x: 4.6, z: -2.4, hx: 1.6, hz: 0.45, h: 1.9 },
    { x: -1.6, z: -2.8, hx: 0.9, hz: 1.4, h: 0.8 }
  ],
  waterfix: [
    { x: 0, z: -4.6, hx: 5, hz: 0.3, h: 4 },
    { x: -1.2, z: -1.8, hx: 0.8, hz: 0.8, h: 2.2 },
    { x: -4.4, z: 1.6, hx: 0.8, hz: 0.5, h: 1.0 },
    { x: 3.8, z: 2.6, hx: 0.9, hz: 1.5, h: 0.8 }
  ],
  gridoffice: [
    { x: -1.4, z: -1.6, hx: 0.95, hz: 0.55, h: 0.8 },
    { x: 0.9, z: -2.0, hx: 0.5, hz: 0.3, h: 1.4 },
    { x: -4.0, z: 1.4, hx: 0.25, hz: 0.25, h: 1.2 }
  ],
  trackside: [
    { x: 0, z: -3.8, hx: 10, hz: 1.7, h: 3.0 },
    { x: 4.4, z: 0.6, hx: 1.9, hz: 0.4, h: 1.1 },
    { x: 0.4, z: 2.6, hx: 0.9, hz: 1.4, h: 0.8 }
  ],
  recvstation: [
    { x: 1.8, z: -3.6, hx: 2.6, hz: 0.45, h: 3.0 },   // 接收窗口柜台
    { x: -4.6, z: 0.9, hx: 0.5, hz: 2.6, h: 1.9 },    // 档案柜
    { x: -2.2, z: 1.8, hx: 0.85, hz: 0.5, h: 0.8 }    // 查档用的桌子
  ],
  medpoint: [
    { x: 1.4, z: 0.6, hx: 0.9, hz: 0.5, h: 0.8 },     // 值班桌
    { x: -1.2, z: -1.0, hx: 0.85, hz: 0.45, h: 0.9 }, // 药品交接台
    { x: -3.2, z: -0.4, hx: 1.0, hz: 2.2, h: 0.6 },   // 三张床
    { x: 3.6, z: -2.6, hx: 0.5, hz: 0.3, h: 1.8 }     // 药柜
  ],
  safezone: [
    { x: 0, z: -4.4, hx: 6, hz: 2, h: 9 },            // 安全区楼体
    { x: 0.6, z: -2.4, hx: 1.7, hz: 0.45, h: 3.0 },   // 侧窗柜台
    { x: 2.2, z: -1.6, hx: 0.7, hz: 0.4, h: 0.8 },    // 挡门的桶
    { x: 3.6, z: 1.8, hx: 1.0, hz: 2.2, h: 1.8 }      // 交接车
  ],
  checkgate: [
    { x: -3.6, z: -1.4, hx: 1.0, hz: 1.0, h: 2.5 },   // 岗亭
    { x: 0.2, z: -0.4, hx: 2.5, hz: 0.12, h: 1.1 },   // 横杆
    { x: 2.4, z: 2.6, hx: 2.2, hz: 1.0, h: 1.8 }      // 交接车
  ]
};
