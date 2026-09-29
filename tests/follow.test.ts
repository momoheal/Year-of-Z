import { describe, expect, it } from 'vitest';
import { createFollower, recallFollower, stepFollower, FOLLOW_DEFAULTS } from '../src/follow';

/** 推进 n 帧（固定 60fps），返回同行者状态 */
function run(target: { x: number; z: number }, frames: number, opts = {}, start = createFollower(0, 0)) {
  for (let i = 0; i < frames; i++) stepFollower(start, target, 1 / 60, opts);
  return start;
}

describe('同行者跟随（梁医生 · 同行不入队）', () => {
  it('会跟上来，但停在说话距离外，不贴脸', () => {
    const s = run({ x: 8, z: 0 }, 600);
    const d = Math.hypot(8 - s.x, 0 - s.z);
    expect(d).toBeGreaterThan(FOLLOW_DEFAULTS.keep - 0.15);
    expect(d).toBeLessThan(FOLLOW_DEFAULTS.keep + 0.15);
  });

  it('玩家站着不动时同行者也不动（不会绕圈、不会抖）', () => {
    const s = run({ x: 1.0, z: 0 }, 120); // 1.0 < keep
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    expect(s.moved).toBe(0);
  });

  it('永远不瞬移：单帧位移不超过最大速度 × dt', () => {
    const s = createFollower(0, 0);
    for (let i = 0; i < 300; i++) {
      stepFollower(s, { x: 40, z: 40 }, 1 / 60);
      expect(s.moved).toBeLessThanOrEqual(FOLLOW_DEFAULTS.speed / 60 + 1e-9);
    }
  });

  it('对话时站定，但会转头看向说话的人', () => {
    const s = createFollower(0, 0, 0);
    stepFollower(s, { x: 5, z: 0 }, 1 / 60, { halted: true });
    expect(s.moved).toBe(0);
    expect(s.x).toBe(0);
    expect(s.facing).toBeCloseTo(Math.PI / 2, 5); // 朝 +X
  });

  it('掉队太远会直接归位到身后，而不是一路穿墙追人', () => {
    const s = createFollower(-30, -30);
    expect(recallFollower(s, { x: 0, z: 0 })).toBe(true);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(2);
    // 正常距离内不归位
    const t = createFollower(2, 0);
    expect(recallFollower(t, { x: 0, z: 0 })).toBe(false);
  });

  it('越远走得越快，但不会超过跑步速度（他不是在追你，是在跟着走）', () => {
    const near = createFollower(0, 0);
    stepFollower(near, { x: 2.6, z: 0 }, 1 / 60);
    const far = createFollower(0, 0);
    stepFollower(far, { x: 12, z: 0 }, 1 / 60);
    expect(far.moved).toBeGreaterThan(near.moved);
    expect(far.moved * 60).toBeLessThanOrEqual(FOLLOW_DEFAULTS.speed + 1e-9);
  });
});
