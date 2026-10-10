/**
 * world/actor.ts —— 角色系统（B1 抽离）
 *
 * 归拢 world.ts 散在 8 处的“人/狗/同行者”：
 *  - 玩家：鸭子走 bob、朝向平滑、包与影子
 *  - 同行者：follow.ts 纯逻辑 + 步态
 *  - 狗：tail 摆动 + follow/warehouse 门外停靠
 *  - 兼容：对外仍由 GameWorld 暴露 setCompanion / getCompanion / setCompanionHalt / placeDogByState
 *
 * 不碰：遭遇战 foe/heldChair/heldKnife（B3）、NPC Lao/Worker 站位（仍在 world.ts）、物理与相机
 */

import * as THREE from 'three';
import type { GameState } from '../story';
import { createFollower, recallFollower, stepFollower, type FollowState } from '../follow';
import {
  WALK_SPEED, RUN_SPEED,
  box, makePerson, makeDog
} from '../buildkit';

export type DogMode = 'hidden' | 'idle' | 'follow' | 'shed';

const V = THREE.Vector3;

export class ActorRig {
  // 玩家
  readonly playerGroup = new THREE.Group();
  playerMesh: THREE.Group;
  facing = 0;
  bobT = 0;
  bobAmt = 0;

  // 同行者
  readonly companion = makePerson({ coat: 0xd8dbd6, pants: 0x4a5058, skin: 0xd2b193 });
  companionOn = false;
  companionHalt = false;
  companionState: FollowState = createFollower(0, 0);
  companionBob = 0;
  companionAmt = 0;

  // 狗
  readonly dog = makeDog();
  dogMode: DogMode = 'hidden';
  readonly dogVel = new V();
  tailT = 0;

  constructor(scene: THREE.Scene) {
    // 玩家 mesh + 包 + 影子（与原 world.ts 构造一致，保持视觉一致）
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
    scene.add(this.playerGroup);

    // 同行者与狗
    this.companion.visible = false;
    scene.add(this.companion);
    scene.add(this.dog);
    this.dog.visible = false;
  }

  // —— 对外：同行者（world.ts 做 roaming 过滤，这里只做落位） ——

  setCompanionVisible(on: boolean, spawn?: { x: number; z: number }, playerPos?: { x: number; z: number }): void {
    if (!on) {
      this.companionOn = false;
      this.companion.visible = false;
      return;
    }
    const px = spawn ? spawn.x : playerPos?.x ?? 0;
    const pz = spawn ? spawn.z : playerPos?.z ?? 0;
    this.companionOn = true;
    this.companion.visible = true;
    this.companionState = createFollower(px - 1.2, pz + 0.9, Math.PI);
    this.companion.position.set(this.companionState.x, 0, this.companionState.z);
  }

  setCompanionHalt(on: boolean): void {
    this.companionHalt = on;
  }

  getCompanion(): { visible: boolean; x: number; z: number } {
    return { visible: this.companionOn, x: this.companionState.x, z: this.companionState.z };
  }

  // —— 狗 ——

  placeDogByState(state?: GameState): void {
    if (this.dogMode === 'idle') {
      this.dog.position.set(-23.8, 0, 32.2);
      this.dog.rotation.y = 0.9;
    } else if (this.dogMode === 'shed') {
      this.dog.position.set(-15.4, 0, 33.2);
      this.dog.rotation.y = 2.6;
    } else if (this.dogMode === 'follow' && state) {
      this.dog.position.set(state.player.x - 2.5, 0, state.player.z - 2.5);
    }
  }

  // —— 每帧 ——

