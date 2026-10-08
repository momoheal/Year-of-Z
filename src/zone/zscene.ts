/**
 * zscene.ts —— 域外探索的 three.js 表现层
 *
 * 只读 ZoneState，不写规则。所有"看得见的积木"都由 zbricks 现搭。
 * 相机压到高俯角（≈60°），接近设计文档的俯视角，但保留积木的立体读感。
 */

import * as THREE from 'three';
import {
  C, aoPatch, box, canvasTexture, cyl, groundTexture, makeDust, makePerson, mat, sph, unitBox
} from '../buildkit';
import {
  BLOCKS, CONTAINERS, DOORS, GROUNDS, HOME, LAMPS, MAP, NEST, ROOMS, SPOTS, TUNNEL,
  clockText, inTunnel, type BlockDef
} from './zdata';
import { DYNAMIC_CONTAINERS, containerDef, type ZoneState } from './zkernel';
import {
  BrickRing, NOISE_COLOR, bedMesh, benchMesh, bikeShed, bodyMesh, brick, brickPile, cageMesh,
  campFire, coneFan, contractBoard, counterMesh, crateMesh, debrisPile, deskMesh, doorPanel,
  lampPost, lightPool, manhole, markRing, militiaMesh, nuclecShed, playerMesh, setFanAngle,
  shelfMesh, shopSign, tentMesh, trappedPerson, tunnelMouth, zombieMesh, PLAYER_LOOK
} from './zbricks';

const V = THREE.Vector3;

interface LightPreset {
  hemiSky: number; hemiGround: number; hemiInt: number;
  sun: number; sunInt: number; sunPos: [number, number, number];
  bg: number; fogNear: number; fogFar: number;
  ambient: number;
}

const NIGHT: LightPreset = {
  hemiSky: 0x2c3a4e, hemiGround: 0x11141a, hemiInt: 0.55,
  sun: 0x8fa8d0, sunInt: 0.55, sunPos: [-18, 34, -14],
  bg: 0x0c1119, fogNear: 34, fogFar: 96, ambient: 0.10
};
const DAWN: LightPreset = {
  hemiSky: 0xc3d2d8, hemiGround: 0x50493f, hemiInt: 1.15,
  sun: 0xffd2a0, sunInt: 1.5, sunPos: [26, 20, -10],
  bg: 0xb6c6c8, fogNear: 80, fogFar: 185, ambient: 0.32
};

