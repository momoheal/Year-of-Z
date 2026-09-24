import { describe, expect, it } from 'vitest';
import {
  ARENA, BLOCKERS, TUNING,
  canSprint, createCombat, isLocked, retryCombat, stepCombat,
  type CombatEvent, type CombatInput, type CombatState
} from '../src/combat';

const DT = 1 / 60;

function baseInput(over: Partial<CombatInput> = {}): CombatInput {
  return {
    dt: DT,
    player: { x: 2, z: 3 },
    sprinting: false,
    guardHeld: false,
    guardPressed: false,
    strikePressed: false,
    interactPressed: false,
    ...over
  };
}

/** 跑 n 帧，收集事件 */
function run(s: CombatState, frames: number, make: (i: number) => Partial<CombatInput> = () => ({})): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < frames; i++) out.push(...stepCombat(s, baseInput(make(i))));
  return out;
}

function types(evs: CombatEvent[]): string[] {
  return evs.map((e) => e.type);
}

/** 跑到满足条件（或超时）为止，返回途中的事件 */
function runUntil(
  s: CombatState,
  pred: (s: CombatState) => boolean,
  maxFrames = 60 * 30,
  make: (i: number) => Partial<CombatInput> = () => ({})
): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < maxFrames && !pred(s); i++) out.push(...stepCombat(s, baseInput(make(i))));
  return out;
}

describe('遭遇战 · 开场与基本压迫', () => {
  it('门撞开后有一段不可被抓的缓冲，之后来人才开始逼近', () => {
    const s = createCombat();
    expect(s.phase).toBe('burst');
    const evs = run(s, Math.round(TUNING.burstTime * 60) - 2);
    expect(types(evs)).not.toContain('grab');
    expect(s.enemy.state).toBe('burst');
    run(s, 6);
    expect(s.enemy.state).not.toBe('burst');
    expect(s.phase).toBe('bare');
  });

  it('站着不动、不挡：会被扑住，挣不开就是失败（不是死亡演出）', () => {
    const s = createCombat();
    const evs = runUntil(s, (c) => c.outcome !== 'none');
    expect(types(evs)).toContain('grab');
    expect(s.grabs).toBeGreaterThan(0);
    // 一次也不按，grabTime 后判定失败
    expect(s.outcome).toBe('fail');
    expect(isLocked(s)).toBe(true);
    // 失败后状态冻结，不再产生任何事件
    expect(run(s, 30)).toHaveLength(0);
  });

  it('被扑住后连按可以挣开，来人被推开并踉跄', () => {
    const s = createCombat();
    runUntil(s, (c) => c.enemy.state === 'grab');
    expect(s.enemy.state).toBe('grab');
    const before = s.grabs;
    const evs = run(s, TUNING.grabPresses, () => ({ guardPressed: true }));
    expect(types(evs)).toContain('escape');
    expect(s.enemy.state).toBe('stagger');
    expect(s.outcome).toBe('none');
    expect(s.grabs).toBe(before); // grabs 在被扑住时就记过了，挣脱不重复计
  });
});

describe('遭遇战 · 椅子（第一件能挡的东西）', () => {
  it('走到椅子边按 E 才拿得到，远处按 E 无效', () => {
    const s = createCombat();
    run(s, 4, () => ({ player: { x: 5, z: -2 }, interactPressed: true }));
    expect(s.hasChair).toBe(false);
    const evs = run(s, 1, () => ({ player: { x: ARENA.chairX, z: ARENA.chairZ }, interactPressed: true }));
    expect(types(evs)).toContain('take-chair');
    expect(s.hasChair).toBe(true);
    expect(s.phase).toBe('chair');
  });

  it('椅子只能挡两下，散架后回到空手，并提示去备餐台', () => {
    const s = createCombat();
    const at = { x: ARENA.chairX, z: ARENA.chairZ };
    run(s, 1, () => ({ player: at, interactPressed: true }));
    const evs = runUntil(s, (c) => c.chairTaken && !c.hasChair, 60 * 25, () => ({ player: at, guardHeld: true }));
    const blocks = types(evs).filter((t) => t === 'block');
    expect(blocks.length).toBe(TUNING.chairHp);
    expect(types(evs)).toContain('chair-break');
    expect(s.hasChair).toBe(false);
    expect(s.chairTaken).toBe(true);
    expect(s.phase).toBe('bare');
    expect(s.prompt).toContain('备餐台');
  });
});

