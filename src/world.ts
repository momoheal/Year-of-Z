/**
 * world.ts —— 场景、角色、灯光、物理与投影
 *
 * 全屏正交3D场景：低多边形原创几何 + Canvas 生成材质，无远端资源。
 * 旧物流园为主场景；物资站卸货口、观察点、小区门口为压缩小场景
 * （doc/24 已登记：后半段以场景压缩与连续叙事完成，不建可自由探索的室内）。
 * 碰撞使用 cannon-es：玩家圆形近似，建筑为静态盒体；侧门在节点完成后移除阻挡。
 */

import * as THREE from 'three';
import { Body, Box, Sphere, Vec3, World as PhysWorld } from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameState, LightMode, LightPreset, NodeEffects, SceneId } from './story';
import { PARK_WALLS } from './mapdata';

export type WorldEvent = NonNullable<NodeEffects['worldEvent']>;

const V = THREE.Vector3;

// ---------------------------------------------------------------- 调色板（湿润灰绿 / 褪色白墙 / 锈红 / 暖黄）
const C = {
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
const PALLET = 0x9a7f58;

const PLAYER_R = 0.45;
const WALK_SPEED = 3.3;
const RUN_SPEED = 5.2;

// ---------------------------------------------------------------- 材质与几何帮手（共享几何/材质）

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const unitSph = new THREE.SphereGeometry(0.5, 12, 10);

function mat(color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material | number,
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

function cyl(parent: THREE.Object3D, r: number, h: number, m: THREE.Material | number,
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

function sph(parent: THREE.Object3D, r: number, m: THREE.Material | number,
             x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(unitSph, typeof m === 'number' ? mat(m) : m);
  mesh.scale.setScalar(r * 2);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Canvas 生成材质 */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

function plane(parent: THREE.Object3D, w: number, h: number, m: THREE.Material,
               x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function textBoard(parent: THREE.Object3D, w: number, h: number, tex: THREE.CanvasTexture,
                   x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.MeshLambertMaterial({ map: tex });
  return plane(parent, w, h, m, x, y, z, ry);
}

/** 地面纹理：湿色斑块 */
function groundTexture(base: string, patch: string, blotches: number): THREE.CanvasTexture {
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
function getAOTexture(): THREE.CanvasTexture {
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

function aoPatch(parent: THREE.Object3D, w: number, d: number, x: number, z: number, opacity = 0.5): void {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: getAOTexture(), transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.021, z);
  parent.add(m);
}

/** 同材质静态盒体合并：一次绘制代替多次（散件、托盘、货架等） */
function mergeColoredBoxes(
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

interface PersonOpt { coat: number; pants?: number; skin?: number; cap?: number; vest?: number; scale?: number }

function makePerson(o: PersonOpt): THREE.Group {
  const g = new THREE.Group();
  const s = o.scale ?? 1;
  const pants = o.pants ?? 0x4a4d50;
  const skin = o.skin ?? 0xd8b89a;
  // 腿以髋为轴（鸭子走摆动用）
  const mkLeg = (side: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.09 * s, 0.5 * s, 0);
    box(leg, 0.16 * s, 0.5 * s, 0.18 * s, pants, 0, -0.25 * s, 0);
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  const torso = cyl(g, 0.21 * s, 0.62 * s, o.coat, 0, 0.81 * s, 0);
  torso.scale.x *= 1.05;
  // 头（含帽）成组，便于点头/前倾
  const head = new THREE.Group();
  head.position.set(0, 1.28 * s, 0);
  sph(head, 0.155 * s, skin, 0, 0, 0);
  if (o.cap) {
    cyl(head, 0.16 * s, 0.07 * s, o.cap, 0, 0.14 * s, 0);
    box(head, 0.2 * s, 0.03 * s, 0.14 * s, o.cap, 0, 0.12 * s, 0.14 * s);
  }
  g.add(head);
  if (o.vest) {
    const v = box(g, 0.4 * s, 0.52 * s, 0.32 * s, mat(o.vest), 0, 0.84 * s, 0);
    v.castShadow = false;
  }
  g.userData.legL = legL;
  g.userData.legR = legR;
  g.userData.head = head;
  return g;
}

/** 简易车 */
function makeTruck(): THREE.Group {
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

function makeVan(): THREE.Group {
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

function makeDog(): THREE.Group {
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

// ---------------------------------------------------------------- 光照预设

interface LightDef {
  hemiSky: number; hemiGround: number; hemiInt: number;
  sun: number; sunInt: number; sunPos: [number, number, number];
  bg: number; fogNear: number; fogFar: number; lamps: number;
}

const LIGHTS: Record<LightPreset, LightDef> = {
  dawn: {
    hemiSky: 0xc3d2d8, hemiGround: 0x50493f, hemiInt: 0.85,
    sun: 0xffd2a0, sunInt: 1.35, sunPos: [26, 15, -8],
    bg: 0xb6c6c8, fogNear: 80, fogFar: 175, lamps: 0
  },
  noon: {
    hemiSky: 0xdde4e2, hemiGround: 0x5b5b50, hemiInt: 0.95,
    sun: 0xfff2dc, sunInt: 1.5, sunPos: [14, 40, 10],
    bg: 0xc7d1cf, fogNear: 95, fogFar: 200, lamps: 0
  },
  dusk: {
    hemiSky: 0x9b8391, hemiGround: 0x403c3a, hemiInt: 0.6,
    sun: 0xffa866, sunInt: 1.1, sunPos: [-28, 11, 9],
    bg: 0xc08a5f, fogNear: 70, fogFar: 160, lamps: 1
  },
  night: {
    hemiSky: 0x2f3d52, hemiGround: 0x15181d, hemiInt: 0.45,
    sun: 0x8fa3c8, sunInt: 0.5, sunPos: [-16, 30, -12],
    bg: 0x10161f, fogNear: 55, fogFar: 130, lamps: 1
  }
};

// ---------------------------------------------------------------- 主类

interface PhysCtx {
  world: PhysWorld;
  player: Body;
  named: Map<string, Body>;
}

export class GameWorld {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.OrthographicCamera;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;

  private container: HTMLElement;
  private sets = new Map<SceneId, THREE.Group>();
  private phys!: PhysCtx;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new V(0, 1, 0), 0);
  private clock = { t: 0 };

  private playerGroup = new THREE.Group();
  private playerMesh!: THREE.Group;
  private facing = 0;
  private marker = new THREE.Group();
  private markerTarget: { x: number; z: number } | null = null;
  private dog = makeDog();
  private dogMode: 'hidden' | 'idle' | 'follow' | 'shed' = 'hidden';
  private dogVel = new V();
  private tailT = 0;

  private sideDoorMesh: THREE.Object3D | null = null;
  private medVanGroup: THREE.Group | null = null;
  private passTagMesh: THREE.Object3D | null = null;
  private train: THREE.Group | null = null;
  private smokes: THREE.Mesh[] = [];
  private walkers: { g: THREE.Object3D; from: number; to: number; speed: number; z: number }[] = [];
  private lampGlow: THREE.Mesh[] = [];
  private lampLights: THREE.PointLight[] = [];
  private npcLao: THREE.Group | null = null;
  private npcWorker: THREE.Group | null = null;
  private dusts: THREE.Points[] = [];
  private guide = new THREE.Group();
  private guideChevs: THREE.Mesh[] = [];
  private glintPool: THREE.Mesh[] = [];
  private camFocus = new V(-12, 0, 37);
  private lastMove = { x: 0, z: 0 };
  private bobT = 0;
  private bobAmt = 0;
  private maxDPR = 1.5;

  private light = { cur: { ...LIGHTS.dawn }, from: { ...LIGHTS.dawn }, to: { ...LIGHTS.dawn }, t: 1, lampsOn: 0 };
  onReady?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.initRenderer();
    this.initLights();
    this.initMarker();
    this.scene.add(this.playerGroup);
    this.playerMesh = makePerson({ coat: 0xb9b3a4, pants: 0x6a6f74, vest: 0xd8b93f });
    const pack = box(this.playerMesh, 0.3, 0.4, 0.18, 0x4d5a4a, 0, 0.9, -0.24);
    pack.castShadow = false;
    this.playerGroup.add(this.playerMesh);
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.playerGroup.add(blob);
    this.scene.add(this.dog);
    this.dog.visible = false;
    this.initGuide();
    this.buildSet('park');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.onReady?.();
  }

  private initGuide(): void {
    // 地面引路箭头（chevron）池
    const tex = canvasTexture(96, 56, (c) => {
      c.clearRect(0, 0, 96, 56);
      c.fillStyle = '#d9a05b';
      c.beginPath();
      c.moveTo(30, 8);
      c.lineTo(72, 28);
      c.lineTo(30, 48);
      c.lineTo(42, 28);
      c.closePath();
      c.fill();
    });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.58),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.045;
      m.visible = false;
      this.guide.add(m);
      this.guideChevs.push(m);
    }
    this.scene.add(this.guide);
    // 环境热点微光池
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.09),
        mat(0xcfd9d0, { emissive: 0xcfd9d0, emissiveIntensity: 0.35 })
      );
      g.visible = false;
      this.scene.add(g);
      this.glintPool.push(g);
    }
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDPR));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.scene.fog = new THREE.Fog(0xb6c6c8, 80, 175);
  }

  private initLights(): void {
    this.hemi = new THREE.HemisphereLight(0xc3d2d8, 0x50493f, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd2a0, 1.35);
    this.sun.position.set(26, 15, -8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = -46; s.right = 46; s.top = 46; s.bottom = -46; s.near = 2; s.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  private initMarker(): void {
    const ringGeo = new THREE.RingGeometry(0.95, 1.2, 36);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: C.amber, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.marker.add(ring);
    this.marker.userData.ring = ring;

    const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), mat(C.amber, { emissive: C.amber, emissiveIntensity: 0.45 }));
    dia.position.y = 1.9;
    this.marker.add(dia);
    this.marker.userData.dia = dia;

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.34, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    pillar.position.y = 3.6;
    this.marker.add(pillar);
    this.scene.add(this.marker);
    this.marker.visible = false;
  }

  // ------------------------------------------------------------ 物理

  private newPhysics(): PhysCtx {
    const world = new PhysWorld({ gravity: new Vec3(0, 0, 0) });
    const player = new Body({
      mass: 1,
      shape: new Sphere(PLAYER_R),
      position: new Vec3(0, PLAYER_R, 0),
      linearDamping: 0,
      angularDamping: 1,
      allowSleep: false
    });
    player.fixedRotation = true;
    player.updateMassProperties();
    world.addBody(player);
    return { world, player, named: new Map() };
  }

  private addWall(ctx: PhysCtx, cx: number, cz: number, hx: number, hz: number, h = 3, name?: string): void {
    const b = new Body({ mass: 0, shape: new Box(new Vec3(hx, h / 2, hz)), position: new Vec3(cx, h / 2, cz) });
    ctx.world.addBody(b);
    if (name) ctx.named.set(name, b);
  }

  private removeNamedWall(name: string): void {
    const b = this.phys.named.get(name);
    if (b) {
      this.phys.world.removeBody(b);
      this.phys.named.delete(name);
    }
  }

  // ------------------------------------------------------------ 场景构建

  private getSet(id: SceneId): THREE.Group {
    let g = this.sets.get(id);
    if (!g) {
      g = new THREE.Group();
      this.scene.add(g);
      this.sets.set(id, g);
      if (id === 'park') this.buildPark(g);
      else if (id === 'depot') this.buildDepot(g);
      else if (id === 'quarantine') this.buildQuarantine(g);
      else this.buildGate(g);
    }
    return g;
  }

  /** 切换场景并重置物理；set 由 buildSet 记住首次构建 */
  setScene(id: SceneId, spawn: { x: number; z: number }): void {
    this.dogVel.set(0, 0, 0);
    for (const [, g] of this.sets) g.visible = false;
    const g = this.getSet(id);
    g.visible = true;
    this.phys = this.newPhysics();
    this.phys.player.position.set(spawn.x, PLAYER_R, spawn.z);
    if (id === 'park') this.parkPhysics(this.phys);
    else if (id === 'depot') this.depotPhysics(this.phys);
    else if (id === 'quarantine') this.quarantinePhysics(this.phys);
    else this.gatePhysics(this.phys);
    this.playerGroup.position.set(spawn.x, 0, spawn.z);
    this.camFocus.set(spawn.x, 0, spawn.z); // 切场景时镜头直接落位
    this.dog.visible = id === 'park' || id === 'depot';
    if (id === 'depot') {
      // 灰灰已移交工具棚：蹲在园外工具棚边
      this.dog.position.set(-13.2, 0, 6.4);
      this.dog.rotation.y = -0.6;
    } else if (id === 'park') {
      this.placeDogByState();
    }
  }

  private buildSet(id: SceneId): void {
    // 预先构建主园区，使首帧不空白
    if (id === 'park') {
      const g = this.getSet('park');
      this.setScene('park', { x: -12, z: 37 });
      g.visible = true;
    }
  }

  // ------------------------------------------------------------ 园区

  private buildPark(g: THREE.Group): void {
    // 地面
    const gt = groundTexture('#5a6353', '#3d4438', 130);
    gt.repeat.set(9, 9);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 160), new THREE.MeshLambertMaterial({ map: gt }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);

    // 园内道路
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 58), mat(0x6a7069));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, 0);
    road.receiveShadow = true;
    g.add(road);
    const roadIn = new THREE.Mesh(new THREE.PlaneGeometry(40, 7), mat(0x70766e));
    roadIn.rotation.x = -Math.PI / 2;
    roadIn.position.set(18, 0.02, 20);
    roadIn.receiveShadow = true;
    g.add(roadIn);

    this.buildPerimeter(g);
    this.buildTruck(g);
    this.buildKiosk(g);
    this.buildOffice(g);
    this.buildWarehouse(g);
    this.buildShed(g);
    this.buildMeshPen(g);
    this.buildToolShed(g);
    this.buildProps(g);
    this.buildBackdrop(g);
    this.buildParkPeople(g);
  }

  private buildPerimeter(g: THREE.Group): void {
    const wallM = this.fenceWallMaterial();
    // 北墙
    box(g, 78, 3, 0.8, wallM, 8, 1.5, -34.4);
    // 东西墙
    box(g, 0.8, 3, 66, wallM, -30.4, 1.5, -2);
    box(g, 0.8, 3, 66, wallM, 46.4, 1.5, -2);
    // 南墙（留门洞）
    box(g, 26, 2.6, 0.8, wallM, -17, 1.3, 30.4);
    box(g, 42, 2.6, 0.8, wallM, 25, 1.3, 30.4);
    // 门柱 + 锈红门牌
    for (const px of [-4.2, 4.2]) {
      box(g, 1.1, 3.4, 1.1, C.concreteDark, px, 1.7, 30.2);
      box(g, 0.9, 0.5, 0.12, C.rust, px, 2.6, 30.9);
    }
    const sign = canvasTexture(256, 64, (c) => {
      c.fillStyle = '#8f4a2e'; c.fillRect(0, 0, 256, 64);
      c.fillStyle = '#e8e0cf'; c.font = 'bold 30px "Noto Sans CJK SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('永和物流园', 128, 34);
    });
    textBoard(g, 6.4, 1.6, sign, 0, 3.3, 30.15, Math.PI);
    // 门侧防撞混凝土墩
    box(g, 1.6, 0.6, 0.9, C.concreteDark, -9, 0.3, 33.5);
    box(g, 1.6, 0.6, 0.9, C.concreteDark, 6, 0.3, 33.5);
  }

  private fenceWallMaterial(): THREE.MeshLambertMaterial {
    const tex = canvasTexture(256, 128, (c) => {
      c.fillStyle = '#9aa096'; c.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 26; i++) {
        c.fillStyle = i % 2 ? 'rgba(120,80,50,0.13)' : 'rgba(60,70,62,0.15)';
        const y = Math.random() * 128;
        c.fillRect(Math.random() * 256, y, 8 + Math.random() * 40, 12 + Math.random() * 40);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    return new THREE.MeshLambertMaterial({ map: tex });
  }

  private buildTruck(g: THREE.Group): void {
    const truck = makeTruck();
    truck.position.set(-12, 0, 34.5);
    truck.rotation.y = 0;
    g.add(truck);
    aoPatch(g, 9.4, 3.6, -12, 34.5, 0.5);
  }

  private buildKiosk(g: THREE.Group): void {
    const k = new THREE.Group();
    k.position.set(-22.6, 0, 33); // 园区大门外（原文：大门外的废弃收发亭）
    box(k, 2.6, 2.5, 2.2, mat(0x8a8f85), 0, 1.25, 0);
    box(k, 2.9, 0.16, 2.5, mat(C.roofGrey), 0, 2.62, 0);
    aoPatch(k, 3.6, 3.2, 0, 0, 0.4);
    // 拆掉的窗户（黑洞）
    box(k, 1.6, 0.9, 0.06, 0x1c1f1d, 0, 1.4, 1.12).castShadow = false;
    // 破花盆
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      cyl(k, 0.16, 0.2, 0x8a5a3d, 1.5 + Math.cos(a) * 0.5, 0.1, -1.0 + Math.sin(a) * 0.5);
    }
    g.add(k);
  }

  private buildOffice(g: THREE.Group): void {
    const o = new THREE.Group();
    o.position.set(-18, 0, 2);
    box(o, 10.4, 5, 8.4, this.fadedWall(), 0, 2.5, 0);
    box(o, 10.8, 0.4, 8.8, C.roofGrey, 0, 5.15, 0);
    aoPatch(o, 11.8, 9.6, 0, 0, 0.42);
    // 南面窗户与玻璃门
    for (let i = 0; i < 3; i++) {
      box(o, 1.5, 1.2, 0.08, 0x39424a, -3 + i * 3, 3.4, 4.25).castShadow = false;
    }
    box(o, 1.7, 2.3, 0.08, 0x2d353c, 0, 1.15, 4.25).castShadow = false;
    // 征用通知（可阅读牌） + 手绘仓位表
    const notice = canvasTexture(256, 320, (c) => {
      c.fillStyle = '#e5e0d2'; c.fillRect(0, 0, 256, 320);
      c.fillStyle = '#8a3830'; c.font = 'bold 26px "Noto Sans CJK SC", sans-serif';
      c.fillText('临时征用通知', 24, 44);
      c.fillStyle = '#3c3c38'; c.font = '15px "Noto Sans CJK SC", sans-serif';
      const lines = ['即日起本园区改作', '应急物料周转场。', '各仓位台账以现场', '张贴为准，原租赁', '及出入权限暂停。', '', '　　　（盖章）'];
      lines.forEach((l, i) => c.fillText(l, 22, 84 + i * 26));
    });
    textBoard(o, 1.06, 1.32, notice, -1.6, 1.5, 4.3);
    const sketch = canvasTexture(256, 200, (c) => {
      c.fillStyle = '#ded6c2'; c.fillRect(0, 0, 256, 200);
      c.strokeStyle = '#4a4a44'; c.lineWidth = 2; c.strokeRect(14, 14, 228, 172);
      c.beginPath(); c.moveTo(128, 14); c.lineTo(128, 186); c.stroke();
      c.fillStyle = '#4a4a44'; c.font = '17px "Noto Sans CJK SC", sans-serif';
      c.fillText('北库：家居退货', 24, 66);
      c.fillText('南库：应急物料', 146, 66);
      c.fillStyle = '#8a3830';
      c.fillText('周转·安置', 146, 96);
    });
    textBoard(o, 1.28, 1.0, sketch, 0.6, 1.42, 4.3);
    g.add(o);
  }

  private fadedWall(): THREE.MeshLambertMaterial {
    const tex = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#c9c5b8'; c.fillRect(0, 0, 256, 256);
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

  private buildWarehouse(g: THREE.Group): void {
    const w = new THREE.Group();
    w.position.set(0, 0, -12); // 中心 (0,-12)，范围 x[-13,13], z[-19,-5]
    // 地坪
    box(w, 26.6, 0.14, 14.6, C.concrete, 0, 0.07, 0);
    // 北墙（高）东西墙（高）——南侧为矮胸墙（舞台切面，不遮视线）
    const wallM = this.fadedWall();
    box(w, 27, 5.4, 0.8, wallM, 0, 2.7, -7.4);
    box(w, 0.8, 5.4, 15.4, wallM, 13.1, 2.7, 0.1);
    box(w, 0.8, 5.4, 9.6, wallM, -13.1, 2.7, -2.2); // 西墙北段 z[-19,-9.4]
    box(w, 0.8, 5.4, 1.8, wallM, -13.1, 2.7, 6.1); // 西墙南段 z[-6.8,-5]，之间为侧门开口
    box(w, 26.6, 1.0, 0.5, wallM, 0, 0.5, 7.15); // 南胸墙
    // 高窗亮带
    for (let i = 0; i < 4; i++) {
      box(w, 2.4, 1.0, 0.1, mat(0xcfd9d6, { emissive: 0xcfd9d6, emissiveIntensity: 0.25 }), -9 + i * 6, 4.2, -7.0).castShadow = false;
    }
    // 变形侧门门板（开门动画用）
    const door = new THREE.Group();
    door.position.set(-13.1, 0, -12 - 8.1 + 12); // = (0,0,-8.1) 相对于世界的 ( -13.1, -8.1)
    door.position.z = 3.9; // 组内 z = 世界z + 12
    const doorP = box(door, 0.24, 2.3, 2.6, C.metalDark, 0.2, 1.15, 0, 0.08);
    doorP.castShadow = true;
    w.add(door);
    this.sideDoorMesh = door;
    w.userData.door = door;

    // 空货架（梁架，合并绘制）
    {
      const items: { w: number; h: number; d: number; c: number; x: number; y: number; z: number }[] = [];
      for (const sz of [-2.5, -5.5]) {
        for (let i = 0; i < 5; i++) items.push({ w: 0.18, h: 2.6, d: 0.18, c: C.metal, x: -9 + i * 3.4, y: 1.3, z: sz });
        items.push({ w: 16, h: 0.12, d: 1.1, c: C.metal, x: -2.2, y: 2.4, z: sz });
        items.push({ w: 16, h: 0.12, d: 1.1, c: C.metal, x: -2.2, y: 1.3, z: sz });
      }
      mergeColoredBoxes(w, items);
    }
    // 黄色货位框
    for (let i = 0; i < 6; i++) {
      const fx = -6.5 + i * 2.6;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.6), mat(0xc2a44a));
      frame.rotation.x = -Math.PI / 2;
      frame.position.set(fx, 0.15, 0.2);
      w.add(frame);
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.3), mat(C.concrete));
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(fx, 0.16, 0.2);
      w.add(inner);
    }
    // 立柱 + 转位单塑料袋
    cyl(w, 0.16, 3.4, C.concreteDark, 4, 1.7, 3.0);
    cyl(w, 0.16, 3.4, C.concreteDark, 8, 1.7, -3.5);
    const slip = canvasTexture(128, 160, (c) => {
      c.fillStyle = 'rgba(226,222,208,0.92)'; c.fillRect(0, 0, 128, 160);
      c.strokeStyle = 'rgba(90,110,180,0.9)'; c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        c.moveTo(14, 30 + i * 20);
        c.bezierCurveTo(40, 26 + i * 20, 70, 34 + i * 20, 114, 30 + i * 20);
      }
      c.stroke();
      c.fillStyle = 'rgba(60,60,60,0.8)'; c.font = '11px sans-serif';
      c.fillText('转位 · 复写', 40, 148);
    });
    textBoard(w, 0.42, 0.54, slip, 4.02, 1.5, 3.2);

    // 床单隔断区
    const sheetM = new THREE.MeshLambertMaterial({ map: groundTexture('#d8d4c8', '#b8b4a4', 30), side: THREE.DoubleSide });
    sheetM.map!.repeat.set(2, 1);
    const sh1 = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4), sheetM);
    sh1.position.set(8.2, 1.2, -3.4);
    w.add(sh1);
    const sh2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), sheetM.clone());
    sh2.position.set(6.2, 1.2, -4.9);
    sh2.rotation.y = Math.PI / 2;
    w.add(sh2);
    box(w, 4.4, 0.05, 0.06, 0x6a5a40, 8.2, 2.42, -3.4); // 打包带绳
    // 拖鞋一双、折叠桌与纸杯
    box(w, 0.12, 0.05, 0.3, 0x5a6a72, 5.5, 0.05, -3.0);
    box(w, 0.12, 0.05, 0.3, 0x5a6a72, 5.7, 0.05, -3.05);
    box(w, 0.85, 0.06, 0.5, C.metal, 6.9, 0.72, -2.6);
    box(w, 0.06, 0.72, 0.06, C.metalDark, 6.55, 0.36, -2.75);
    box(w, 0.06, 0.72, 0.06, C.metalDark, 7.25, 0.36, -2.45);
    for (let i = 0; i < 5; i++) cyl(w, 0.045, 0.09, 0xe4e0d2, 6.6 + i * 0.16, 0.8, -2.6).castShadow = false;
    // 滞留者：坐着的男人 + 躺着的母亲
    const man = makePerson({ coat: 0x8f8f8a, pants: 0x6a6a66, scale: 0.95 });
    man.position.set(9.0, 0, -4.2);
    man.scale.y = 0.62; // 坐地姿态
    man.rotation.y = Math.PI + 0.5;
    w.add(man);
    const motherMat = 0x7e8896;
    box(w, 0.55, 0.3, 1.0, 0x9a8d80, 8.6, 0.24, -5.4); // 地铺
    box(w, 0.5, 0.24, 0.9, motherMat, 8.6, 0.48, -5.45); // 被中身形
    sph(w, 0.13, 0xd8b89a, 8.6, 0.44, -4.95);

    // 假环境光阴影 + 人物脚下贴片 + 库内浮尘
    aoPatch(w, 28, 1.8, 0, -6.7, 0.38);
    aoPatch(w, 1.8, 15.6, -12.6, 0.1, 0.36);
    aoPatch(w, 1.8, 15.6, 12.6, 0.1, 0.36);
    aoPatch(w, 1.1, 1.1, 9, -4.2, 0.3);
    aoPatch(w, 1.3, 1.5, 8.6, -5.4, 0.28);
    this.addDust(w, 90, { x: [-12, 12], y: [0.4, 4.4], z: [-6.5, 6.5] });

    g.add(w);
  }

  private addDust(parent: THREE.Object3D, count: number, r: { x: [number, number]; y: [number, number]; z: [number, number] }): void {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = r.x[0] + Math.random() * (r.x[1] - r.x[0]);
      pos[i * 3 + 1] = r.y[0] + Math.random() * (r.y[1] - r.y[0]);
      pos[i * 3 + 2] = r.z[0] + Math.random() * (r.z[1] - r.z[0]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xd8d4c4, size: 0.06, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true
    }));
    parent.add(pts);
    this.dusts.push(pts);
  }

  private buildShed(g: THREE.Group): void {
    const s = new THREE.Group();
    s.position.set(26, 0, -5);
    // 四柱 + 半透明条纹棚顶
    for (const [px, pz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]] as const) {
      cyl(s, 0.18, 4.4, C.metalDark, px, 2.2, pz);
    }
    const roofM = new THREE.MeshLambertMaterial({ color: 0x88908a, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 9.6), roofM);
    roof.rotation.x = -Math.PI / 2 + 0.09;
    roof.position.y = 4.5;
    s.add(roof);
    // 托盘：受潮组（塌陷灰）与干燥组（完好）——合并绘制
    {
      const items: { w: number; h: number; d: number; c: number; x: number; y: number; z: number; ry?: number }[] = [];
      for (let i = 0; i < 3; i++) {
        const px = -5.2 + i * 1.9;
        items.push({ w: 1.4, h: 0.12, d: 1.4, c: PALLET, x: px, y: 0.06, z: -2.2 });
        items.push({ w: 1.24, h: 0.7, d: 1.24, c: 0x6f6a60, x: px, y: 0.47, z: -2.2 });
        items.push({ w: 1.3, h: 0.5, d: 1.3, c: 0x5d5850, x: px, y: 0.95, z: -2.2, ry: 0.1 });
      }
      for (let i = 0; i < 3; i++) {
        const px = 1.4 + i * 1.9;
        items.push({ w: 1.4, h: 0.12, d: 1.4, c: PALLET, x: px, y: 0.06, z: -2.0 });
        items.push({ w: 1.26, h: 0.85, d: 1.26, c: 0x8a7a56, x: px, y: 0.55, z: -2.0 });
        items.push({ w: 1.26, h: 0.85, d: 1.26, c: 0x84744f, x: px, y: 1.38, z: -2.0, ry: 0.06 });
        for (let k = 0; k < 3; k++) cyl(s, 0.14, 0.3, 0xb9c2c8, px - 0.3 + k * 0.3, 1.98, -2.0);
      }
      mergeColoredBoxes(s, items);
    }
    // 潮湿标记牌（验收后由事件点亮 → 此处默认暗）
    const tag = canvasTexture(256, 64, (c) => {
      c.fillStyle = '#5f8448'; c.fillRect(0, 0, 256, 64);
      c.fillStyle = '#eef0e4'; c.font = 'bold 26px "Noto Sans CJK SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('合格批次 → 装车', 128, 34);
    });
    const tagMesh = textBoard(s, 2.2, 0.55, tag, 3.3, 2.6, -1.6);
    tagMesh.visible = false;
    this.passTagMesh = tagMesh;
    s.userData.passTag = tagMesh;

    // 通道积水
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 3.4),
      new THREE.MeshLambertMaterial({ color: 0x39454a, transparent: true, opacity: 0.85 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(-9.6, 0.03, 1.6);
    s.add(water);
    aoPatch(s, 9, 3.6, 0.6, -2.1, 0.32);
    this.addDust(s, 40, { x: [-7, 7], y: [0.5, 3.6], z: [-4, 4] });
    g.add(s);
  }

  private buildMeshPen(g: THREE.Group): void {
    const p = new THREE.Group();
    p.position.set(40, 0, -6);
    // 网格围栏
    const meshTex = canvasTexture(128, 128, (c) => {
      c.clearRect(0, 0, 128, 128);
      c.strokeStyle = 'rgba(150,158,164,0.9)'; c.lineWidth = 2.5;
      for (let i = -128; i < 256; i += 16) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 128, 128); c.stroke();
        c.beginPath(); c.moveTo(i + 128, 0); c.lineTo(i, 128); c.stroke();
      }
    });
    meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
    meshTex.repeat.set(3, 1);
    const meshM = new THREE.MeshLambertMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide });
    const mk = (w: number, h: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), meshM);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      p.add(m);
    };
    mk(6.2, 2.5, -3, 0, Math.PI / 2); // 西侧门网
    mk(6.6, 2.5, 0, -2.6, 0);
    mk(6.6, 2.5, 0, 2.6, 0);
    mk(6.2, 2.5, 3, 0, Math.PI / 2);
    // 折叠床与坐姿人员
    box(p, 1.9, 0.3, 0.8, mat(0x707a70), 0.8, 0.3, -1.4);
    const sitter = makePerson({ coat: 0x5d6a72, pants: 0x44484a, scale: 0.95 });
    sitter.position.set(-0.6, 0.3, -1.3);
    sitter.scale.y = 0.7;
    sitter.rotation.y = -Math.PI / 2 + 0.3;
    p.add(sitter);
    // 门外倒扣的饭盒与饭粒
    cyl(p, 0.11, 0.07, 0xb9c2c8, -3.8, 0.05, 0.6, { rx: Math.PI });
    for (let i = 0; i < 4; i++) sph(p, 0.02, 0xd8d2c0, -3.6 + Math.random() * 0.3, 0.03, 0.9 + Math.random() * 0.3);
    aoPatch(p, 1.1, 1.1, -0.6, -1.3, 0.3);
    aoPatch(p, 7.2, 6.2, 0, 0, 0.3);
    g.add(p);
  }

  private buildToolShed(g: THREE.Group): void {
    const t = new THREE.Group();
    t.position.set(-17, 0, 34);
    box(t, 3.2, 2.2, 2.6, mat(0x5d6a58), 0, 1.1, 0);
    box(t, 3.5, 0.18, 2.9, mat(C.roofGrey), 0, 2.28, 0);
    aoPatch(t, 4.0, 3.4, 0.5, 0.3, 0.42);
    box(t, 0.9, 1.6, 0.08, 0x39413a, 0.6, 0.8, 1.34).castShadow = false;
    // 工具笼（返程安置用）
    box(t, 1.2, 0.1, 1.2, C.metalDark, 2.4, 0.05, 0.6);
    for (const [cx, cz] of [[1.85, 0.05], [2.95, 0.05], [1.85, 1.15], [2.95, 1.15]] as const) {
      box(t, 0.05, 0.9, 0.05, C.metalDark, cx, 0.5, cz);
    }
    g.add(t);
  }

  private buildProps(g: THREE.Group): void {
    // 路灯（灯罩夜间发光）
    for (const [lx, lz] of [[-6, 24], [10, 8], [18, -2], [-20, 14]] as const) {
      cyl(g, 0.09, 4.2, C.metalDark, lx, 2.1, lz);
      box(g, 0.5, 0.14, 0.3, C.metalDark, lx + 0.25, 4.24, lz);
      const lamp = sph(g, 0.14, mat(C.amber, { emissive: C.amber, emissiveIntensity: 0 }), lx + 0.42, 4.1, lz);
      lamp.castShadow = false;
      this.lampGlow.push(lamp);
    }
    const pl1 = new THREE.PointLight(0xd9a05b, 0, 15, 2);
    pl1.position.set(10, 4, 8);
    g.add(pl1);
    this.lampLights.push(pl1);
    const pl2 = new THREE.PointLight(0xd9a05b, 0, 14, 2);
    pl2.position.set(-4, 3.6, 28);
    g.add(pl2);
    this.lampLights.push(pl2);

    // 散落纸箱与木板（合并绘制）
    {
      const items: { w: number; h: number; d: number; c: number; x: number; y: number; z: number; ry?: number }[] = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          w: 0.5 + Math.random() * 0.4, h: 0.4, d: 0.5, c: 0x8a7a5c,
          x: -26 + Math.random() * 24, y: 0.2, z: 14 + Math.random() * 12, ry: Math.random()
        });
      }
      mergeColoredBoxes(g, items);
    }
    // 反光锥
    for (const [cx, cz] of [[-6.4, 32.4], [-2.2, 32.6]] as const) {
      cyl(g, 0.16, 0.5, 0xc05a35, cx, 0.25, cz);
      cyl(g, 0.1, 0.12, 0xe4e0d2, cx, 0.4, cz);
    }
    // 绿篱
    for (const [hx, hz, hw] of [[14, 27.5, 16], [-8, -24, 10], [-23, -8, 0.1]] as const) {
      if (hw < 1) continue;
      const hedge = box(g, hw, 1.1, 1.2, 0x4a5a3e, hx, 0.55, hz);
      hedge.castShadow = true;
    }
  }

  private buildBackdrop(g: THREE.Group): void {
    // 北侧住宅与远处厂房（轮廓层）
    for (let i = 0; i < 4; i++) {
      const h = 10 + (i % 2) * 5;
      const b = box(g, 9, h, 7, mat(0x6f7672 - i * 0x050505), -34 + i * 22, h / 2, -48);
      b.castShadow = false;
      // 零星窗光
      if (i % 2 === 0) {
        box(b, 0.5 / 9, 0.5 / h, 0.06, mat(0xd9a05b, { emissive: 0xd9a05b, emissiveIntensity: 0.7 }), 0.3, 0.1, 0.51);
      }
    }
    // 厂房 + 烟囱 + 烟气
    const fb = box(g, 16, 9, 10, mat(0x757b76), 56, 4.5, -42);
    fb.castShadow = false;
    cyl(g, 0.9, 14, 0x6a6058, 62, 7, -47);
    for (let i = 0; i < 6; i++) {
      const sm = sph(g, 0.8, new THREE.MeshLambertMaterial({ color: 0xaab0ab, transparent: true, opacity: 0.3 }), 62, 14 + i * 1.6, -47);
      sm.castShadow = false;
      this.smokes.push(sm);
    }
    // 铁路与装甲列车
    box(g, 180, 0.24, 1.6, 0x4d4a45, 5, 0.12, -44.5).castShadow = false;
    box(g, 180, 0.08, 0.14, 0x8f979e, 5, 0.28, -44.9).castShadow = false;
    box(g, 180, 0.08, 0.14, 0x8f979e, 5, 0.28, -44.1).castShadow = false;
    const train = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const car = box(train, 6.4, 2.2, 2.0, mat(i === 0 ? 0x4a5a50 : 0x3f4f46), i * -7.0, 1.35, 0);
      car.castShadow = false;
      box(train, 6.5, 0.5, 2.04, 0x2f3b34, i * -7.0, 0.5, 0).castShadow = false;
      for (let wdi = 0; wdi < 2; wdi++) {
        box(train, 0.7, 0.5, 0.06, mat(0xb9c4c0, { emissive: 0xb9c4c0, emissiveIntensity: 0.25 }), i * -7.0 + 1.2 - wdi * 2.4, 1.6, 1.04).castShadow = false;
      }
    }
    train.position.set(0, 0, -44.5);
    g.add(train);
    this.train = train;
    // 背景人行
    for (let i = 0; i < 2; i++) {
      const w0 = makePerson({ coat: i ? 0x7a6a4f : 0x4f5f6f, scale: 0.92 });
      w0.position.set(-20 + i * 30, 0, -38.5);
      g.add(w0);
      this.walkers.push({ g: w0, from: -42, to: 46, speed: i ? 1.1 : -0.9, z: -38.5 });
    }
    // 背景环卫车（城市仍在运转）
    const dump = new THREE.Group();
    box(dump, 3.2, 1.5, 1.7, 0x6f8a3f, 0, 1.05, 0);
    box(dump, 1.0, 1.1, 1.6, 0x5d7434, 1.8, 0.85, 0);
    dump.position.set(18, 0, 41.5);
    g.add(dump);
  }

  private buildParkPeople(g: THREE.Group): void {
    const laocheng = makePerson({ coat: 0x3d4d66, pants: 0x35383c, cap: 0x2d3a4e });
    laocheng.position.set(-15.2, 0, 33.2);
    laocheng.rotation.y = 2.2;
    g.add(laocheng);
    g.userData.laocheng = laocheng;
    this.npcLao = laocheng;
    const worker = makePerson({ coat: 0x7a6a4f, pants: 0x4a4d50, vest: 0xd07a35 });
    worker.position.set(-9.5, 0, 33.4);
    worker.rotation.y = -2.4;
    g.add(worker);
    g.userData.worker = worker;
    this.npcWorker = worker;
    const dupin = makePerson({ coat: 0x6b4f3f, pants: 0x3d4145 });
    dupin.position.set(-8.2, 0.85, 34.5);
    dupin.scale.setScalar(0.96);
    dupin.scale.y = 0.7; // 坐驾驶室
    dupin.rotation.y = Math.PI / 2;
    g.add(dupin);
    aoPatch(g, 1, 1, -15.2, 33.2, 0.32);
    aoPatch(g, 1, 1, -9.5, 33.4, 0.32);

    // 医疗车组（初始隐藏，C01-05 后出现）
    const med = new THREE.Group();
    const van = makeVan();
    med.add(van);
    const m1 = makePerson({ coat: 0xe8e8e4, pants: 0xd8d8d4 });
    m1.position.set(3.6, 0, -1.6);
    m1.rotation.y = 1.4;
    med.add(m1);
    const m2 = makePerson({ coat: 0xe8e8e4, pants: 0xd8d8d4 });
    m2.position.set(-3.2, 0, 1.7);
    m2.rotation.y = -1.2;
    med.add(m2);
    med.position.set(4, 0, 33.2);
    med.visible = false;
    g.add(med);
    this.medVanGroup = med;
    g.userData.med = med;
    aoPatch(g, 6.2, 3.0, 4, 33.2, 0.45);
  }

  /** NPC 站位随剧情推进（阶段 = 已完成节点数） */
  setNpcStage(n: number): void {
    if (!this.npcLao || !this.npcWorker) return;
    const put = (g: THREE.Group, x: number, z: number, ry: number) => {
      g.position.set(x, 0, z);
      g.rotation.y = ry;
    };
    if (n < 4) {
      put(this.npcLao, -15.2, 33.2, 2.2);
      put(this.npcWorker, -9.5, 33.4, -2.4);
    } else if (n < 6) {
      // 侧门已开：老程守门，装卸工挪工具进库
      put(this.npcLao, -14.9, -6.9, 1.35);
      put(this.npcWorker, -11.4, -9.4, -1.3);
    } else if (n === 6) {
      // 呼叫医护后：老程守南库口，装卸工去雨棚
      put(this.npcLao, -13.8, -4.3, 3.0);
      put(this.npcWorker, 20.6, -2.6, -0.7);
    } else if (n === 7) {
      // 网门观察：装卸工在通道另一头
      put(this.npcLao, -13.8, -4.3, 3.0);
      put(this.npcWorker, 24, -1.6, -2.2);
    } else {
      // 返程交接：都在车旁
      put(this.npcLao, -13.6, 33.2, 2.0);
      put(this.npcWorker, -10.6, 33.1, 2.6);
    }
  }

  private parkPhysics(ctx: PhysCtx): void {
    // 单一来源：mapdata.PARK_WALLS（测试用同一份数据校验可达性）
    for (const w of PARK_WALLS) this.addWall(ctx, w.x, w.z, w.hx, w.hz, w.h ?? 3, w.name);
  }

  // ------------------------------------------------------------ 物资站（压缩场景）

  private buildDepot(g: THREE.Group): void {
    const gt = groundTexture('#67645a', '#4a483e', 90);
    gt.repeat.set(5, 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 46), new THREE.MeshLambertMaterial({ map: gt }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    // 物资站简屋 + 招牌
    const st = new THREE.Group();
    st.position.set(-12, 0, -10);
    box(st, 12, 4, 6.4, this.fadedWall(), 0, 2, 0);
    box(st, 12.4, 0.3, 6.8, C.roofGrey, 0, 4.12, 0);
    aoPatch(st, 13, 7.6, 0, 0, 0.4);
    box(st, 2.0, 2.4, 0.1, 0x39413a, -2.5, 1.2, 3.28).castShadow = false;
    const sign = canvasTexture(384, 64, (c) => {
      c.fillStyle = '#4a4d48'; c.fillRect(0, 0, 384, 64);
      c.fillStyle = '#e8e0cf'; c.font = 'bold 30px "Noto Sans CJK SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('社区物资站（临时）', 192, 34);
    });
    textBoard(st, 5, 0.84, sign, 0, 3.2, 3.3);
    g.add(st);
    // 交接桌与工具箱
    box(g, 2.2, 0.08, 0.9, C.wood, -4, 0.86, 2.5);
    box(g, 0.08, 0.86, 0.08, C.metalDark, -4.9, 0.43, 2.2);
    box(g, 0.08, 0.86, 0.08, C.metalDark, -3.1, 0.43, 2.8);
    box(g, 0.7, 0.4, 0.4, 0x6a4f38, -4.3, 1.08, 2.5); // 工具箱
    box(g, 1.1, 0.07, 0.09, C.metalDark, -3.5, 1.0, 2.4, 0.12); // 归还的撬棍
    // 排队护栏
    for (const bx of [-1, 1.6]) {
      cyl(g, 0.06, 0.9, C.metalDark, bx, 0.45, 3.4);
      cyl(g, 0.06, 0.9, C.metalDark, bx, 0.45, 5.4);
      box(g, 0.04, 0.04, 2.1, 0x8a5a4f, bx, 0.8, 4.4);
    }
    // 卡车（送抵）与托盘
    const truck = makeTruck();
    truck.position.set(9, 0, 3);
    truck.rotation.y = Math.PI;
    g.add(truck);
    aoPatch(g, 9.4, 3.6, 9, 3, 0.5);
    for (let i = 0; i < 2; i++) {
      box(g, 1.4, 0.12, 1.4, PALLET, 12.4 + i * 1.8, 0.06, -1.5);
      box(g, 1.26, 0.8, 1.26, 0x8a7a56, 12.4 + i * 1.8, 0.52, -1.5);
    }
    for (let k = 0; k < 4; k++) cyl(g, 0.14, 0.3, 0xb9c2c8, 11.9 + k * 0.4, 1.1, -1.5);
    // 食品厂卸货门（背板 + 半开卷帘 + 暖光内口 + 传送带罐列）
    const f = new THREE.Group();
    f.position.set(8, 0, -14);
    box(f, 22, 7, 1.0, this.fadedWall(), 0, 3.5, 0);
    aoPatch(f, 23, 2.4, 0, 0.9, 0.42);
    // 门洞
    box(f, 6.0, 4.4, 1.06, 0x14161a, 0, 2.2, 0.02).castShadow = false;
    box(f, 5.8, 0.5, 1.1, mat(0xd9a05b, { emissive: 0xd98a3b, emissiveIntensity: 0.55 }), 0, 0.6, 0.06).castShadow = false;
    // 卷闸门半幅
    for (let i = 0; i < 3; i++) {
      box(f, 6.2, 0.62, 0.12, mat(0x8f979e), 0, 4.7 + i * 0.62, 0.62);
    }
    // 传送带 + 罐列
    box(f, 4.6, 0.35, 0.9, 0x2d3134, 0, 1.0, 0.8);
    for (let i = 0; i < 6; i++) cyl(f, 0.13, 0.32, 0xc6ccd2, -1.8 + i * 0.62, 1.34, 0.8).castShadow = false;
    const fsign = canvasTexture(320, 56, (c) => {
      c.fillStyle = '#3c4a40'; c.fillRect(0, 0, 320, 56);
      c.fillStyle = '#dfe4d4'; c.font = 'bold 26px "Noto Sans CJK SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('食品厂 · 2 号卸货口', 160, 30);
    });
    textBoard(f, 5.4, 0.95, fsign, 0, 6.1, 0.56);
    g.add(f);
    // 人物：检验员、登记员、杜平、老程、邻居×2
    const inspector = makePerson({ coat: 0xe0e0da, pants: 0x5d6a72 });
    inspector.position.set(3.4, 0, -9.4);
    inspector.rotation.y = Math.PI - 0.4;
    g.add(inspector);
    const clerk = makePerson({ coat: 0x7d8a6a, pants: 0x4a4d50 });
    clerk.position.set(-4.4, 0, 1.4);
    clerk.rotation.y = Math.PI;
    g.add(clerk);
    const dupin = makePerson({ coat: 0x6b4f3f, pants: 0x3d4145 });
    dupin.position.set(10.5, 0, 6.8);
    dupin.rotation.y = -2.2;
    g.add(dupin);
    const laocheng = makePerson({ coat: 0x3d4d66, pants: 0x35383c, cap: 0x2d3a4e });
    laocheng.position.set(-2.2, 0, 3.4);
    laocheng.rotation.y = 2.8;
    g.add(laocheng);
    const n1 = makePerson({ coat: 0x7a6a5a });
    n1.position.set(0.3, 0, 4.6);
    n1.rotation.y = Math.PI;
    g.add(n1);
    const n2 = makePerson({ coat: 0x5f6a7a });
    n2.position.set(1.8, 0, 5.2);
    n2.rotation.y = Math.PI + 0.4;
    g.add(n2);
    for (const [px, pz] of [[3.4, -9.4], [-4.4, 1.4], [10.5, 6.8], [-2.2, 3.4], [0.3, 4.6], [1.8, 5.2]] as const) {
      aoPatch(g, 1, 1, px, pz, 0.3);
    }
    // 工具棚与工具笼（灰灰）
    const shed = new THREE.Group();
    shed.position.set(-14.5, 0, 6);
    box(shed, 3.0, 2.0, 2.4, mat(0x5d6a58), 0, 1.0, 0);
    box(shed, 3.3, 0.16, 2.7, mat(C.roofGrey), 0, 2.08, 0);
    g.add(shed);
    // 墙外氛围：护栏外住宅剪影
    for (let i = 0; i < 3; i++) {
      const h = 9 + i * 3;
      box(g, 8, h, 6, mat(0x666d69), -24 + i * 24, h / 2, -26).castShadow = false;
    }
  }

  private depotPhysics(ctx: PhysCtx): void {
    const W = (cx: number, cz: number, hx: number, hz: number) => this.addWall(ctx, cx, cz, hx, hz, 3);
    W(0, -23, 32, 0.5);
    W(0, 23, 32, 0.5);
    W(-31, 0, 0.5, 23);
    W(31, 0, 0.5, 23);
    this.addWall(ctx, -12, -10, 6.4, 3.4, 4);
    this.addWall(ctx, 8, -14.4, 11.4, 0.7, 7);
    this.addWall(ctx, 9, 3, 4.3, 1.45, 2);
    this.addWall(ctx, -14.5, 6, 1.8, 1.4, 2);
    this.addWall(ctx, 13.3, -1.5, 2.2, 1.0, 1.2);
    this.addWall(ctx, -4, 2.5, 1.2, 0.5, 1);
  }

  // ------------------------------------------------------------ 观察点（压缩场景）

  private buildQuarantine(g: THREE.Group): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 20), mat(0x3d413e));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    // 小屋：木地板 + 三面墙（切面）
    box(g, 9, 0.1, 6.5, mat(0x7a6a52), 0, 0.05, 0);
    const wallT = canvasTexture(256, 128, (c) => {
      c.fillStyle = '#b9b0a0'; c.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 10; i++) {
        c.fillStyle = 'rgba(120,110,95,0.15)';
        c.fillRect(Math.random() * 256, Math.random() * 128, 30, 12);
      }
    });
    const wallM = new THREE.MeshLambertMaterial({ map: wallT });
    box(g, 9.2, 2.9, 0.4, wallM, 0, 1.45, -3.25);
    box(g, 0.4, 2.9, 6.6, wallM, -4.6, 1.45, 0);
    box(g, 0.4, 2.9, 6.6, wallM, 4.6, 1.45, 0);
    // 窗（外面是夜色与垃圾分类亭剪影）
    const winM = mat(0x1b2636, { emissive: 0x2c3d58, emissiveIntensity: 0.35 });
    box(g, 2.0, 1.2, 0.44, winM, -1.6, 1.7, -3.24).castShadow = false;
    box(g, 0.5, 0.7, 0.5, 0x2c332e, -1.9, 1.4, -3.7).castShadow = false;
    box(g, 0.4, 0.5, 0.44, 0x39423a, -1.2, 1.32, -3.7).castShadow = false;
    // 两张床
    for (const bx of [-2.4, 2.4]) {
      box(g, 2.2, 0.35, 1.0, C.wood, bx, 0.3, 1.8);
      box(g, 2.0, 0.16, 0.9, 0x9aa4b0, bx, 0.55, 1.8);
      box(g, 0.5, 0.12, 0.6, 0xd8d4c8, bx - 0.6, 0.68, 1.8);
      aoPatch(g, 2.7, 1.5, bx, 1.8, 0.42);
    }
    // 小桌与手机
    box(g, 0.9, 0.66, 0.6, C.wood, 1.4, 0.33, -0.6);
    const phone = box(g, 0.16, 0.02, 0.3, mat(0x22262a, { emissive: 0x7ca7d8, emissiveIntensity: 0.9 }), 1.4, 0.68, -0.6);
    phone.castShadow = false;
    // 顶灯
    const lamp = sph(g, 0.14, mat(0xf4e6c4, { emissive: 0xf4d89a, emissiveIntensity: 0.9 }), 0, 2.8, 0);
    lamp.castShadow = false;
    const pl = new THREE.PointLight(0xf0d8a0, 0, 12, 2);
    pl.position.set(0, 2.6, 0);
    g.add(pl);
    this.lampLights.push(pl);
    // 观察点人员
    const medic = makePerson({ coat: 0xe8e4da, pants: 0x5d6a72 });
    medic.position.set(-3.4, 0, -1.6);
    medic.rotation.y = 1.9;
    g.add(medic);
    aoPatch(g, 1, 1, -3.4, -1.6, 0.3);
    // 门口号码牌
    const tagg = canvasTexture(128, 48, (c) => {
      c.fillStyle = '#5a6157'; c.fillRect(0, 0, 128, 48);
      c.fillStyle = '#e0dcc8'; c.font = 'bold 20px "Noto Sans CJK SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('观察点 3', 64, 26);
    });
    textBoard(g, 1.1, 0.42, tagg, 3.6, 1.9, 3.28, Math.PI);
  }

  private quarantinePhysics(ctx: PhysCtx): void {
    const W = (cx: number, cz: number, hx: number, hz: number) => this.addWall(ctx, cx, cz, hx, hz, 3);
    W(0, -3.4, 4.8, 0.4);
    W(-4.7, 0, 0.4, 3.6);
    W(4.7, 0, 0.4, 3.6);
    W(-2.8, 3.4, 2.0, 0.4); // 南墙缺口为门
    W(2.8, 3.4, 2.0, 0.4);
    W(0, 9.5, 12, 0.5);
    W(0, -9, 12, 0.5);
    W(-11.5, 0, 0.5, 9);
    W(11.5, 0, 0.5, 9);
    this.addWall(ctx, -2.4, 1.8, 1.2, 0.6, 0.7);
    this.addWall(ctx, 1.4, -0.6, 0.5, 0.36, 0.7);
  }

  // ------------------------------------------------------------ 小区门口（压缩场景）

  private buildGate(g: THREE.Group): void {
    const gt = groundTexture('#6a6d63', '#4e5248', 80);
    gt.repeat.set(5, 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 46), new THREE.MeshLambertMaterial({ map: gt }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    // 道路
    const road = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), mat(0x5d615c));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, 9);
    road.receiveShadow = true;
    g.add(road);
    // 栏杆门 + 岗亭，小区楼剪影
    box(g, 0.5, 1.2, 0.5, 0xc0b8a8, -1.8, 0.6, -3);
    box(g, 0.5, 1.2, 0.5, 0xc0b8a8, 3.0, 0.6, -3);
    const arm = box(g, 4.6, 0.14, 0.14, 0xd8d2c2, 0.6, 1.15, -3);
    arm.rotation.z = 0.42; // 半抬放行
    box(g, 4.64, 0.05, 0.16, 0xc0503f, 0.6, 1.15, -3).rotation.z = 0.42;
    box(g, 2.4, 2.6, 2.2, this.fadedWall(), 5.6, 1.3, -3.6);
    box(g, 2.7, 0.18, 2.5, C.roofGrey, 5.6, 2.7, -3.6);
    aoPatch(g, 3.4, 3.2, 5.6, -3.55, 0.4);
    box(g, 0.9, 0.9, 0.06, 0x39424a, 5.0, 1.5, -2.48).castShadow = false;
    // 围栏
    box(g, 9.4, 1.6, 0.4, C.concreteDark, -6.6, 0.8, -3.2);
    box(g, 9.4, 1.6, 0.4, C.concreteDark, 6.9, 0.8, -3.2);
    // 楼群
    for (let i = 0; i < 3; i++) {
      const h = 13 + (i % 2) * 4;
      const b = box(g, 9, h, 7, mat(0x8d8a80 - i * 0x060606), -16 + i * 13, h / 2, -13.5);
      b.castShadow = false;
    }
    // 树
    for (const [tx, tz] of [[-6, 5.6], [7.5, 5]] as const) {
      cyl(g, 0.16, 1.4, 0x6a563e, tx, 0.7, tz);
      sph(g, 0.9, 0x4f6144, tx, 1.9, tz);
      sph(g, 0.6, 0x596d4c, tx + 0.5, 2.3, tz + 0.2);
    }
    // 通知栏
    const bd = canvasTexture(192, 128, (c) => {
      c.fillStyle = '#6f6a58'; c.fillRect(0, 0, 192, 128);
      c.fillStyle = '#e0dcc8'; c.font = '15px "Noto Sans CJK SC", sans-serif';
      c.fillText('今日应急餐发放', 16, 34);
      c.fillText('观察点书面交接', 16, 62);
      c.fillText('复检按时到场', 16, 90);
    });
    textBoard(g, 1.7, 1.14, bd, -4.4, 1.3, -2.5, 0.5);
    // 人物：魏姐、值班员、两名邻居
    const weijie = makePerson({ coat: 0x7d6a8a, pants: 0x3d4145 });
    weijie.position.set(2.2, 0, -1.6);
    weijie.rotation.y = Math.PI - 0.3;
    g.add(weijie);
    const guard = makePerson({ coat: 0x5a6b53, pants: 0x3d4145, cap: 0x4a5b43 });
    guard.position.set(4.6, 0, -2.4);
    guard.rotation.y = Math.PI + 0.7;
    g.add(guard);
    const n1 = makePerson({ coat: 0x6a5a4a });
    n1.position.set(-0.8, 0, 0.4);
    n1.rotation.y = 0.4;
    g.add(n1);
    const n2 = makePerson({ coat: 0x51616b });
    n2.position.set(-1.9, 0, 0.9);
    n2.rotation.y = 0.7;
    g.add(n2);
  }

  private gatePhysics(ctx: PhysCtx): void {
    const W = (cx: number, cz: number, hx: number, hz: number, h = 3) => this.addWall(ctx, cx, cz, hx, hz, h);
    W(0, -22, 32, 0.5);
    W(0, 22, 32, 0.5);
    W(-31, 0, 0.5, 22);
    W(31, 0, 0.5, 22);
    W(-6.6, -3.2, 4.7, 0.3, 1.6);
    W(6.9, -3.2, 4.7, 0.3, 1.6);
    this.addWall(ctx, -1.8, -3, 0.35, 0.35, 1.2);
    this.addWall(ctx, 3.0, -3, 0.35, 0.35, 1.2);
    this.addWall(ctx, 0.6, -3.6, 2.4, 0.9, 1.2); // 栏杆通道不通行人（从岗侧绕）
    this.addWall(ctx, 5.6, -3.6, 1.35, 1.25, 2.8);
    this.addWall(ctx, -10.5, -13.5, 4.9, 3.9, 14);
    this.addWall(ctx, 2.5, -13.5, 4.9, 3.9, 14);
    this.addWall(ctx, 15.5, -13.5, 4.9, 3.7, 14);
    this.addWall(ctx, -6, 5.6, 0.3, 0.3, 1.4);
    this.addWall(ctx, 7.5, 5, 0.3, 0.3, 1.4);
  }

  // ------------------------------------------------------------ 状态同步与事件

  /** 读档后恢复世界外观 */
  syncFromState(state: GameState): void {
    const done = (id: string) => state.completed.includes(id);
    this.setDoorOpen(done('C01-03'), true);
    this.setMedArrived(done('C01-05'));
    this.setPalletsMarked(done('C01-06'));
    this.dogMode = 'hidden';
    if (done('C01-08')) this.dogMode = 'shed';
    else if (done('C01-01')) this.dogMode = 'follow';
    else this.dogMode = 'idle';
    this.placeDogByState(state);
    this.setNpcStage(state.completed.length);
    this.setLightMode(state.lightMode,
      state.scene === 'gate' ? 'dawn' : state.scene === 'quarantine' ? 'night' : state.scene === 'depot' ? 'dusk'
        : state.completed.length <= 4 ? 'dawn' : 'noon');
  }

  applyWorldEvent(ev: WorldEvent): void {
    switch (ev) {
      case 'open-side-door':
        this.setDoorOpen(true);
        this.dogMode = this.dogMode === 'follow' ? 'follow' : this.dogMode;
        break;
      case 'medical-arrive':
        this.setMedArrived(true);
        break;
      case 'mark-pallets':
        this.setPalletsMarked(true);
        break;
      case 'mesh-noted':
        break; // 仅上报，无视觉变化（行为含义未定）
      case 'dog-to-shed':
        this.dogMode = 'shed';
        this.placeDogByState();
        break;
    }
  }

  private setDoorOpen(open: boolean, instant = false): void {
    if (!this.sideDoorMesh) return;
    this.sideDoorMesh.userData.open = open;
    if (instant) {
      this.sideDoorMesh.rotation.y = open ? -1.35 : 0;
      this.sideDoorMesh.position.x = open ? -13.5 : -13.1;
    }
    if (open) this.removeNamedWall('side-door');
  }

  private setMedArrived(on: boolean): void {
    if (this.medVanGroup) this.medVanGroup.visible = on;
  }

  private setPalletsMarked(on: boolean): void {
    if (this.passTagMesh) this.passTagMesh.visible = on;
  }

  private placeDogByState(state?: GameState): void {
    if (this.dogMode === 'idle') {
      this.dog.position.set(-23.8, 0, 32.2); // 收发亭后（墙外）
      this.dog.rotation.y = 0.9;
    } else if (this.dogMode === 'shed') {
      this.dog.position.set(-15.4, 0, 33.2);
      this.dog.rotation.y = 2.6;
    } else if (this.dogMode === 'follow' && state) {
      this.dog.position.set(state.player.x - 2.5, 0, state.player.z - 2.5);
    }
  }

  setLightMode(mode: LightMode, autoPreset: LightPreset): void {
    const target = mode === 'auto' ? autoPreset : mode;
    const to = LIGHTS[target];
    this.light.from = { ...this.light.cur };
    this.light.to = { ...to };
    this.light.t = 0;
  }

  // ------------------------------------------------------------ 输入接口

  setMarker(x: number | null, z?: number): void {
    if (x === null) {
      this.marker.visible = false;
      this.markerTarget = null;
      return;
    }
    this.markerTarget = { x, z: z ?? 0 };
    this.marker.position.set(x, 0, z ?? 0);
    this.marker.visible = true;
  }

  getMarker(): { x: number; z: number } | null {
    return this.markerTarget;
  }

  playerPos(): { x: number; z: number } {
    return { x: this.phys.player.position.x, z: this.phys.player.position.z };
  }

  setPlayerPos(x: number, z: number): void {
    this.phys.player.position.x = x;
    this.phys.player.position.z = z;
  }

  screenToGround(cx: number, cy: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((cx - rect.left) / rect.width) * 2 - 1;
    const ny = -(((cy - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const out = new V();
    return this.raycaster.ray.intersectPlane(this.groundPlane, out) ? { x: out.x, z: out.z } : null;
  }

  project(x: number, y: number, z: number): { nx: number; ny: number } {
    const v = new V(x, y, z).project(this.camera);
    return { nx: v.x, ny: v.y };
  }

  // ------------------------------------------------------------ 帧更新

  step(dt: number, move: { x: number; z: number }, running: boolean, faceTo: number | null): void {
    const p = this.phys.player;
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const len = Math.hypot(move.x, move.z);
    if (len > 0.001) {
      const nx = move.x / Math.max(1, len);
      const nz = move.z / Math.max(1, len);
      p.velocity.x = nx * speed * Math.min(1, len);
      p.velocity.z = nz * speed * Math.min(1, len);
      if (faceTo === null) this.facing = Math.atan2(nx, nz);
      this.lastMove.x = nx;
      this.lastMove.z = nz;
    } else {
      p.velocity.x = 0;
      p.velocity.z = 0;
    }
    if (faceTo !== null) this.facing = faceTo;
    // 锁定平面
    p.velocity.y = 0;
    p.position.y = PLAYER_R;
    this.phys.world.step(1 / 60, dt, 3);
    p.position.y = PLAYER_R;
    p.velocity.y = 0;

    this.playerGroup.position.set(p.position.x, 0, p.position.z);
    // 平滑转向
    let d = this.facing - this.playerGroup.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.playerGroup.rotation.y += d * Math.min(1, dt * 14);

    this.animatePlayer(dt, len, running);
    this.updateDog(dt);
    this.updateAmbient(dt);
    this.updateLight(dt);

    // 相机：平滑跟随 + 移动方向前瞻 + 站立呼吸
    this.camFocus.x += (p.position.x - this.camFocus.x) * Math.min(1, dt * 5);
    this.camFocus.z += (p.position.z - this.camFocus.z) * Math.min(1, dt * 5);
    const breathe = len < 0.001 ? Math.sin(this.clock.t * 1.7) * 0.09 : 0;
    const lead = len > 0.001 ? Math.min(1.4, len) : 0;
    const camOff = new V(9, 33, 24);
    this.camera.position.set(
      this.camFocus.x + camOff.x,
      camOff.y + breathe,
      this.camFocus.z + camOff.z
    );
    this.camera.lookAt(
      this.camFocus.x + this.lastMove.x * lead,
      1.0 + breathe * 0.5,
      this.camFocus.z + this.lastMove.z * lead
    );
    this.sun.target.position.copy(this.playerGroup.position);
    this.sun.position.set(
      this.playerGroup.position.x + this.light.cur.sunPos[0],
      this.light.cur.sunPos[1],
      this.playerGroup.position.z + this.light.cur.sunPos[2]
    );

    this.renderer.render(this.scene, this.camera);
  }

  /** 鸭子走：步幅相位来自位移（上一章 2.2 米/3 步），跑步时头身微前倾 */
  private animatePlayer(dt: number, len: number, running: boolean): void {
    const legL = this.playerMesh.userData.legL as THREE.Group | undefined;
    const legR = this.playerMesh.userData.legR as THREE.Group | undefined;
    const head = this.playerMesh.userData.head as THREE.Group | undefined;
    const speedRatio = (running ? RUN_SPEED : WALK_SPEED) / RUN_SPEED;
    if (len > 0.001) {
      // 半步长 = 2.2/3 米，每 0.733 米换一脚
      this.bobT += (len * (running ? RUN_SPEED : WALK_SPEED) * dt / (2.2 / 3)) * Math.PI;
      this.bobAmt += (1 - this.bobAmt) * Math.min(1, dt * 10);
    } else {
      this.bobAmt *= Math.max(0, 1 - dt * 8);
    }
    const swing = Math.sin(this.bobT) * 0.62 * this.bobAmt * Math.max(0.55, speedRatio);
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    this.playerMesh.position.y = Math.abs(Math.sin(this.bobT)) * 0.05 * this.bobAmt;
    this.playerMesh.rotation.x = running ? 0.07 * this.bobAmt : 0.03 * this.bobAmt;
    if (head) {
      // 头反向微抬，视线保持前看
      head.rotation.x = -(running ? 0.05 : 0.02) * this.bobAmt + Math.sin(this.bobT * 0.5) * 0.02 * this.bobAmt;
    }
  }

  private updateDog(dt: number): void {
    if (!this.dog.visible) return;
    this.tailT += dt * 7;
    const tail = this.dog.userData.tail as THREE.Mesh | undefined;
    if (tail) tail.rotation.y = Math.sin(this.tailT) * 0.5;

    if (this.dogMode === 'follow') {
      const px = this.playerGroup.position.x;
      const pz = this.playerGroup.position.z;
      // 玩家进入南库内部时，灰灰停在侧门外阴影里（不进安置区）
      const insideWarehouse = px > -13 && px < 13 && pz > -19 && pz < -5;
      const target = insideWarehouse ? { x: -14.8, z: -7.5 } : { x: px, z: pz };
      const toT = new V(target.x - this.dog.position.x, 0, target.z - this.dog.position.z);
      const dist = toT.length();
      const keep = 3.1;
      if (dist > keep) {
        toT.normalize();
        const speed = Math.min(4.2, (dist - keep) * 2.2);
        this.dog.position.addScaledVector(toT, Math.min(dist - keep, speed * dt));
        this.dog.rotation.y = Math.atan2(toT.x, toT.z) - Math.PI / 2 + Math.PI;
        this.dog.position.y = Math.abs(Math.sin(this.tailT * 1.9)) * 0.05; // 跑跳小碎步
      } else {
        this.dog.position.y = 0;
      }
    }
  }

  private updateAmbient(dt: number): void {
    this.clock.t += dt;
    // 标记动画
    if (this.marker.visible) {
      const dia = this.marker.userData.dia as THREE.Mesh;
      dia.rotation.y += dt * 2.4;
      dia.position.y = 1.9 + Math.sin(this.clock.t * 2.6) * 0.14;
      const ring = this.marker.userData.ring as THREE.Mesh;
      const s = 1 + Math.sin(this.clock.t * 2.6) * 0.08;
      ring.scale.set(s, s, s);
    }
    // 列车
    if (this.train) {
      this.train.position.x += dt * 6.5;
      if (this.train.position.x > 110) this.train.position.x = -130;
    }
    // 烟气
    for (let i = 0; i < this.smokes.length; i++) {
      const sm = this.smokes[i];
      sm.position.y += dt * 0.8;
      sm.position.x += dt * 0.55;
      sm.scale.multiplyScalar(1 + dt * 0.12);
      const m = sm.material as THREE.MeshLambertMaterial;
      m.opacity = 0.32 - (sm.position.y - 14) * 0.028;
      if (sm.position.y > 23) {
        sm.position.set(62, 14, -47);
        sm.scale.setScalar(1.6);
        m.opacity = 0.3;
      }
    }
    // 背景行人
    for (const w of this.walkers) {
      w.g.position.x += w.speed * dt;
      w.g.rotation.y = w.speed > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (w.speed > 0 && w.g.position.x > w.to) w.g.position.x = w.from;
      if (w.speed < 0 && w.g.position.x < w.from) w.g.position.x = w.to;
    }
    // 门开动画
    if (this.sideDoorMesh && this.sideDoorMesh.userData.open) {
      const targetRy = -1.35;
      this.sideDoorMesh.rotation.y += (targetRy - this.sideDoorMesh.rotation.y) * Math.min(1, dt * 5);
      this.sideDoorMesh.position.x += (-13.5 - this.sideDoorMesh.position.x) * Math.min(1, dt * 5);
    }
    // 浮尘缓漂（仅所在场景可见时渲染，开销极小）
    for (const pts of this.dusts) {
      pts.rotation.y += dt * 0.02;
      const pm = pts.material as THREE.PointsMaterial;
      pm.opacity = 0.26 + Math.sin(this.clock.t * 0.5 + pts.id) * 0.06;
    }
  }

  private updateLight(dt: number): void {
    if (this.light.t < 1) {
      this.light.t = Math.min(1, this.light.t + dt / 1.4);
      const t = this.light.t * this.light.t * (3 - 2 * this.light.t);
      const lerpN = (a: number, b: number) => a + (b - a) * t;
      const ca = new THREE.Color(), cb = new THREE.Color();
      const lerpC = (a: number, b: number) => ca.set(a).lerp(cb.set(b), t).getHex();
      const cur = this.light.cur;
      const from = this.light.from, to = this.light.to;
      cur.hemiSky = lerpC(from.hemiSky, to.hemiSky);
      cur.hemiGround = lerpC(from.hemiGround, to.hemiGround);
      cur.hemiInt = lerpN(from.hemiInt, to.hemiInt);
      cur.sun = lerpC(from.sun, to.sun);
      cur.sunInt = lerpN(from.sunInt, to.sunInt);
      cur.bg = lerpC(from.bg, to.bg);
      cur.fogNear = lerpN(from.fogNear, to.fogNear);
      cur.fogFar = lerpN(from.fogFar, to.fogFar);
      cur.sunPos = [
        lerpN(from.sunPos[0], to.sunPos[0]),
        lerpN(from.sunPos[1], to.sunPos[1]),
        lerpN(from.sunPos[2], to.sunPos[2])
      ];
      cur.lamps = lerpN(from.lamps, to.lamps);
    }
    const cur = this.light.cur;
    this.hemi.color.setHex(cur.hemiSky);
    this.hemi.groundColor.setHex(cur.hemiGround);
    this.hemi.intensity = cur.hemiInt;
    this.sun.color.setHex(cur.sun);
    this.sun.intensity = cur.sunInt;
    (this.scene.background as THREE.Color | null) ?? (this.scene.background = new THREE.Color());
    (this.scene.background as THREE.Color).setHex(cur.bg);
    (this.scene.fog as THREE.Fog).color.setHex(cur.bg);
    (this.scene.fog as THREE.Fog).near = cur.fogNear;
    (this.scene.fog as THREE.Fog).far = cur.fogFar;
    for (const l of this.lampGlow) {
      (l.material as THREE.MeshLambertMaterial).emissiveIntensity = cur.lamps * 0.9;
    }
    for (const pl of this.lampLights) {
      pl.intensity = cur.lamps * 14;
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const halfH = aspect >= 1.25 ? 11.5 : 14.5;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }
}
