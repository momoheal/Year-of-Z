/**
 * combat.ts —— 第三章《今天不煮了》厨房遭遇战内核（纯逻辑，不依赖 DOM / three.js）
 *
 * 叙事基线：doc/08「那间小屋」。冯志远发病后撞开值班室门，先扑倒父亲，再扑向许晨；
 * 许晨没有枪、没有训练，能做的只有退、挡、以及在被逼到备餐台时抓起那把不属于他的刀。
 *
 * 设计红线（doc/00、doc/23、doc/24）：
 *   - 只有一名来人，不可连杀、不可追击、不可补刀；结束即结束。
 *   - 玩家不是战士：跑动要耗体力，推挡会散架，一切动作都是被动的。
 *   - 失败不是死亡演出，而是"被扑倒在地"，可以从这一刻重来。
 *
 * 本文件只做状态机与数值：位置、计时、体力、事件。渲染在 world.ts，输入在 main.ts。
 */

// ---------------------------------------------------------------- 场地

/** 临时厨房（活动室）可战斗区域与遮挡（与 world.ts buildKitchen / mapdata 保持一致） */
export const ARENA = {
  minX: -6.6, maxX: 6.6, minZ: -4.8, maxZ: 4.8,
  /** 值班室门口：冯志远冲出来的位置 */
  doorX: -4.6, doorZ: -4.6,
  /** 椅子（第一件能挡的东西） */
  chairX: -2.4, chairZ: 2.5,
  /** 备餐台砧板：那把刀 */
  knifeX: 4.4, knifeZ: 0.9
};

/** 桌台遮挡（矩形半宽/半深）：双方都绕行，不许穿模 */
export const BLOCKERS: { x: number; z: number; hx: number; hz: number }[] = [
  { x: 0, z: -3.0, hx: 3.4, hz: 0.55 },   // 长桌（十七只碗）
  { x: 5.5, z: 0.9, hx: 0.6, hz: 2.1 },   // 备餐台
  { x: -5.9, z: -0.6, hx: 0.55, hz: 1.8 } // 窗下电饭锅台
];

// ---------------------------------------------------------------- 数值

export const TUNING = {
  enemySpeed: 3.05,
  lungeSpeed: 7.4,
  lungeRange: 3.6,
  lungeWindup: 0.26,
  lungeTime: 0.46,
  lungeRecover: 0.62,
  lungeCooldown: 1.15,
  contact: 0.95,
  burstTime: 1.1,
  /** 体力 */
  staminaMax: 100,
  staminaRegen: 15,
  sprintDrain: 21,
  blockCost: 16,
  shoveCost: 27,
  escapeCost: 18,
  /** 推挡：椅子能扛几下 */
  chairHp: 2,
  chairKnock: 2.5,
  chairStagger: 1.15,
  bareKnock: 1.15,
  bareStagger: 0.5,
  /** 被扑住 */
  grabTime: 2.4,
  grabPresses: 5,
  /** 持刀被贴住后，抬臂挡住的那一下能撑多久 */
  clinchTime: 1.5,
  pickupRange: 1.7
} as const;

// ---------------------------------------------------------------- 类型

export type CombatPhase = 'burst' | 'bare' | 'chair' | 'knife' | 'ended';
export type EnemyState = 'burst' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stagger' | 'grab' | 'clinch' | 'down';
export type CombatOutcome = 'none' | 'win' | 'fail';

export type CombatEventType =
  | 'burst-done'     // 门撞开、父亲被扑倒的一瞬过去了
  | 'take-chair'
  | 'take-knife'
  | 'block'          // 用椅子挡住一下
  | 'chair-break'    // 椅子散架
  | 'shove'          // 空手推开（勉强）
  | 'lunge'          // 他扑过来了
  | 'grab'           // 被按住
  | 'escape'         // 挣开
  | 'clinch'         // 抬臂挡住了，刀还在手里
  | 'win'
  | 'fail';

export interface CombatEvent { type: CombatEventType }

export interface CombatInput {
  dt: number;
  /** 玩家当前位置（由物理世界给出） */
  player: { x: number; z: number };
  /** 本帧是否在冲刺（用于耗体力；体力见 canSprint） */
  sprinting: boolean;
  /** 抬臂/挡：按住 */
  guardHeld: boolean;
  /** 本帧按下（边沿） */
  guardPressed: boolean;
  strikePressed: boolean;
  interactPressed: boolean;
}

export interface CombatState {
  phase: CombatPhase;
  outcome: CombatOutcome;
  /** 来人（冯志远） */
  enemy: { x: number; z: number; facing: number; state: EnemyState; timer: number; cooldown: number };
  /** 冲刺方向锁定（起跳瞬间锁定，之后不再制导） */
  lungeDir: { x: number; z: number };
  stamina: number;
  hasChair: boolean;
  chairHp: number;
  chairTaken: boolean;
  hasKnife: boolean;
  knifeTaken: boolean;
  /** 被扑住：剩余时间与已按次数 */
  grabTimer: number;
  grabPresses: number;
  /** 统计（用于事后陈述与验收：一次致死、被扑倒次数） */
  grabs: number;
  blocks: number;
  strikes: number;
  retries: number;
  elapsed: number;
  /** 当前提示（UI 直接显示） */
  prompt: string;
}

