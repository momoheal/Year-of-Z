/**
 * world/light.ts —— 光照系统（从 world.ts 拆出，第一刀）
 *
 * 只管三件事：预设、插值、在每帧把 THREE 的光与雾同步到当前值。
 * world.ts 仍持有 hemi/sun/scene/lamps 的实例，这里只持有数值与过渡状态，
 * 通过方法把“数值 → THREE 对象”写回去——便于单测与复用。
 */

import * as THREE from 'three';
import type { LightMode, LightPreset } from '../story';

export interface LightDef {
  hemiSky: number; hemiGround: number; hemiInt: number;
  sun: number; sunInt: number; sunPos: [number, number, number];
  bg: number; fogNear: number; fogFar: number; lamps: number;
}

export const LIGHTS: Record<LightPreset, LightDef> = {
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

export class LightRig {
  cur: LightDef = { ...LIGHTS.dawn };
  from: LightDef = { ...LIGHTS.dawn };
  to: LightDef = { ...LIGHTS.dawn };
  t = 1;

  setMode(mode: LightMode, autoPreset: LightPreset): void {
    const target = mode === 'auto' ? autoPreset : mode;
    const to = LIGHTS[target];
    this.from = { ...this.cur };
    this.to = { ...to };
    this.t = 0;
  }

  /** 插值推进，需每帧调用；返回当前 cur 的引用 */
  tick(dt: number): LightDef {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / 1.4);
      const t = this.t * this.t * (3 - 2 * this.t);
      const lerpN = (a: number, b: number) => a + (b - a) * t;
      const ca = new THREE.Color(), cb = new THREE.Color();
      const lerpC = (a: number, b: number) => ca.set(a).lerp(cb.set(b), t).getHex();
      const cur = this.cur;
      const from = this.from, to = this.to;
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
    return this.cur;
  }

  /** 把当前 cur 写回 THREE 场景 */
  syncToScene(
    hemi: THREE.HemisphereLight,
    sun: THREE.DirectionalLight,
    scene: THREE.Scene,
    lampGlow: THREE.Mesh[],
    lampLights: THREE.PointLight[]
  ): void {
    const cur = this.cur;
    hemi.color.setHex(cur.hemiSky);
    hemi.groundColor.setHex(cur.hemiGround);
    hemi.intensity = cur.hemiInt;
    sun.color.setHex(cur.sun);
    sun.intensity = cur.sunInt;
    (scene.background as THREE.Color | null) ?? (scene.background = new THREE.Color());
    (scene.background as THREE.Color).setHex(cur.bg);
    (scene.fog as THREE.Fog).color.setHex(cur.bg);
    (scene.fog as THREE.Fog).near = cur.fogNear;
    (scene.fog as THREE.Fog).far = cur.fogFar;
    for (const l of lampGlow) {
      (l.material as THREE.MeshLambertMaterial).emissiveIntensity = cur.lamps * 0.9;
    }
    for (const pl of lampLights) {
      pl.intensity = cur.lamps * 14;
    }
  }
}
