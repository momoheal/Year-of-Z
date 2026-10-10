/**
 * world/camera.ts —— 相机系统（从 world.ts 拆出，第一刀）
 *
 * 固定等距正交机位：位置与 lookAt 共用唯一焦点 camFocus，避免两套目标
 * 互相追赶造成启停抽动。支持前瞻(lead)、呼吸(breathe)与缩放(zoomScale)。
 */

import * as THREE from 'three';

const V = THREE.Vector3;

export class CameraRig {
  readonly camOffset = new V(9, 33, 24);
  camFocus = new V(-12, 0, 37);
  lastMove = { x: 0, z: 0 };
  zoomScale = 1;

  constructor(private camera: THREE.OrthographicCamera) {}

  setEncounter(on: boolean): void {
    this.zoomScale = on ? 1.32 : 1;
  }

  snapTo(x: number, z: number): void {
    this.camFocus.set(x, 0, z);
  }

  /** 每帧：根据玩家位移与朝向更新焦点，再写回相机 */
  tick(
    dt: number,
    playerPos: { x: number; z: number },
    moveLen: number,
    clockT: number
  ): void {
    const lead = moveLen > 0.001 ? 1.35 * Math.min(1, moveLen) : 0;
    const targetX = playerPos.x + this.lastMove.x * lead;
    const targetZ = playerPos.z + this.lastMove.z * lead;
    const camDamping = 1 - Math.exp(-dt * 6);
    this.camFocus.x += (targetX - this.camFocus.x) * camDamping;
    this.camFocus.z += (targetZ - this.camFocus.z) * camDamping;
    const breathe = moveLen < 0.001 ? Math.sin(clockT * 1.7) * 0.09 : 0;
    this.camera.position.set(
      this.camFocus.x + this.camOffset.x,
      this.camOffset.y + breathe,
      this.camFocus.z + this.camOffset.z
    );
    this.camera.lookAt(this.camFocus.x, 1.0 + breathe * 0.5, this.camFocus.z);
  }

  resize(container: HTMLElement, renderer: THREE.WebGLRenderer): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    const halfH = (aspect >= 1.25 ? 11.5 : 14.5) / this.zoomScale;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** 世界位移在当前机位下的屏幕方位角（度） */
  screenBearing(dx: number, dz: number): number {
    const right = new V(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new V(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const d = new V(dx, 0, dz);
    const sx = d.dot(right);
    const sy = d.dot(up);
    return Math.atan2(sx, sy) * 180 / Math.PI;
  }

  project(x: number, y: number, z: number): { nx: number; ny: number } {
    const v = new V(x, y, z).project(this.camera);
    return { nx: v.x, ny: v.y };
  }

  screenToGround(
    cx: number, cy: number,
    raycaster: THREE.Raycaster,
    groundPlane: THREE.Plane,
    domElement: HTMLElement
  ): { x: number; z: number } | null {
    const rect = domElement.getBoundingClientRect();
    const nx = ((cx - rect.left) / rect.width) * 2 - 1;
    const ny = -(((cy - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const out = new V();
    return raycaster.ray.intersectPlane(groundPlane, out) ? { x: out.x, z: out.z } : null;
  }
}