describe('遭遇战 · 刀', () => {
  /** 故事顺序：先拿椅子 → 椅子散架 → 才会去抓备餐台上的刀 */
  function toKnife(): CombatState {
    const s = createCombat();
    const chair = { x: ARENA.chairX, z: ARENA.chairZ };
    run(s, 1, () => ({ player: chair, interactPressed: true }));
    runUntil(s, (c) => c.chairTaken && !c.hasChair, 60 * 25, () => ({ player: chair, guardHeld: true }));
    run(s, 1, () => ({ player: { x: ARENA.knifeX, z: ARENA.knifeZ }, interactPressed: true }));
    return s;
  }

  it('刀必须在备餐台上拿，拿到后进入"先挡再挥"', () => {
    const s = toKnife();
    expect(s.hasKnife).toBe(true);
    expect(s.knifeTaken).toBe(true);
    expect(s.phase).toBe('knife');
  });

  it('手里还举着椅子时拿不到刀（顺序：退 → 挡 → 椅子散了 → 刀）', () => {
    const s = createCombat();
    const chair = { x: ARENA.chairX, z: ARENA.chairZ };
    run(s, 1, () => ({ player: chair, interactPressed: true }));
    expect(s.hasChair).toBe(true);
    const evs = run(s, 3, () => ({ player: { x: ARENA.knifeX, z: ARENA.knifeZ }, interactPressed: true }));
    expect(types(evs)).not.toContain('take-knife');
    expect(s.hasKnife).toBe(false);
    // 一开始就跑去备餐台也拿不到：他还没有想到刀
    const fresh = createCombat();
    run(fresh, 3, () => ({ player: { x: ARENA.knifeX, z: ARENA.knifeZ }, interactPressed: true }));
    expect(fresh.hasKnife).toBe(false);
  });

  it('挡住才有那一下：挡→缠住→挥 = 结束；不挡就是被扑住', () => {
    const s = toKnife();
    const at = { x: ARENA.knifeX, z: ARENA.knifeZ };
    const evs = runUntil(s, (c) => c.enemy.state === 'clinch', 60 * 25, () => ({ player: at, guardHeld: true }));
    expect(types(evs)).toContain('clinch');
    expect(s.enemy.state).toBe('clinch');
    const fin = run(s, 1, () => ({ player: at, strikePressed: true }));
    expect(types(fin)).toContain('win');
    expect(s.outcome).toBe('win');
    expect(s.enemy.state).toBe('down');
    expect(s.strikes).toBe(1);
  });

  it('缠住的时间过去仍然会被扑住，不会自动获胜', () => {
    const s = toKnife();
    const at = { x: ARENA.knifeX, z: ARENA.knifeZ };
    runUntil(s, (c) => c.enemy.state === 'clinch', 60 * 25, () => ({ player: at, guardHeld: true }));
    expect(s.enemy.state).toBe('clinch');
    const evs = run(s, Math.ceil(TUNING.clinchTime * 60) + 2, () => ({ player: at }));
    expect(types(evs)).toContain('grab');
    expect(s.outcome).toBe('none');
  });

  it('结束就是结束：不能补刀、不能追击、不再产生任何事件', () => {
    const s = toKnife();
    const at = { x: ARENA.knifeX, z: ARENA.knifeZ };
    runUntil(s, (c) => c.enemy.state === 'clinch', 60 * 25, () => ({ player: at, guardHeld: true }));
    run(s, 1, () => ({ player: at, strikePressed: true }));
    const after = run(s, 120, () => ({ player: at, strikePressed: true, guardHeld: true }));
    expect(after).toHaveLength(0);
    expect(s.strikes).toBe(1);
    expect(s.enemy.state).toBe('down');
  });
});

