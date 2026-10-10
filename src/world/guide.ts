/**
 * world/guide.ts —— 引路与标记系统（B2 抽离）
 *
 * 归拢 world.ts 的 marker / guide / glint：
 *  - 互动目标标记（ring + dia + pillar + pointLight）
 *  - 地面引路 chevrons（14 枚，随距离淡出）
 *  - 环绕微光 glints（5 枚盘旋，标记可见时才显示）
 *
 * 帧逻辑此前分在 updateGuideTrail（chevron 落位）与 updateAmbient（marker 脉动 + glint 盘旋）
 * 两个方法，现收口为单一 tick，保持与原插值一致。
 */

import * as THREE from 'three';
import { C, canvasTexture, mat } from '../buildkit';

export class GuideRig {
  readonly marker = new THREE.Group();
  markerTarget: { x: number; z: number } | null = null;

  readonly guide = new THREE.Group();
  readonly guideChevs: THREE.Mesh[] = [];
  readonly glintPool: THREE.Mesh[] = [];

  constructor(private scene: THREE.Scene) {
    this.initMarker();
    this.initGuide();
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

    const markerLight = new THREE.PointLight(C.amber, 1.7, 6.5, 2);
    markerLight.position.y = 1.5;
    this.marker.add(markerLight);
    this.marker.userData.light = markerLight;

    this.scene.add(this.marker);
    this.marker.visible = false;
  }

  private initGuide(): void {
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
      m.rotation.order = 'YXZ';
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.045;
      m.visible = false;
      this.guide.add(m);
      this.guideChevs.push(m);
    }
    this.scene.add(this.guide);

    for (let i = 0; i < 12; i++) {
      const g = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.075),
        new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.85 })
      );
      g.visible = false;
      this.scene.add(g);
      this.glintPool.push(g);
    }
  }

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

  /**
   * 每帧：chevron 落位 + marker 脉动 + glint 盘旋
   * 与原 updateGuideTrail + updateAmbient 的 marker 部分行为 1:1
   */
  tick(dt: number, playerPos: { x: number; z: number }, clockT: number): void {
    // —— chevron 引路 ——
    if (!this.marker.visible || !this.markerTarget) {
      for (const m of this.guideChevs) m.visible = false;
    } else {
      const px = playerPos.x;
      const pz = playerPos.z;
      const dx = this.markerTarget.x - px;
      const dz = this.markerTarget.z - pz;
      const dist = Math.hypot(dx, dz);
      const gap = 1.8;
      const startGap = 1.1;
      const ang = Math.atan2(dx, dz);
      const count = Math.min(this.guideChevs.length, Math.max(0, Math.floor((dist - startGap) / gap)));
      for (let i = 0; i < this.guideChevs.length; i++) {
        const chev = this.guideChevs[i];
        if (i >= count) { chev.visible = false; continue; }
        const d = startGap + i * gap;
        chev.position.set(px + Math.sin(ang) * d, 0.045, pz + Math.cos(ang) * d);
        chev.rotation.y = ang;
        chev.visible = true;
        const fade = 1 - Math.min(1, i / Math.max(1, count));
        (chev.material as THREE.MeshBasicMaterial).opacity = 0.16 + fade * 0.5;
      }
    }

    // —— marker 脉动 + glint 盘旋（原属 updateAmbient）——
    if (this.marker.visible) {
      const dia = this.marker.userData.dia as THREE.Mesh;
      dia.rotation.y += dt * 2.4;
      dia.position.y = 1.9 + Math.sin(clockT * 2.6) * 0.14;
      const ring = this.marker.userData.ring as THREE.Mesh;
      const s = 1 + Math.sin(clockT * 2.6) * 0.08;
      ring.scale.set(s, s, s);
      const light = this.marker.userData.light as THREE.PointLight | undefined;
      if (light) light.intensity = 1.5 + Math.sin(clockT * 2.6) * 0.35;
      const mx = this.marker.position.x;
      const mz = this.marker.position.z;
      for (let i = 0; i < this.glintPool.length; i++) {
        const g = this.glintPool[i];
        if (i >= 5) { g.visible = false; continue; }
        const a = clockT * 1.1 + (i / 5) * Math.PI * 2;
        g.position.set(mx + Math.cos(a) * 1.1, 0.7 + Math.sin(clockT * 1.8 + i) * 0.35 + i * 0.25, mz + Math.sin(a) * 1.1);
        g.visible = true;
      }
    } else {
      for (const g of this.glintPool) g.visible = false;
    }
  }
}
