/**
 * world/physics.ts —— 物理系统（从 world.ts 拆出，第一刀）
 *
 * 封装 cannon-es 世界与静态盒体的增删。场景相关的一组墙（PARK_WALLS /
 * KITCHEN_WALLS / SCENERY_BLOCKERS）仍由 world.ts 决定“放哪些”，这里只负责
 * “怎么放 / 怎么删 / 怎么每帧步进”。
 */

import { Body, Box, Sphere, Vec3, World as PhysWorld } from 'cannon-es';
import { PLAYER_R } from '../buildkit';

export interface PhysCtx {
  world: PhysWorld;
  player: Body;
  named: Map<string, Body>;
}

export function createPhysics(): PhysCtx {
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

export function addWall(
  ctx: PhysCtx,
  cx: number, cz: number,
  hx: number, hz: number,
  h = 3, name?: string
): void {
  const b = new Body({ mass: 0, shape: new Box(new Vec3(hx, h / 2, hz)), position: new Vec3(cx, h / 2, cz) });
  ctx.world.addBody(b);
  if (name) ctx.named.set(name, b);
}

export function removeNamedWall(ctx: PhysCtx, name: string): void {
  const b = ctx.named.get(name);
  if (b) {
    ctx.world.removeBody(b);
    ctx.named.delete(name);
  }
}

export function stepPhysics(ctx: PhysCtx, dt: number): void {
  ctx.world.step(1 / 60, dt, 3);
  // 锁定平面：cannon 无重力世界仍可能产生 y 漂移
  ctx.player.position.y = PLAYER_R;
  ctx.player.velocity.y = 0;
}