// ---------------------------------------------------------------- 工具

function clampToArena(p: { x: number; z: number }): void {
  p.x = Math.min(ARENA.maxX, Math.max(ARENA.minX, p.x));
  p.z = Math.min(ARENA.maxZ, Math.max(ARENA.minZ, p.z));
}

/** 把点推出遮挡矩形（就近一侧），供来人绕桌走 */
function pushOutOfBlockers(p: { x: number; z: number }, r: number): void {
  for (const b of BLOCKERS) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const ox = b.hx + r - Math.abs(dx);
    const oz = b.hz + r - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) p.x += dx >= 0 ? ox : -ox;
      else p.z += dz >= 0 ? oz : -oz;
    }
  }
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

// ---------------------------------------------------------------- 创建

export function createCombat(retries = 0): CombatState {
  return {
    phase: 'burst',
    outcome: 'none',
    enemy: { x: ARENA.doorX, z: ARENA.doorZ, facing: 0, state: 'burst', timer: TUNING.burstTime, cooldown: 0.9 },
    lungeDir: { x: 0, z: 1 },
    stamina: TUNING.staminaMax,
    hasChair: false,
    chairHp: TUNING.chairHp,
    chairTaken: false,
    hasKnife: false,
    knifeTaken: false,
    grabTimer: 0,
    grabPresses: 0,
    grabs: 0,
    blocks: 0,
    strikes: 0,
    retries,
    elapsed: 0,
    prompt: '门被撞开了。'
  };
}

/** 玩家是否还能冲刺（体力闸门） */
export function canSprint(s: CombatState): boolean {
  return s.stamina > 6 && !isLocked(s);
}

/** 被扑住或已结束时，玩家不能移动 */
export function isLocked(s: CombatState): boolean {
  return s.outcome !== 'none' || s.enemy.state === 'grab' || s.enemy.state === 'clinch';
}

function prompt(s: CombatState): string {
  if (s.outcome === 'win') return '刀还在他手里。';
  if (s.outcome === 'fail') return '他把你按在了地上。';
  if (s.enemy.state === 'grab') return '连按 空格 / 点「挣」 —— 挣开他';
  if (s.enemy.state === 'clinch') return '就现在 —— 挥（J / 左键 / 点「挥」）';
  if (s.phase === 'burst') return '退开。别站在门口。';
  if (s.hasKnife) return '他扑上来时先挡（空格），挡住了再挥。';
  if (s.hasChair) return '按住空格用椅子挡他 —— 手里举着椅子，腾不出手拿别的。';
  if (s.chairTaken) return '椅子散了。备餐台上有把刀（走近按 E）。';
  return '别让他贴上来 —— 旁边有把椅子（走近按 E）。';
}

// ---------------------------------------------------------------- 主步进