describe('遭遇战 · 数值与场地', () => {
  it('冲刺消耗体力，耗尽后不能再冲刺，站定会回复', () => {
    const s = createCombat();
    run(s, 60 * 3, () => ({ player: { x: 6, z: 4.5 }, sprinting: true }));
    expect(s.stamina).toBeLessThan(TUNING.staminaMax * 0.8);
    s.stamina = 4;
    expect(canSprint(s)).toBe(false);
    run(s, 60 * 2, () => ({ player: { x: 6, z: 4.5 } }));
    expect(s.stamina).toBeGreaterThan(20);
    expect(canSprint(s)).toBe(true);
  });

  it('来人不会穿过长桌与备餐台，也不会走出房间', () => {
    const s = createCombat();
    run(s, 60 * 8, (i) => ({ player: { x: i % 2 ? 6.2 : -6.2, z: 4.6 } }));
    for (const b of BLOCKERS) {
      const inside = Math.abs(s.enemy.x - b.x) < b.hx && Math.abs(s.enemy.z - b.z) < b.hz;
      expect(inside).toBe(false);
    }
    expect(s.enemy.x).toBeGreaterThanOrEqual(ARENA.minX);
    expect(s.enemy.x).toBeLessThanOrEqual(ARENA.maxX);
    expect(s.enemy.z).toBeGreaterThanOrEqual(ARENA.minZ);
    expect(s.enemy.z).toBeLessThanOrEqual(ARENA.maxZ);
  });

  it('失败后重来只重置这场遭遇，并累计重试次数', () => {
    const s = createCombat();
    runUntil(s, (c) => c.outcome !== 'none');
    expect(s.outcome).toBe('fail');
    const again = retryCombat(s);
    expect(again.outcome).toBe('none');
    expect(again.retries).toBe(1);
    expect(again.hasKnife).toBe(false);
    expect(again.chairTaken).toBe(false);
    expect(again.phase).toBe('burst');
  });
});

// ---------------------------------------------------------------- 可玩性回归
// 用一个"会退、会挡、会拿东西"的脚本玩家跑完整场：既要能打赢（不是必死关卡），
// 也不能一进门就赢（不是走过场）。数值调整后这条用例会先叫。

function simulate(policyRun = true): { s: CombatState; seconds: number } {
  const s = createCombat();
  const p = { x: 0.5, z: 4.0 }; // 从厨房门口进来
  const WALK = 3.3;
  const RUN = 5.2;
  let t = 0;
  for (let i = 0; i < 60 * 90 && s.outcome === 'none'; i++) {
    const target = !s.chairTaken ? { x: ARENA.chairX, z: ARENA.chairZ }
      : !s.knifeTaken ? { x: ARENA.knifeX, z: ARENA.knifeZ }
        : { x: ARENA.knifeX, z: ARENA.knifeZ };
    const dE = Math.hypot(s.enemy.x - p.x, s.enemy.z - p.z);
    const grabbed = s.enemy.state === 'grab';
    const clinch = s.enemy.state === 'clinch';
    // 太近就退开，否则去拿手边的东西
    let dirX = target.x - p.x;
    let dirZ = target.z - p.z;
    if (dE < 2.4 && !s.hasKnife) { dirX = p.x - s.enemy.x; dirZ = p.z - s.enemy.z; }
    const len = Math.hypot(dirX, dirZ) || 1;
    const sprinting = policyRun && dE < 3.4 && canSprint(s) && !grabbed && !clinch;
    const speed = sprinting ? RUN : WALK;
    if (!grabbed && !clinch) {
      p.x += (dirX / len) * speed * DT;
      p.z += (dirZ / len) * speed * DT;
      p.x = Math.min(ARENA.maxX, Math.max(ARENA.minX, p.x));
      p.z = Math.min(ARENA.maxZ, Math.max(ARENA.minZ, p.z));
      for (const b of BLOCKERS) {
        const ox = b.hx + 0.45 - Math.abs(p.x - b.x);
        const oz = b.hz + 0.45 - Math.abs(p.z - b.z);
        if (ox > 0 && oz > 0) {
          if (ox < oz) p.x += p.x >= b.x ? ox : -ox;
          else p.z += p.z >= b.z ? oz : -oz;
        }
      }
    }
    const nearTarget = Math.hypot(target.x - p.x, target.z - p.z) < 1.2;
    stepCombat(s, {
      dt: DT,
      player: { x: p.x, z: p.z },
      sprinting,
      guardHeld: (s.hasChair || s.hasKnife) && dE < 2.0,
      guardPressed: grabbed && i % 6 === 0,
      strikePressed: clinch,
      interactPressed: nearTarget && !grabbed
    });
    t += DT;
  }
  return { s, seconds: t };
}

describe('遭遇战 · 可玩性', () => {
  it('会退会挡的玩家打得赢，但打不成走过场（十几秒以上，一刀结束）', () => {
    const { s, seconds } = simulate();
    expect(s.outcome).toBe('win');
    expect(s.strikes).toBe(1);
    expect(seconds).toBeGreaterThan(8);
    expect(seconds).toBeLessThan(75);
    expect(s.chairTaken).toBe(true);
    expect(s.knifeTaken).toBe(true);
  });
});