  /** 玩家朝向平滑 + 鸭子走（与原 animatePlayer 一致） */
  private tickPlayer(dt: number, len: number, running: boolean, faceTo: number | null): void {
    if (faceTo !== null) this.facing = faceTo;
    // 平滑转向
    let d = this.facing - this.playerGroup.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.playerGroup.rotation.y += d * Math.min(1, dt * 14);

    const legL = this.playerMesh.userData.legL as THREE.Group | undefined;
    const legR = this.playerMesh.userData.legR as THREE.Group | undefined;
    const armL = this.playerMesh.userData.armL as THREE.Group | undefined;
    const armR = this.playerMesh.userData.armR as THREE.Group | undefined;
    const head = this.playerMesh.userData.head as THREE.Group | undefined;
    const speedRatio = (running ? RUN_SPEED : WALK_SPEED) / RUN_SPEED;
    if (len > 0.001) {
      this.bobT += (len * (running ? RUN_SPEED : WALK_SPEED) * dt / (2.2 / 3)) * Math.PI;
      this.bobAmt += (1 - this.bobAmt) * Math.min(1, dt * 10);
    } else {
      this.bobAmt *= Math.max(0, 1 - dt * 8);
    }
    const swing = Math.sin(this.bobT) * 0.62 * this.bobAmt * Math.max(0.55, speedRatio);
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    if (armL) armL.rotation.x = -swing * 0.72;
    if (armR) armR.rotation.x = swing * 0.72;
    this.playerMesh.position.y = Math.abs(Math.sin(this.bobT)) * 0.05 * this.bobAmt;
    this.playerMesh.rotation.x = running ? 0.07 * this.bobAmt : 0.03 * this.bobAmt;
    if (head) head.rotation.x = -(running ? 0.05 : 0.02) * this.bobAmt + Math.sin(this.bobT * 0.5) * 0.02 * this.bobAmt;
  }

  private tickCompanion(dt: number, playerPos: { x: number; z: number }): void {
    if (!this.companionOn) return;
    const target = { x: playerPos.x, z: playerPos.z };
    recallFollower(this.companionState, target);
    stepFollower(this.companionState, target, dt, { halted: this.companionHalt });
    const st = this.companionState;
    this.companion.position.set(st.x, 0, st.z);
    this.companion.rotation.y = st.facing;
    const legL = this.companion.userData.legL as THREE.Group | undefined;
    const legR = this.companion.userData.legR as THREE.Group | undefined;
    const armL = this.companion.userData.armL as THREE.Group | undefined;
    const armR = this.companion.userData.armR as THREE.Group | undefined;
    if (st.moved > 0.0005) {
      this.companionBob += (st.moved / (2.2 / 3)) * Math.PI;
      this.companionAmt += (1 - this.companionAmt) * Math.min(1, dt * 9);
    } else {
      this.companionAmt *= Math.max(0, 1 - dt * 7);
    }
    const swing = Math.sin(this.companionBob) * 0.5 * this.companionAmt;
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    if (armL) armL.rotation.x = -swing * 0.6;
    if (armR) armR.rotation.x = swing * 0.6;
    this.companion.position.y = Math.abs(Math.sin(this.companionBob)) * 0.04 * this.companionAmt;
  }

  private tickDog(dt: number, playerPos: { x: number; z: number }): void {
    if (!this.dog.visible) return;
    this.tailT += dt * 7;
    const tail = this.dog.userData.tail as THREE.Mesh | undefined;
    if (tail) tail.rotation.y = Math.sin(this.tailT) * 0.5;
    if (this.dogMode === 'follow') {
      const px = playerPos.x;
      const pz = playerPos.z;
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
        this.dog.position.y = Math.abs(Math.sin(this.tailT * 1.9)) * 0.05;
      } else {
        this.dog.position.y = 0;
      }
    }
  }

  /**
   * 供 world.step 每帧调用：更新玩家 + 同行者 + 狗
   * 注意：playerGroup 的世界位移由 world.ts 的物理结果写入，这里只做朝向与动画
   */
  tick(dt: number, len: number, running: boolean, faceTo: number | null, playerPos: { x: number; z: number }): void {
    // facing 的外部设定（非 faceTo 锁定）已在 world.step 里处理，这里只处理 faceTo 覆盖
    this.tickPlayer(dt, len, running, faceTo);
    this.tickCompanion(dt, playerPos);
    this.tickDog(dt, playerPos);
  }

  /** 供 setScene 在切图时直接落位（保持与原逻辑一致） */
  snapPlayerTo(x: number, z: number): void {
    this.playerGroup.position.set(x, 0, z);
  }
}