export class ZoneScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.OrthographicCamera;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  private container: HTMLElement;

  private statics = new THREE.Group();
  private dyn = new THREE.Group();

  private playerGroup = playerMesh();
  private torchFan!: THREE.Group;
  private torchLight!: THREE.SpotLight;
  private zMeshes = new Map<string, THREE.Group>();
  private mMeshes = new Map<string, THREE.Group>();
  private mFans = new Map<string, THREE.Group>();
  private gMeshes = new Map<number, THREE.Group>();
  private cMeshes = new Map<string, THREE.Group>();
  private dMeshes = new Map<string, THREE.Group>();
  private dropMesh: THREE.Group | null = null;
  private rings: BrickRing[] = [];
  private ringUse = 0;
  private pools: { mesh: THREE.Mesh; on: boolean }[] = [];
  private flames: THREE.Group[] = [];
  private dust!: THREE.Points;

  private camFocus = new V();
  private camOffset = new V(0, 42, 25);
  private zoom = 1;
  private clockT = 0;
  private swingT = 0;
  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new V(0, 1, 0), -0.7);

  /** rendererOverride 只为无头冒烟测试留的口子：注入一个不画东西的 renderer */
  constructor(container: HTMLElement, rendererOverride?: THREE.WebGLRenderer) {
    this.container = container;
    this.rendererOverride = rendererOverride ?? null;
    this.init();
  }

  private rendererOverride: THREE.WebGLRenderer | null;

  private init(): void {
    this.renderer = this.rendererOverride ?? new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(this.statics, this.dyn);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.hemi = new THREE.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemiInt);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, NIGHT.ambient);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(NIGHT.sun, NIGHT.sunInt);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.sun, this.sun.target);

    this.scene.fog = new THREE.Fog(NIGHT.bg, NIGHT.fogNear, NIGHT.fogFar);
    this.scene.background = new THREE.Color(NIGHT.bg);

    this.playerGroup.position.set(0, 0, 0);
    this.dyn.add(this.playerGroup);

    this.torchFan = coneFan(this.playerGroup, 16, 0.46, 0xffeec0);
    this.torchFan.position.y = 0.06;
    // 玩家组本身已经按 face 转过，光锥本地再补 -90° 才指向正前方
    setFanAngle(this.torchFan, Math.PI / 2);
    this.torchFan.visible = false;
    this.torchLight = new THREE.SpotLight(0xffeec0, 0, 22, 0.46, 0.55, 1.2);
    this.torchLight.position.set(0, 1.3, 0);
    this.playerGroup.add(this.torchLight, this.torchLight.target);
    this.torchLight.target.position.set(0, 0, 6);

    for (let i = 0; i < 14; i++) {
      const r = new BrickRing(30);
      r.mesh.visible = false;
      this.dyn.add(r.mesh);
      this.rings.push(r);
    }

    this.dust = makeDust(320, { x: [-40, 40], y: [0.4, 5], z: [-28, 28] });
    this.dyn.add(this.dust);

    this.camFocus.set(HOME.x, 0, HOME.z);
    this.resize();
  }

  // ---------------------------------------------------------------- 静态建景

  build(st: ZoneState): void {
    // 地面
    const gt = groundTexture('#2b3030', '#1f2422', 70);
    gt.repeat.set(14, 10);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.maxX - MAP.minX + 8, MAP.maxZ - MAP.minZ + 8),
      new THREE.MeshLambertMaterial({ map: gt })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((MAP.minX + MAP.maxX) / 2, 0, (MAP.minZ + MAP.maxZ) / 2);
    ground.receiveShadow = true;
    this.statics.add(ground);

    // 地面分区
    for (const g of GROUNDS) {
      let tex: THREE.Texture;
      if (g.kind === 'road') {
        tex = groundTexture('#26282b', '#1c1e21', 30);
      } else if (g.kind === 'floor') {
        tex = groundTexture('#5d564a', '#4a443a', 34);
      } else if (g.kind === 'dark') {
        tex = groundTexture('#0b0d10', '#070809', 12);
      } else {
        tex = groundTexture('#3a3a2f', '#2c2c24', 40);
      }
      tex.repeat.set(Math.max(2, Math.round(g.w / 4)), Math.max(2, Math.round(g.d / 4)));
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(g.w, g.d), new THREE.MeshLambertMaterial({ map: tex }));
      gp.rotation.x = -Math.PI / 2;
      gp.position.set(g.x, 0.012, g.z);
      gp.receiveShadow = true;
      this.statics.add(gp);
    }

    // 建筑与墙
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x9aa096 });
    const capMat = new THREE.MeshLambertMaterial({ color: 0x7d8387 });
    for (const b of BLOCKS) {
      if (b.kind === 'tent') {
        const t = tentMesh(); t.position.set(b.x, 0, b.z); this.statics.add(t); continue;
      }
      if (b.kind === 'house') {
        this.buildHome(b); continue;
      }
      const m = new THREE.Mesh(unitBox, wallMat);
      m.scale.set(b.w, b.h, b.d);
      m.position.set(b.x, b.h / 2, b.z);
      m.castShadow = true; m.receiveShadow = true;
      this.statics.add(m);
      // 压顶薄板：乐高收边
      const cap = new THREE.Mesh(unitBox, capMat);
      cap.scale.set(b.w + 0.12, 0.12, b.d + 0.12);
      cap.position.set(b.x, b.h + 0.06, b.z);
      cap.receiveShadow = true;
      this.statics.add(cap);
      if (b.sign) {
        const s = shopSign(b.sign, Math.max(1.6, Math.min(3.4, b.w * 0.9)));
        s.position.set(b.x - Math.sign(b.w - b.d) * 0, b.h * 0.82, b.z + b.d / 2 + 0.06);
        s.rotation.y = 0;
        this.statics.add(s);
      }
    }

    // 店铺招牌（房间）
    for (const r of ROOMS) {
      if (!r.sign) continue;
      const s = shopSign(r.sign, Math.max(2.2, Math.min(4, r.w * 0.42)));
      const y = r.h * 0.82;
      const m = 0.09;
      if (r.door.side === 'e') { s.position.set(r.x + r.w / 2 + m, y, r.z); s.rotation.y = Math.PI / 2; }
      else if (r.door.side === 'w') { s.position.set(r.x - r.w / 2 - m, y, r.z); s.rotation.y = -Math.PI / 2; }
      else if (r.door.side === 'n') { s.position.set(r.x, y, r.z - r.d / 2 - m); s.rotation.y = Math.PI; }
      else { s.position.set(r.x, y, r.z + r.d / 2 + m); s.rotation.y = 0; }
      this.statics.add(s);
    }

    // 灯
    for (const l of LAMPS) {
      if (l.kind === 'fire') {
        const f = campFire(); f.position.set(l.x, 0, l.z); this.statics.add(f);
        this.flames.push(f.userData.flame as THREE.Group);
      } else if (l.kind === 'porch') {
        const pole = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: C.metalDark }));
        pole.scale.set(0.14, 2.6, 0.14);
        pole.position.set(l.x, 1.3, l.z);
        this.statics.add(pole);
        const bulb = sph(this.statics, 0.2, new THREE.MeshLambertMaterial({ color: 0xffd9a0, emissive: 0xffd9a0, emissiveIntensity: 1.2 }), l.x, 2.62, l.z);
        bulb.castShadow = false;
      } else if (l.kind === 'checkpoint') {
        const p = lampPost(0xfff0cc); p.position.set(l.x, 0, l.z - 3.4); this.statics.add(p);
      } else {
        const p = lampPost(); p.position.set(l.x, 0, l.z); this.statics.add(p);
      }
      this.pools.push({ mesh: lightPool(this.statics, l.r, l.x, l.z, l.warm ?? 0xffd296), on: true });
      aoPatch(this.statics, l.r * 0.7, l.r * 0.7, l.x, l.z, 0.25);
    }

    // 地道口
    for (const [x, ry] of [[TUNNEL.maxX, Math.PI / 2], [TUNNEL.minX, -Math.PI / 2]] as [number, number][]) {
      const m = tunnelMouth();
      m.position.set(x, 0, TUNNEL.west.z);
      m.rotation.y = ry;
      this.statics.add(m);
    }

    // 快尸巢：地上的一个洞
    const nestHole = new THREE.Mesh(new THREE.CircleGeometry(2.0, 20), new THREE.MeshBasicMaterial({ color: 0x05070a }));
    nestHole.rotation.x = -Math.PI / 2;
    nestHole.position.set(NEST.x, 0.03, NEST.z);
    this.statics.add(nestHole);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      brick(this.statics, 0.5, 0.3, 0.4, 0x5b646c, NEST.x + Math.cos(a) * 2.3, 0.15, NEST.z + Math.sin(a) * 2.3, -a);
    }

    // 家的圈（撤离点）
    markRing(this.statics, HOME.r, HOME.x, HOME.z, 0x93b48c);

    // 井盖 / 杂物
    for (const [x, z] of [[-6, 6], [14, 8], [-30, 2], [22, 16]] as [number, number][]) {
      const m = manhole(); m.position.set(x, 0, z); this.statics.add(m);
    }
    for (const [x, z] of [[-30, -4], [-34, 4.5], [8, 21]] as [number, number][]) {
      const d = debrisPile(Math.round(Math.abs(x + z) * 7) + 3);
      d.position.set(x, 0, z + 1.2);
      this.statics.add(d);
    }
    const shed = bikeShed(); shed.position.set(-36, 0, 25.4); this.statics.add(shed);
    const na = nuclecShed(); na.position.set(-28.5, 0, 25.6); this.statics.add(na);

    // 集装箱立面（用 prop 颜色区分）
    for (const [x, z, c] of [[20, -6, 0x9a4f2f], [25, -6.5, 0x6f7469], [17, -3.5, 0x9a4f2f], [33, -6, 0x6f7469]] as [number, number, number][]) {
      const b = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: c }));
      b.scale.set(3.9, 2.5, 2.5);
      b.position.set(x, 1.25, z);
      b.castShadow = true; b.receiveShadow = true;
      this.statics.add(b);
    }

    // 容器
    for (const c of CONTAINERS) this.addContainer(c.id, containerDef(c.id)!);
    // 交互点
    for (const s of SPOTS) {
      if (s.kind === 'board') { const g = contractBoard(); g.position.set(s.x, 0, s.z); this.statics.add(g); this.placeTags(g); }
      else if (s.kind === 'bench') { const g = benchMesh(); g.position.set(s.x, 0, s.z); this.statics.add(g); this.addNpc(s.x + 1.4, s.z, 0x6f7f6a); }
      else if (s.kind === 'bed') { const g = bedMesh(); g.position.set(s.x, 0, s.z); this.statics.add(g); }
      else if (s.kind === 'trapped') { const g = trappedPerson(); g.position.set(s.x, 0, s.z); this.statics.add(g); }
      else if (s.kind === 'fire') { /* 火在灯表里建了 */ }
      else if (s.kind === 'home') {
        const g = makePerson({ coat: 0x9a8f76, pants: 0x4a4d50, skin: 0xd8b89a, scale: 0.9 });
        g.position.set(s.x + 1.6, 0, s.z + 0.4);
        g.rotation.y = -1.2;
        this.statics.add(g);
      }
    }
    // 定居点常驻几个人
    this.addNpc(-1.2, -18.5, 0x7d7a6a);
    this.addNpc(3.4, -22.5, 0x8a7f68);
    this.addNpc(-6.4, -20.5, 0x6f7a80);

    // 门
    for (const d of DOORS) {
      const g = doorPanel(d.w, d.block.h, d.locked);
      g.position.set(d.x, 0, d.z);
      if (Math.abs(d.ry) > 0.1) g.rotation.y = Math.PI / 2;
      this.statics.add(g);
      this.dMeshes.set(d.id, g);
    }

    void st;
  }

  private placeTags(board: THREE.Group): void {
    const g = new THREE.Group();
    g.name = 'tags';
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      t.position.set(-0.85 + i * 0.85, 1.55, 0.1);
      const plate = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: [0xc97363, 0xd9a05b, 0x6f93b8][i] }));
      plate.scale.set(0.3, 0.09, 0.42);
      t.add(plate);
      for (let s = 0; s <= i % 2; s++) cyl(t, 0.055, 0.06, 0xf0ece0, (s - (i % 2) / 2) * 0.13, 0.075, -0.06);
      g.add(t);
    }
    board.add(g);
  }

  private addNpc(x: number, z: number, coat: number): void {
    const p = makePerson({ coat, pants: 0x4a4d50, skin: 0xd8b89a });
    p.position.set(x, 0, z);
    p.rotation.y = Math.random() * 3;
    this.statics.add(p);
  }

  private buildHome(b: BlockDef): void {
    const body = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xc9c5b8 }));
    body.scale.set(b.w, b.h, b.d);
    body.position.set(b.x, b.h / 2, b.z);
    body.castShadow = true; body.receiveShadow = true;
    this.statics.add(body);
    // 窗
    const winM = new THREE.MeshLambertMaterial({ color: 0x39414a });
    for (let f = 0; f < 2; f++) {
      for (let i = 0; i < 3; i++) {
        const wx = b.x - b.w / 2 + (i + 0.5) * (b.w / 3);
        const w = new THREE.Mesh(unitBox, winM);
        w.scale.set(0.9, 1.0, 0.1);
        w.position.set(wx, 2.0 + f * 2.6, b.z + b.d / 2 + 0.05);
        this.statics.add(w);
      }
    }
    // 门廊
    const porch = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xb0a894 }));
    porch.scale.set(2.4, 0.14, 1.6);
    porch.position.set(HOME.x + 2.6, 2.7, HOME.z);
    this.statics.add(porch);
    for (const sx of [HOME.x + 1.5, HOME.x + 3.7]) {
      const p = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0x8f979e }));
      p.scale.set(0.14, 2.7, 0.14);
      p.position.set(sx, 1.35, HOME.z + 0.7);
      this.statics.add(p);
    }
  }

  private addContainer(id: string, def: { x: number; z: number; kind: string }): void {
    let g: THREE.Group;
    switch (def.kind) {
      case 'shelf': g = shelfMesh(); break;
      case 'counter': g = counterMesh(); break;
      case 'body': g = bodyMesh(); break;
      case 'cage': g = cageMesh(); break;
      case 'desk': g = deskMesh(); break;
      default: g = crateMesh();
    }
    g.position.set(def.x, 0, def.z);
    this.statics.add(g);
    this.cMeshes.set(id, g);
  }

  // ---------------------------------------------------------------- 每帧同步

  sync(st: ZoneState, dt: number): void {
    this.clockT += dt;

    // 灯光：夜 → 天亮
    const k = Math.max(0, Math.min(1, (st.gameMin - 505) / 65));
    const L = {
      hemiSky: new THREE.Color(NIGHT.hemiSky).lerp(new THREE.Color(DAWN.hemiSky), k),
      hemiGround: new THREE.Color(NIGHT.hemiGround).lerp(new THREE.Color(DAWN.hemiGround), k),
      hemiInt: NIGHT.hemiInt + (DAWN.hemiInt - NIGHT.hemiInt) * k,
      sun: new THREE.Color(NIGHT.sun).lerp(new THREE.Color(DAWN.sun), k),
      sunInt: NIGHT.sunInt + (DAWN.sunInt - NIGHT.sunInt) * k,
      bg: new THREE.Color(NIGHT.bg).lerp(new THREE.Color(DAWN.bg), k),
      fogNear: NIGHT.fogNear + (DAWN.fogNear - NIGHT.fogNear) * k,
      fogFar: NIGHT.fogFar + (DAWN.fogFar - NIGHT.fogFar) * k,
      ambient: NIGHT.ambient + (DAWN.ambient - NIGHT.ambient) * k
    };
    this.hemi.color.copy(L.hemiSky); this.hemi.groundColor.copy(L.hemiGround); this.hemi.intensity = L.hemiInt;
    this.sun.color.copy(L.sun); this.sun.intensity = L.sunInt;
    this.ambient.intensity = L.ambient;
    (this.scene.fog as THREE.Fog).color.copy(L.bg);
    (this.scene.fog as THREE.Fog).near = L.fogNear;
    (this.scene.fog as THREE.Fog).far = L.fogFar;
    (this.scene.background as THREE.Color).copy(L.bg);

    // 玩家
    const p = st.player;
    this.playerGroup.position.set(p.x, 0, p.z);
    this.playerGroup.rotation.y = p.face;
    this.animatePerson(this.playerGroup, p.moving ? (p.stance === 'run' ? 15 : 9) : 0, this.clockT);
    this.torchFan.visible = p.light;
    this.torchLight.intensity = p.light ? (p.battery > 0.15 ? 2.6 : 1.0) : 0;
    this.swingT = Math.max(0, this.swingT - dt * 5);
    const armR = this.playerGroup.userData.armR as THREE.Group | undefined;
    if (armR) armR.rotation.x = -this.swingT * 2.2;

    // 相机
    this.camFocus.x += (p.x - this.camFocus.x) * Math.min(1, dt * 6.5);
    this.camFocus.z += (p.z - this.camFocus.z) * Math.min(1, dt * 6.5);
    this.updateCamera();

    // 太阳跟随
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + NIGHT.sunPos[0], NIGHT.sunPos[1], p.z + NIGHT.sunPos[2]);
    this.sun.position.lerp(new V(p.x + DAWN.sunPos[0], DAWN.sunPos[1], p.z + DAWN.sunPos[2]), k);

    // 丧尸
    const seen = new Set<string>();
    for (const z of st.zombies) {
      if (!z.alive && !this.zMeshes.has(z.id)) continue;
      seen.add(z.id);
      let g = this.zMeshes.get(z.id);
      if (!g) {
        g = zombieMesh(z.kind);
        this.dyn.add(g);
        this.zMeshes.set(z.id, g);
      }
      if (!z.alive) {
        g.rotation.x = -Math.PI / 2.1;
        g.position.set(z.x, 0.28, z.z);
        continue;
      }
      g.position.set(z.x, 0, z.z);
      g.rotation.set(0, z.face, 0);
      if (z.kind === 'lurker' && z.state === 'ambush') { g.rotation.x = -1.25; g.position.y = 0.05; }
      else if (z.kind === 'croucher' && z.state === 'ambush') { g.scale.y = 0.62; g.position.y = 0; }
      else { g.scale.y = 1; g.position.y = 0; }
      const moving = z.state === 'chase' || z.state === 'alert';
      this.animatePerson(g, moving ? (z.kind === 'runner' ? 17 : 7) : 0, this.clockT + z.wobble);
      if (z.kind === 'screamer' && z.state === 'chase') {
        (g.userData.head as THREE.Group).rotation.x = Math.sin(this.clockT * 9) * 0.25 - 0.2;
      }
    }
    for (const [id, g] of this.zMeshes) {
      if (seen.has(id)) continue;
      this.dyn.remove(g); this.zMeshes.delete(id);
    }

    // 机动队
    const mSeen = new Set<string>();
    for (const m of st.militia) {
      if (!m.alive) continue;
      mSeen.add(m.id);
      let g = this.mMeshes.get(m.id);
      if (!g) {
        g = militiaMesh(m.light);
        this.dyn.add(g);
        this.mMeshes.set(m.id, g);
        if (m.light) {
          const fan = coneFan(this.dyn, 15, 0.34, 0xfff0cc);
          fan.renderOrder = 3;
          this.mFans.set(m.id, fan);
        }
      }
      g.position.set(m.x, 0, m.z);
      g.rotation.y = m.face;
      this.animatePerson(g, m.state === 'patrol' ? 6 : 10, this.clockT + m.sweep);
      const fan = this.mFans.get(m.id);
      if (fan) {
        fan.visible = true;
        fan.position.set(m.x, 0.07, m.z);
        setFanAngle(fan, m.face + Math.sin(m.sweep) * 0.55);
      }
    }
    for (const [id, g] of this.mMeshes) {
      if (mSeen.has(id)) continue;
      this.dyn.remove(g); this.mMeshes.delete(id);
      const fan = this.mFans.get(id);
      if (fan) { this.dyn.remove(fan); this.mFans.delete(id); }
    }

    // 地面积木件
    const gSeen = new Set<number>();
    for (const gi of st.ground) {
      gSeen.add(gi.uid);
      let g = this.gMeshes.get(gi.uid);
      if (!g) {
        g = brickPile(gi.id, gi.n);
        this.dyn.add(g);
        this.gMeshes.set(gi.uid, g);
      }
      g.position.set(gi.x, 0, gi.z);
    }
    for (const [uid, g] of this.gMeshes) {
      if (gSeen.has(uid)) continue;
      this.dyn.remove(g); this.gMeshes.delete(uid);
    }

    // 掉下的包
    if (st.bagDrop.length && !this.dropMesh) {
      const g = new THREE.Group();
      const pack = brick(g, 0.7, 0.6, 0.5, 0x7d6a4a, 0, 0.3, 0);
      pack.rotation.y = 0.4;
      const strap = new THREE.Mesh(unitBox, mat(0x5b4a34));
      strap.scale.set(0.74, 0.12, 0.54);
      strap.position.y = 0.62;
      g.add(strap);
      markRing(g, 1.6, 0, 0, 0xc97363);
      this.dyn.add(g);
      this.dropMesh = g;
    }
    if (this.dropMesh) {
      if (!st.bagDrop.length) { this.dyn.remove(this.dropMesh); this.dropMesh = null; }
      else {
        this.dropMesh.position.set(st.bagDrop[0].x, 0, st.bagDrop[0].z);
        this.dropMesh.rotation.y = this.clockT * 0.4;
      }
    }

    // 噪音涟漪（积木环）
    this.ringUse = 0;
    for (const n of st.noises) {
      if (this.ringUse >= this.rings.length) break;
      const r = this.rings[this.ringUse++];
      const fade = 1 - n.t / n.life;
      const rad = Math.max(0.4, NOISE_RADIUS_UNKNOWN(n.level) * Math.min(1, n.t / (n.life * 0.55)));
      r.mesh.visible = true;
      r.mesh.position.set(n.x, 0.04, n.z);
      r.update(rad, fade, NOISE_COLOR[n.level] ?? 0xffffff);
    }
    for (let i = this.ringUse; i < this.rings.length; i++) this.rings[i].mesh.visible = false;

    // 门
    for (const d of st.doors) {
      const g = this.dMeshes.get(d.id);
      if (!g) continue;
      const target = d.open ? Math.PI / 2 : 0;
      g.rotation.y += (target - g.rotation.y) * Math.min(1, dt * 8);
      const def = DOORS.find((x) => x.id === d.id)!;
      if (Math.abs(def.ry) > 0.1) g.rotation.y += 0; // 竖着的门：绕自身轴开
    }

    // 容器空了就压暗
    for (const c of st.containers) {
      const g = this.cMeshes.get(c.id);
      if (!g) continue;
      g.visible = c.left.length > 0;
    }

    // 火苗跳动
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.scale.setScalar(0.9 + Math.sin(this.clockT * 7 + i) * 0.12);
      f.rotation.y = Math.sin(this.clockT * 1.6 + i) * 0.4;
    }

    // 灯下安全岛在夜里更亮
    const nightK = 1 - k;
    for (const pl of this.pools) (pl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.6 * nightK;

    this.renderer.render(this.scene, this.camera);
  }

  private animatePerson(g: THREE.Group, rate: number, t: number): void {
    const legL = g.userData.legL as THREE.Group | undefined;
    const legR = g.userData.legR as THREE.Group | undefined;
    const armL = g.userData.armL as THREE.Group | undefined;
    const armR = g.userData.armR as THREE.Group | undefined;
    if (!legL || !legR) return;
    if (rate <= 0) {
      legL.rotation.x *= 0.85; legR.rotation.x *= 0.85;
      if (armL) armL.rotation.x *= 0.85;
      if (armR) armR.rotation.x *= 0.85;
      return;
    }
    const a = Math.sin(t * rate) * 0.55;
    legL.rotation.x = a; legR.rotation.x = -a;
    if (armL) armL.rotation.x = -a * 0.7;
    if (armR && g !== this.playerGroup) armR.rotation.x = a * 0.7;
  }

  private updateCamera(): void {
    const aspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    const halfH = 12 / this.zoom;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.position.set(this.camFocus.x + this.camOffset.x, this.camOffset.y, this.camFocus.z + this.camOffset.z);
    this.camera.lookAt(this.camFocus.x, 0.8, this.camFocus.z);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.updateCamera();
  }

  setZoom(z: number): void { this.zoom = Math.max(0.62, Math.min(1.9, z)); this.updateCamera(); }
  getZoom(): number { return this.zoom; }

  /** 屏幕坐标 → 地面坐标（瞄准用） */
  screenToWorld(nx: number, ny: number): { x: number; z: number } {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new V();
    if (this.raycaster.ray.intersectPlane(this.aimPlane, hit)) return { x: hit.x, z: hit.z };
    return { x: this.camFocus.x, z: this.camFocus.z };
  }

  /** 世界坐标 → 屏幕像素（HUD 指引箭头用） */
  worldToScreen(x: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new V(x, 0.8, z).project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
  }

  triggerSwing(): void { this.swingT = 1; }

  /** 当晚结算后把 HUD 上的时间也交给文字层（不撒谎） */
  static clockText(min: number): string { return clockText(min); }

  dispose(): void {
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
  }

  /** 动态容器（机动队尸体）建景 */
  ensureDynamicContainers(): void {
    for (const [id, def] of DYNAMIC_CONTAINERS) {
      if (this.cMeshes.has(id)) continue;
      this.addContainer(id, def);
    }
  }

  /** 地道里：把环境压到纯黑（视觉层，与内核的 San 规则一致） */
  tunnelDarkness(x: number, z: number): boolean { return inTunnel(x, z); }
}

function NOISE_RADIUS_UNKNOWN(level: number): number {
  return [0, 2.25, 5, 8.5, 13.5, 23.75][level] ?? 6;
}

/** 复用正传的建景小件，避免域外探索自己造轮子 */
export { aoPatch, box, canvasTexture, makePerson, PLAYER_LOOK };
