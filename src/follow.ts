/**
 * follow.ts —— 同行者跟随的纯逻辑（不依赖 THREE / DOM，可单测）
 *
 * 用于梁医生这样的**同行但不入队**的角色（doc/10 伙伴线的最小实现）：
 *   - 只跟着走，不参与交互、不参与战斗、不替玩家做决定；
 *   - 保持一个说话距离（keep），太近就站住，太远就快走几步追上；
 *   - 对话打开时站定（halted）——不要有人在你说话时绕着你转；
 *   - 速度有上限，且永远不会瞬移（每帧位移不超过 speed*dt）。
 *
 * world.ts 只负责把结果画出来（朝向、步态、y 轴小起伏）。
 */

export interface FollowState {
  x: number;
  z: number;
  /** 当前朝向（弧度，0 = +Z） */
  facing: number;
  /** 本帧实际走了多远（米），供步态动画使用 */
  moved: number;
}

export interface FollowOpts {
  /** 站定的舒适距离（米） */
  keep?: number;
  /** 超过这个距离就用最快速度追（米） */
  hurry?: number;
  /** 最大速度（米/秒） */
  speed?: number;
  /** 对话/过场时站定 */
  halted?: boolean;
}

export const FOLLOW_DEFAULTS = { keep: 1.7, hurry: 4.5, speed: 3.4 };

export function createFollower(x: number, z: number, facing = 0): FollowState {
  return { x, z, facing, moved: 0 };
}

/**
 * 推进一帧。返回同一个对象（原地修改），moved 为本帧位移。
 * 纯函数式的部分：给定输入，输出唯一确定，不读取任何全局状态。
 */
export function stepFollower(
  s: FollowState,
  target: { x: number; z: number },
  dt: number,
  opts: FollowOpts = {}
): FollowState {
  const keep = opts.keep ?? FOLLOW_DEFAULTS.keep;
  const hurry = opts.hurry ?? FOLLOW_DEFAULTS.hurry;
  const maxSpeed = opts.speed ?? FOLLOW_DEFAULTS.speed;
  s.moved = 0;
  if (dt <= 0) return s;

  const dx = target.x - s.x;
  const dz = target.z - s.z;
  const dist = Math.hypot(dx, dz);

  // 对话时站定；但仍然把脸转向对方（人会看着说话的人）
  if (opts.halted) {
    if (dist > 0.05) s.facing = Math.atan2(dx, dz);
    return s;
  }
  if (dist <= keep) return s;

  // 越远走得越快，到 hurry 以外用满速；永远不瞬移
  const t = Math.min(1, (dist - keep) / Math.max(0.001, hurry - keep));
  const speed = maxSpeed * (0.45 + 0.55 * t);
  const step = Math.min(dist - keep, speed * dt);
  s.x += (dx / dist) * step;
  s.z += (dz / dist) * step;
  s.facing = Math.atan2(dx, dz);
  s.moved = step;
  return s;
}

/**
 * 掉队太远（比如玩家切了场景又跑了一段）时直接归位到玩家身后，
 * 避免同行者一路穿墙追人。返回 true 表示做了归位。
 */
export function recallFollower(s: FollowState, target: { x: number; z: number }, limit = 14): boolean {
  const dist = Math.hypot(target.x - s.x, target.z - s.z);
  if (dist <= limit) return false;
  s.x = target.x - Math.sin(s.facing) * 1.4;
  s.z = target.z - Math.cos(s.facing) * 1.4;
  s.moved = 0;
  return true;
}
