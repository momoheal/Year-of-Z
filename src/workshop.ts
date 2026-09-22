/**
 * workshop.ts —— 工坊试作（独立场景，不进入章节装备状态）
 *
 * 架空展示枪、三个轻改装槽与纸靶反馈：槽位选择改变模型与架空散布、
 * 回复速度、重量表现。无人物的纸靶；不提供现实装配教程、真实品牌或
 * 结构参数。配件保存在独立 localStorage 键，返回章节仍只有借用撬棍。
 * （边界见 doc/23「工坊边界」与 doc/25。）
 */

import * as THREE from 'three';
import { WORKSHOP_KEY } from './story';

type Sight = 'iron' | 'optic';
type Stock = 'std' | 'stable';
type Under = 'none' | 'lamp';

interface WorkshopSave { sight: Sight; stock: Stock; under: Under }

const VOLLEY = 8;
const TARGET_DIST = 14;

function loadSave(): WorkshopSave {
  try {
    const raw = localStorage.getItem(WORKSHOP_KEY);
    if (!raw) return { sight: 'iron', stock: 'std', under: 'none' };
    const o = JSON.parse(raw) as Partial<WorkshopSave>;
    return {
      sight: o.sight === 'optic' ? 'optic' : 'iron',
      stock: o.stock === 'stable' ? 'stable' : 'std',
      under: o.under === 'lamp' ? 'lamp' : 'none'
    };
  } catch {
    return { sight: 'iron', stock: 'std', under: 'none' };
  }
}

export class Workshop {
  private root: HTMLDivElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private gunPivot = new THREE.Group();
  private gunBody = new THREE.Group();
  private targetCanvas!: HTMLCanvasElement;
  private targetTexture!: THREE.CanvasTexture;
  private flash!: THREE.Mesh;
  private muzzleLight!: THREE.PointLight;
  private raf = 0;
  private running = false;
  private save: WorkshopSave = loadSave();
  private statsEl!: HTMLElement;
  private fireBtn!: HTMLButtonElement;
  private drag = { on: false, x: 0, vy: 0 };
  private recoil = 0;
  private lastFire = 0;

  onClose?: () => void;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'workshop';
    this.root.classList.add('hidden');
    this.root.innerHTML = `
      <div id="ws-canvas-wrap"></div>
      <div class="ws-top">
        <div class="ws-title">工坊试作<small>架空器材 · 纸靶验证 · 与第一章装备无关，返回章节不带入</small></div>
        <button class="ws-close" aria-label="返回">×</button>
      </div>
      <div class="ws-hint">拖动旋转视角 · 槽位只改变表现与架空散布，不提供真实参数</div>
      <div class="ws-panel">
        <div class="ws-slot" data-slot="sight">
          <label>瞄具</label>
          <div class="seg"><button data-v="iron">机械</button><button data-v="optic">光学</button></div>
        </div>
        <div class="ws-slot" data-slot="stock">
          <label>枪托</label>
          <div class="seg"><button data-v="std">标准</button><button data-v="stable">稳定</button></div>
        </div>
        <div class="ws-slot" data-slot="under">
          <label>下挂</label>
          <div class="seg"><button data-v="none">无</button><button data-v="lamp">灯具</button></div>
        </div>
        <div class="ws-actions">
          <button id="ws-fire">试射 ×${VOLLEY}</button>
          <button id="ws-reset">换靶纸</button>
        </div>
        <div id="ws-stats">—</div>
      </div>`;
    parent.appendChild(this.root);

    this.initGL();
    this.buildScene();
    this.rebuildGun();

    this.root.querySelector('.ws-close')!.addEventListener('click', () => this.close());
    this.fireBtn = this.root.querySelector('#ws-fire') as HTMLButtonElement;
    this.statsEl = this.root.querySelector('#ws-stats') as HTMLElement;
    this.fireBtn.addEventListener('click', () => this.fireVolley());
    (this.root.querySelector('#ws-reset') as HTMLButtonElement).addEventListener('click', () => this.resetTarget());