export function stepCombat(s: CombatState, input: CombatInput): CombatEvent[] {
  const ev: CombatEvent[] = [];
  const dt = Math.min(0.05, Math.max(0, input.dt));
  if (s.outcome !== 'none') {
    s.prompt = prompt(s);
    return ev;
  }
  s.elapsed += dt;
  const e = s.enemy;
  const px = input.player.x;
  const pz = input.player.z;

  // ---- 体力
  if (input.sprinting && !isLocked(s)) s.stamina = Math.max(0, s.stamina - TUNING.sprintDrain * dt);
  else s.stamina = Math.min(TUNING.staminaMax, s.stamina + TUNING.staminaRegen * dt);

  // ---- 拾取（椅子 / 刀）
  if (input.interactPressed && !isLocked(s)) {
    if (!s.chairTaken && dist(px, pz, ARENA.chairX, ARENA.chairZ) <= TUNING.pickupRange) {
      s.chairTaken = true;
      s.hasChair = true;
      s.phase = 'chair';
      ev.push({ type: 'take-chair' });
    } else if (!s.knifeTaken && s.chairTaken && !s.hasChair &&
               dist(px, pz, ARENA.knifeX, ARENA.knifeZ) <= TUNING.pickupRange) {
      // 顺序是故事定死的：先退、先用椅子挡；椅子散了、人被逼到备餐台，才会去拿那把刀。
      // 手里还举着椅子时腾不出手（见下方 prompt）。
      s.knifeTaken = true;
      s.hasKnife = true;
      s.hasChair = false;
      s.phase = 'knife';
      ev.push({ type: 'take-knife' });
    }
  }

  // ---- 被扑住：挣脱
  if (e.state === 'grab') {
    s.grabTimer -= dt;
    if (input.guardPressed || input.strikePressed) s.grabPresses++;
    if (s.grabPresses >= TUNING.grabPresses) {
      e.state = 'stagger';
      e.timer = 1.2;
      e.cooldown = 1.0;
      s.stamina = Math.max(0, s.stamina - TUNING.escapeCost);
      const away = Math.atan2(e.x - px, e.z - pz);
      e.x += Math.sin(away) * 1.8;
      e.z += Math.cos(away) * 1.8;
      clampToArena(e);
      ev.push({ type: 'escape' });
    } else if (s.grabTimer <= 0) {
      s.outcome = 'fail';
      e.state = 'grab';
      s.phase = 'ended';
      ev.push({ type: 'fail' });
    }
    s.prompt = prompt(s);
    return ev;
  }

  // ---- 持刀抵住：挡住的一瞬间，只有一下可挥
  if (e.state === 'clinch') {
    e.timer -= dt;
    if (input.strikePressed) {
      s.strikes++;
      s.outcome = 'win';
      s.phase = 'ended';
      e.state = 'down';
      ev.push({ type: 'win' });
      s.prompt = prompt(s);
      return ev;
    }
    if (e.timer <= 0) {
      e.state = 'grab';
      s.grabTimer = TUNING.grabTime;
      s.grabPresses = 0;
      s.grabs++;
      ev.push({ type: 'grab' });
    }
    s.prompt = prompt(s);
    return ev;
  }

  // ---- 来人行为
  e.cooldown = Math.max(0, e.cooldown - dt);
  const d = dist(e.x, e.z, px, pz);
  const toPlayer = Math.atan2(px - e.x, pz - e.z);

  switch (e.state) {
    case 'burst': {
      e.timer -= dt;
      e.facing = toPlayer;
      if (e.timer <= 0) {
        e.state = 'chase';
        s.phase = s.hasKnife ? 'knife' : s.hasChair ? 'chair' : 'bare';
        ev.push({ type: 'burst-done' });
      }
      break;
    }
    case 'chase': {
      e.facing = toPlayer;
      const step = TUNING.enemySpeed * dt;
      e.x += Math.sin(toPlayer) * step;
      e.z += Math.cos(toPlayer) * step;
      if (d <= TUNING.lungeRange && e.cooldown <= 0) {
        e.state = 'windup';
        e.timer = TUNING.lungeWindup;
      }
      break;
    }
    case 'windup': {
      e.timer -= dt;
      e.facing = toPlayer;
      if (e.timer <= 0) {
        e.state = 'lunge';
        e.timer = TUNING.lungeTime;
        s.lungeDir = { x: Math.sin(toPlayer), z: Math.cos(toPlayer) };
        ev.push({ type: 'lunge' });
      }
      break;
    }
    case 'lunge': {
      e.timer -= dt;
      const step = TUNING.lungeSpeed * dt;
      e.x += s.lungeDir.x * step;
      e.z += s.lungeDir.z * step;
      if (e.timer <= 0) {
        e.state = 'recover';
        e.timer = TUNING.lungeRecover;
        e.cooldown = TUNING.lungeCooldown;
      }
      break;
    }
    case 'recover':
    case 'stagger': {
      e.timer -= dt;
      if (e.timer <= 0) e.state = 'chase';
      break;
    }
    default:
      break;
  }

  clampToArena(e);
  pushOutOfBlockers(e, 0.42);

  // ---- 接触判定
  const nowD = dist(e.x, e.z, px, pz);
  const canHit = e.state === 'chase' || e.state === 'lunge' || e.state === 'windup';
  if (canHit && nowD <= TUNING.contact) {
    const away = Math.atan2(e.x - px, e.z - pz);
    const knock = (m: number) => {
      e.x += Math.sin(away) * m;
      e.z += Math.cos(away) * m;
      clampToArena(e);
      pushOutOfBlockers(e, 0.42);
    };
    if (input.guardHeld && s.hasKnife) {
      // 抬起胳膊挡了一下：刀还在手里，只有这一瞬
      e.state = 'clinch';
      e.timer = TUNING.clinchTime;
      s.blocks++;
      s.stamina = Math.max(0, s.stamina - TUNING.blockCost);
      ev.push({ type: 'clinch' });
    } else if (input.guardHeld && s.hasChair) {
      s.blocks++;
      s.chairHp--;
      s.stamina = Math.max(0, s.stamina - TUNING.blockCost);
      e.state = 'stagger';
      e.timer = TUNING.chairStagger;
      e.cooldown = TUNING.lungeCooldown;
      knock(TUNING.chairKnock);
      ev.push({ type: 'block' });
      if (s.chairHp <= 0) {
        s.hasChair = false;
        s.phase = 'bare';
        ev.push({ type: 'chair-break' });
      }
    } else if (input.guardHeld && s.stamina >= TUNING.shoveCost) {
      // 空手推：能推开一次，但很快就没力气了
      s.stamina -= TUNING.shoveCost;
      e.state = 'stagger';
      e.timer = TUNING.bareStagger;
      e.cooldown = 0.7;
      knock(TUNING.bareKnock);
      ev.push({ type: 'shove' });
    } else {
      e.state = 'grab';
      s.grabTimer = TUNING.grabTime;
      s.grabPresses = 0;
      s.grabs++;
      ev.push({ type: 'grab' });
    }
  }

  s.prompt = prompt(s);
  return ev;
}

/** 失败后从这一刻重来（不写任何剧情事实，只重置遭遇） */
export function retryCombat(s: CombatState): CombatState {
  return createCombat(s.retries + 1);
}
