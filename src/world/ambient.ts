/**
 * world/ambient.ts —— 环境动效（B2 抽离）
 *
 * 归拢 world.ts 的 updateAmbient 中与“人无关”的部分：
 *  - 列车（横穿）、烟气（上升+缩放+淡出）、背景行人（往复）、侧门开合插值、浮尘缓漂
 *  - 统一的 clock.t（供 camera breathe、guide 脉动、dust 闪烁复用）
 *
 * 集合（train / smokes / walkers / dusts / sideDoorMesh）仍由 world.ts 的建景阶段填充，
 * 这里只负责每帧的数值推进，集合以引用形式传入或直接持有。
 */

import * as THREE from 'three';

export class AmbientRig {
  clock = { t: 0 };

  // 由建景填充，tick 阶段只读并推进
  train: THREE.Group | null = null;
  smokes: THREE.Mesh[] = [];
  walkers: { g: THREE.Object3D; from: number; to: number; speed: number; z: number }[] = [];
  dusts: THREE.Points[] = [];
  sideDoorMesh: THREE.Object3D | null = null;

  tick(dt: number): void {
    this.clock.t += dt;

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

    // 浮尘缓漂
    for (const pts of this.dusts) {
      pts.rotation.y += dt * 0.02;
      const pm = pts.material as THREE.PointsMaterial;
      pm.opacity = 0.26 + Math.sin(this.clock.t * 0.5 + (pts as unknown as { id: number }).id) * 0.06;
    }
  }
}