    for (const slot of this.root.querySelectorAll<HTMLElement>('.ws-slot')) {
      const name = slot.dataset.slot as 'sight' | 'stock' | 'under';
      for (const b of slot.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.addEventListener('click', () => {
          const v = b.dataset.v!;
          if (name === 'sight') this.save.sight = v as Sight;
          else if (name === 'stock') this.save.stock = v as Stock;
          else this.save.under = v as Under;
          this.persist();
          this.rebuildGun();
          this.refreshSegs();
        });
      }
    }
    this.refreshSegs();

    // 拖动旋转
    const wrap = this.root.querySelector('#ws-canvas-wrap') as HTMLElement;
    wrap.addEventListener('pointerdown', (e) => {
      this.drag.on = true;
      this.drag.x = e.clientX;
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!this.drag.on) return;
      const dx = e.clientX - this.drag.x;
      this.drag.x = e.clientX;
      this.gunPivot.rotation.y += dx * 0.012;
      this.drag.vy = dx * 0.012;
    });
    wrap.addEventListener('pointerup', () => { this.drag.on = false; });
    wrap.addEventListener('pointercancel', () => { this.drag.on = false; });
  }

  private persist(): void {
    try {
      localStorage.setItem(WORKSHOP_KEY, JSON.stringify(this.save));
    } catch { /* 存储不可写仍可使用 */ }
  }

  private refreshSegs(): void {
    for (const slot of this.root.querySelectorAll<HTMLElement>('.ws-slot')) {
      const name = slot.dataset.slot as keyof WorkshopSave;
      for (const b of slot.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.classList.toggle('on', b.dataset.v === this.save[name]);
      }
    }
  }

  private initGL(): void {
    const wrap = this.root.querySelector('#ws-canvas-wrap') as HTMLElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(wrap.clientWidth || window.innerWidth, wrap.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.camera.position.set(1.8, 1.7, 4.6);
    this.camera.lookAt(0, 1.05, -2.5);
    window.addEventListener('resize', () => {
      if (this.root.classList.contains('hidden')) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x1a1f1c);
    this.scene.fog = new THREE.Fog(0x1a1f1c, 12, 30);
    const hemi = new THREE.HemisphereLight(0xd8ddd4, 0x2c2a24, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2b8, 1.3);
    key.position.set(3.5, 6, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    // 地面与工作台
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0x353a33 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, TARGET_DIST + 6), new THREE.MeshLambertMaterial({ color: 0x3e443c }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.01, -TARGET_DIST / 2 - 1);
    lane.receiveShadow = true;
    this.scene.add(lane);

    for (let i = 0; i < 5; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshLambertMaterial({ color: 0x5b5650 }));
      post.position.set(i % 2 ? 1.4 : -1.4, 0.5, -2 - i * 3);
      this.scene.add(post);
    }

    // 靶架 + 纸靶
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x5d5148 });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), frameMat);
    stand.position.set(0, 0.95, -TARGET_DIST);
    this.scene.add(stand);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.06), frameMat);
    board.position.set(0, 1.55, -TARGET_DIST - 0.03);
    board.castShadow = true;
    this.scene.add(board);

    this.targetCanvas = document.createElement('canvas');
    this.targetCanvas.width = 512;
    this.targetCanvas.height = 512;
    this.targetTexture = new THREE.CanvasTexture(this.targetCanvas);
    this.targetTexture.colorSpace = THREE.SRGBColorSpace;
    this.resetTarget();
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshLambertMaterial({ map: this.targetTexture })
    );
    paper.position.set(0, 1.55, -TARGET_DIST + 0.004);
    this.scene.add(paper);
    // 远处建筑剪影
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(4, 6 + i * 2, 3),
        new THREE.MeshLambertMaterial({ color: 0x252a26 })
      );
      b.position.set(-8 + i * 6, (6 + i * 2) / 2, -TARGET_DIST - 8);
      this.scene.add(b);
    }
  }

  private rebuildGun(): void {
    // 清空
    this.gunBody.clear();
    const body = this.gunBody;
    const m = (c: number) => new THREE.MeshLambertMaterial({ color: c });
    const metal = m(0x4a4f55);
    const dark = m(0x33373c);
    const grip = m(0x5d5348);

    // 机匣 / 护木 / 枪管 / 握把 / 弹匣 —— 纯架空块状风格
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.66), metal);
    recv.position.set(0, 0, 0.05);
    body.add(recv);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.5), dark);
    hand.position.set(0, -0.005, -0.55);
    body.add(hand);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.5, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.95);
    body.add(barrel);
    const gripM = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), grip);
    gripM.position.set(0, -0.18, 0.16);
    gripM.rotation.x = 0.35;
    body.add(gripM);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.14), dark);
    mag.position.set(0, -0.19, -0.08);
    mag.rotation.x = -0.18;
    body.add(mag);

    // 瞄具槽
    if (this.save.sight === 'optic') {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 12), dark);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.14, 0.02);
      body.add(tube);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12), metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.14, -0.1);
      body.add(ring);
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.004, 12),
        new THREE.MeshLambertMaterial({ color: 0x7ca7d8, emissive: 0x3d5d82, emissiveIntensity: 0.6 })
      );
      glass.rotation.x = Math.PI / 2;
      glass.position.set(0, 0.14, -0.115);
      body.add(glass);
    } else {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.012), dark);
      post.position.set(0, 0.125, -0.78);
      body.add(post);
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), dark);
      rear.position.set(0, 0.11, 0.3);
      body.add(rear);
    }

    // 枪托槽
    if (this.save.stock === 'stable') {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.34), m(0x4d443c));
      stock.position.set(0, -0.02, 0.55);
      body.add(stock);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.2), grip);
      cheek.position.set(0, 0.11, 0.52);
      body.add(cheek);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.04), dark);
      pad.position.set(0, -0.02, 0.73);
      body.add(pad);
    } else {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.3), m(0x4d443c));
      stock.position.set(0, 0, 0.52);
      body.add(stock);
    }

    // 下挂槽
    if (this.save.under === 'lamp') {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), metal);
      lamp.position.set(0, -0.1, -0.52);
      body.add(lamp);
      const bulb = new THREE.Mesh(
        new THREE.CircleGeometry(0.024, 10),
        new THREE.MeshLambertMaterial({ color: 0xf4e6c4, emissive: 0xf4d89a, emissiveIntensity: 0.9 })
      );
      bulb.position.set(0, -0.1, -0.585);
      bulb.rotation.y = Math.PI;
      body.add(bulb);
    }

    // 枪口闪光（平时隐藏）
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0 })
    );
    this.flash.position.set(0, 0.03, -1.22);
    body.add(this.flash);

    this.gunPivot.add(body);
    if (!this.gunPivot.parent) {
      this.gunPivot.position.set(0, 1.12, 0);
      this.scene.add(this.gunPivot);
      this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 6, 2);
      this.muzzleLight.position.set(0, 1.1, -1.2);
      this.scene.add(this.muzzleLight);
    }
  }

  /** 架空散布与回稳参数（纯表现，不提供现实依据） */
  private ballistics(): { sigma: number; settle: number; label: string; weightLabel: string } {
    let sigma = 0.06;
    let settle = 1.0;
    if (this.save.stock === 'stable') { sigma *= 0.62; settle *= 0.7; }
    if (this.save.sight === 'optic') { sigma *= 0.8; }
    if (this.save.under === 'lamp') { sigma *= 1.05; }
    const label = settle < 0.9 ? '回稳较快' : '回稳一般';
    const weightLabel =
      (this.save.stock === 'stable' ? 1 : 0) + (this.save.sight === 'optic' ? 1 : 0) + (this.save.under === 'lamp' ? 1 : 0) >= 2
        ? '偏沉' : '轻便';
    return { sigma, settle, label, weightLabel };
  }

  private resetTarget(): void {
    const g = this.targetCanvas.getContext('2d')!;
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, 0, 512, 512);
    const cx = 256, cy = 256;
    g.strokeStyle = '#3c3c38';
    for (let r = 40; r <= 200; r += 40) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.lineWidth = r === 200 ? 4 : 2;
      g.stroke();
    }
    g.fillStyle = '#3c3c38';
    g.beginPath();
    g.arc(cx, cy, 10, 0, Math.PI * 2);
    g.fill();
    g.font = '16px sans-serif';
    g.fillText('试作靶 · 无人物', 340, 490);
    this.targetTexture.needsUpdate = true;
    this.statsEl.textContent = '靶纸已更换。';
  }

  private fireVolley(): void {
    const now = performance.now();
    if (now - this.lastFire < 900) return;
    this.lastFire = now;
    this.fireBtn.disabled = true;
    const { sigma, label, weightLabel } = this.ballistics();
    const g = this.targetCanvas.getContext('2d')!;
    const pxPerMeter = 1.15 / 512; // 靶纸 1.15m ↔ 512px
    const hits: { dx: number; dy: number }[] = [];
    let i = 0;
    const shot = () => {
      // 连射升温：后段散布略有放大（稳定枪托衰减更小）
      const heat = 1 + i * 0.06 * (this.save.stock === 'stable' ? 0.5 : 1);
      const ang = Math.random() * Math.PI * 2;
      const rad = (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * sigma * heat) * TARGET_DIST;
      const dx = Math.cos(ang) * rad;
      const dy = Math.sin(ang) * rad;
      hits.push({ dx, dy });
      const px = 256 + dx / pxPerMeter;
      const py = 256 + dy / pxPerMeter;
      g.fillStyle = '#26262a';
      g.beginPath();
      g.arc(px, py, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(38,38,42,0.35)';
      g.beginPath();
      g.arc(px + 3, py + 2, 9, 0, Math.PI * 2);
      g.fill();
      this.targetTexture.needsUpdate = true;
      // 后坐表现
      this.recoil = this.save.stock === 'stable' ? 0.035 : 0.06;
      (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.9;
      this.muzzleLight.intensity = 26;
      i++;
      if (i < VOLLEY) {
        setTimeout(shot, 140);
      } else {
        const onPaper = hits.filter((h) => Math.hypot(h.dx, h.dy) <= 0.575).length;
        const meanR = hits.reduce((a, h) => a + Math.hypot(h.dx, h.dy), 0) / hits.length;
        setTimeout(() => {
          this.statsEl.textContent =
            `本轮：上靶 ${onPaper}/${VOLLEY} · 平均散布约 ${(meanR * 100).toFixed(0)} cm（架空） · ${label} · 手感${weightLabel}`;
          this.fireBtn.disabled = false;
        }, 300);
      }
    };
    shot();
  }

  open(): void {
    this.root.classList.remove('hidden');
    const wrap = this.root.querySelector('#ws-canvas-wrap') as HTMLElement;
    const w = wrap.clientWidth || window.innerWidth, h = wrap.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // 待机缓转（未拖动时）
      if (!this.drag.on) {
        this.gunPivot.rotation.y += 0.12 * dt + this.drag.vy;
        this.drag.vy *= 0.94;
      }
      // 后坐回稳
      this.recoil *= 1 - Math.min(1, dt * 9);
      this.gunBody.rotation.x = this.recoil;
      this.gunBody.position.z = this.recoil * 1.4;
      const fm = this.flash.material as THREE.MeshBasicMaterial;
      if (fm.opacity > 0) fm.opacity = Math.max(0, fm.opacity - dt * 10);
      if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 240);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    this.onClose?.();
  }
}
