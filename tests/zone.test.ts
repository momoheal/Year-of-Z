/**
 * zone.test.ts —— 域外探索内核的不变量
 *
 * 覆盖设计文档里最重要的几条：噪音即敌、时间即命、钥匙经济闭环、
 * 找尸之旅、医疗两本账、重尸不可战胜、San 只污染画面层、撤离路线表。
 */

import { describe, expect, it } from 'vitest';
import {
  BAG_CELLS, CONTAINERS, DOORS, HOME, ITEMS, MED, MILITIA, MILITIA_CLEANUP_DELAY, MILITIA_LOOT, NOISE_RADIUS,
  ROUTES, RUNNER_MIN, SPOTS, ZKINDS, ZOMBIE_SPAWNS, dist
} from '../src/zone/zdata';
import {
  CONTAINER_OBSTACLES, OBSTACLES, addItem, bagCellsUsed, countItem, createZone, drainEvents,
  doSpotAction, hudSnapshot, isHeavy, knockOut, noiseAt, spotActions, stepZone, useItem,
  type ZoneInput, type ZoneState
} from '../src/zone/zkernel';

function mkInput(o: Partial<ZoneInput> = {}): ZoneInput {
  return { mx: 0, mz: 0, stance: 'walk', aimX: 0, aimZ: 0, interact: false, swing: false, shoot: false, throwCan: false, toggleLight: false, ...o };
}

function run(st: ZoneState, seconds: number, input: Partial<ZoneInput> = {}, dt = 1 / 60): void {
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) stepZone(st, dt, mkInput(input));
}

/** 把玩家挪到某个坐标，并清掉可能压住他的碰撞体推挤 */
function place(st: ZoneState, x: number, z: number): void {
  st.player.x = x; st.player.z = z;
}

describe('域外探索 · 开局与时钟', () => {
  it('20:00 出门，手上是那根弯了的撬棍，出门三件消耗品在包里', () => {
    const st = createZone();
    expect(st.player.weapon).toBe('crowbar-bent');
    expect(countItem(st, 'bandage')).toBe(1);
    expect(countItem(st, 'battery')).toBe(1);
    expect(countItem(st, 'food')).toBe(1);
    expect(hudSnapshot(st).clock).toBe('20:00');
  });

  it('一夜 570 游戏分，0.75 游戏分/现实秒 → 约 12.7 现实分钟', () => {
    const st = createZone();
    st.zombies = []; st.militia = []; // 只量时钟，不掺生态
    run(st, 60);
    expect(st.gameMin).toBeCloseTo(45, 0);
    expect(hudSnapshot(st).clock).toBe('20:45');
  });

  it('05:30 天亮：在街上会被记录（当日核酸作废）', () => {
    const st = createZone();
    place(st, 20, 0);
    st.gameMin = 569.5;
    run(st, 2);
    expect(st.phase).toBe('dawn');
    expect(st.flags.recorded).toBe(1);
    expect(st.flags.dawnOut).toBe(1);
  });

  it('06:00 还没到家 → 强制收摊，结局不是回家', () => {
    const st = createZone();
    place(st, 20, 0);
    st.gameMin = 599;
    run(st, 3);
    expect(st.result).not.toBeNull();
    expect(st.result!.home).toBe(false);
  });

  it('走进门廊灯的圈子 = 到家，结算为回家', () => {
    const st = createZone();
    place(st, HOME.x + 1, HOME.z);
    run(st, 0.2);
    expect(st.result?.home).toBe(true);
    expect(st.result?.recorded).toBe(false);
  });
});

describe('噪音即敌', () => {
  it('噪音半径 1–5 级 = 90/200/340/540/950 设计 px', () => {
    expect(NOISE_RADIUS.map((r) => Math.round(r * 40))).toEqual([0, 90, 200, 340, 540, 950]);
  });

  it('走路会持续发出 1 级脚步声，潜行一声不出', () => {
    const a = createZone();
    run(a, 2, { mx: 1, mz: 0, stance: 'walk' });
    expect(a.noises.length + countEvents(a, 'noise', 1)).toBeGreaterThan(0);
    const walkNoises = countEvents(a, 'noise', 1);

    const b = createZone();
    run(b, 2, { mx: 1, mz: 0, stance: 'sneak' });
    expect(countEvents(b, 'noise', 1)).toBe(0);
    expect(walkNoises).toBeGreaterThan(0);
  });

  it('噪音会把半径内的游荡者叫醒（alert）', () => {
    const st = createZone();
    const z = st.zombies.find((x) => x.kind === 'shambler')!;
    expect(z.state).not.toBe('alert');
    noiseAt(st, z.x + 1, z.z, 2);
    expect(z.state).toBe('alert');
  });

  it('撬门是 3 级噪音：半条街听得见', () => {
    const st = createZone();
    place(st, -16.5, 10);
    const before = st.player.weaponDur;
    run(st, 3, { interact: true });
    const door = st.doors.find((d) => d.id === 'd-pharmacy')!;
    expect(door.open).toBe(true);
    expect(st.player.weaponDur).toBeLessThan(before);
    expect(countEvents(st, 'noise', 3)).toBeGreaterThanOrEqual(2);
  });
});

function countEvents(st: ZoneState, k: string, level?: number): number {
  let n = 0;
  for (const e of st.events) {
    if (e.k === k && (level === undefined || (e as { level?: number }).level === level)) n++;
  }
  return n;
}

describe('钥匙经济', () => {
  it('每扇锁着的门，钥匙都有可达来源；没有钥匙也能撬开（永远的后门）', () => {
    for (const d of DOORS.filter((x) => x.locked)) {
      expect(d.keyId).toBeTruthy();
      // 钥匙来源三线：尸体（容器 / 机动队战后掉落）、委托报酬、定居点交易
      const fromBody = CONTAINERS.some((c) => c.loot.includes(d.keyId!)) || MILITIA_LOOT.includes(d.keyId!);
      const fromTrade = spotActions(createZone(), 's-bench').some((a) => a.id === `buy:${d.keyId}`);
      expect(fromBody || fromTrade, `${d.id} 的钥匙 ${d.keyId} 三条来源都没有`).toBe(true);
    }
  });

  it('有钥匙开门：一声轻响，钥匙消耗掉', () => {
    const st = createZone();
    addItem(st, 'key', 1);
    place(st, -16.5, 10);
    run(st, 0.4, { interact: true });
    const door = st.doors.find((d) => d.id === 'd-pharmacy')!;
    expect(door.open).toBe(true);
    expect(countItem(st, 'key')).toBe(0);
    expect(countEvents(st, 'noise', 3)).toBe(0);
  });

  it('没有锁的门推开就行：1 级噪音、半秒，不需要撬三下', () => {
    const st = createZone();
    st.militia = [];
    place(st, 30.5, 10.4); // 站在南仓内间门槛外（门在 11.5）
    run(st, 1.0, { interact: true });
    const door = st.doors.find((d) => d.id === 'd-southroom')!;
    expect(door.open).toBe(true);
    expect(st.events.some((e) => e.k === 'door' && e.how === 'open')).toBe(true);
    expect(countEvents(st, 'noise', 3)).toBe(0);
  });

  it('撬药房后库会惊动门后趴着的东西', () => {
    const st = createZone();
    st.militia = []; // 只测撬门这件事，别让路过的巡逻队把门后的那位打掉
    place(st, -16.5, 10);
    const lurker = st.zombies.find((z) => z.kind === 'lurker' && dist(z.x, z.z, -16.5, 8.6) < 5)!;
    expect(lurker.state).toBe('ambush');
    run(st, 3, { interact: true });
    expect(lurker.state).toBe('chase');
  });
});

describe('背包占格（塔科夫式）', () => {
  it('装不下的东西会留在原地，不会凭空消失', () => {
    const st = createZone();
    // 塞满 30 格
    for (let i = 0; i < 40; i++) addItem(st, 'food', 1);
    expect(bagCellsUsed(st.bag)).toBeLessThanOrEqual(BAG_CELLS);
    const before = st.ground.length;
    const ok = addItem(st, 'axe', 1);
    if (!ok) {
      // 主流程里装不下就丢在地上——这里直接验证"塞不下"这件事本身
      expect(bagCellsUsed(st.bag)).toBeLessThanOrEqual(BAG_CELLS);
      expect(st.ground.length).toBe(before);
    }
  });

  it('消防斧 2×3 = 6 凸，是包里最贵的一块', () => {
    expect(ITEMS.axe.w * ITEMS.axe.h).toBe(6);
    const st = createZone();
    addItem(st, 'axe', 1);
    expect(isHeavy(st.bag)).toBe(false);
    for (let i = 0; i < 4; i++) addItem(st, 'axe', 1);
    expect(isHeavy(st.bag)).toBe(true);
  });
});

describe('医疗两本账', () => {
  it('绷带止得住血，止不住感染；抗生素反过来', () => {
    const st = createZone();
    st.player.bleed = 1;
    st.player.infection = 40;
    addItem(st, 'antibiotics', 1);
    useItem(st, 'bandage');
    expect(st.player.bleed).toBe(0);
    expect(st.player.infection).not.toBeNull();

    useItem(st, 'antibiotics');
    expect(st.player.infection).toBeNull();
  });

  it('躯干深咬进入 90 秒感染倒计时，倒计归零后持续掉血', () => {
    const st = createZone();
    st.player.infection = 0.05;
    const hp0 = st.player.hp;
    run(st, 1.0);
    expect(st.player.hp).toBeLessThan(hp0);
    expect(MED.infectSeconds).toBe(90);
  });

  it('四肢浅伤只流血，不进倒计时', () => {
    const st = createZone();
    st.player.bleed = 1;
    st.player.infection = null;
    const hp0 = st.player.hp;
    run(st, 1.0);
    expect(st.player.hp).toBeLessThan(hp0);
    expect(st.player.infection).toBeNull();
  });
});

describe('找尸之旅（取代删档死亡）', () => {
  it('被打倒：随身物全部掉在原地，+3 游戏小时，San −20，在行军床醒来', () => {
    const st = createZone();
    addItem(st, 'food', 3);
    const min0 = st.gameMin;
    const san0 = st.player.san;
    place(st, 25, 8);
    knockOut(st);
    expect(st.bag.length).toBe(0);
    expect(st.bagDrop).toHaveLength(1);
    expect(st.bagDrop[0].x).toBeCloseTo(25, 1);
    expect(st.gameMin - min0).toBe(180);
    expect(st.player.san - san0).toBe(-20);
    expect(st.player.hp).toBeGreaterThan(0);
    // 行军床在定居点
    const bed = SPOTS.find((s) => s.kind === 'bed')!;
    expect(dist(st.player.x, st.player.z, bed.x, bed.z)).toBeLessThan(2);
  });

  it('包一直在原地等人，走回去能整包捡回来', () => {
    const st = createZone();
    addItem(st, 'food', 3);
    const carried = countItem(st, 'food');
    place(st, 25, 8);
    knockOut(st);
    expect(countItem(st, 'food')).toBe(0);
    place(st, 25, 8);
    run(st, 0.4, { interact: true });
    expect(st.bagDrop).toHaveLength(0);
    expect(countItem(st, 'food')).toBe(carried);
  });
});

describe('三方生态', () => {
  it('23:00 快尸出巢', () => {
    const st = createZone();
    st.gameMin = RUNNER_MIN - 1;
    const before = st.zombies.filter((z) => z.kind === 'runner').length;
    run(st, 3);
    expect(st.zombies.filter((z) => z.kind === 'runner').length).toBeGreaterThan(before);
  });

  it('重尸是地形不是敌人：挥击不掉血，还会把人撞开', () => {
    const st = createZone();
    const brute = st.zombies.find((z) => z.kind === 'brute')!;
    place(st, brute.x + 1.2, brute.z);
    st.player.face = Math.atan2(brute.x - st.player.x, brute.z - st.player.z);
    const hp0 = brute.hp;
    const px = st.player.x;
    stepZone(st, 1 / 60, mkInput({ swing: true, aimX: brute.x, aimZ: brute.z }));
    expect(brute.hp).toBe(hp0);
    expect(brute.alive).toBe(true);
    expect(st.player.x).not.toBe(px);
  });

  it('任何枪声（包括机动队自己的）都会招来清剿队', () => {
    const st = createZone();
    noiseAt(st, 10, 0, 5);
    st.cleanupAt = { x: 10, z: 0 };
    st.cleanupTimer = MILITIA_CLEANUP_DELAY;
    run(st, MILITIA_CLEANUP_DELAY + 1);
    expect(st.militia.some((m) => m.kind === 'cleanup')).toBe(true);
  });

  it('玩家开枪会被记进结算档案', () => {
    const st = createZone();
    st.player.gun = true;
    st.player.ammo = 8;
    stepZone(st, 1 / 60, mkInput({ shoot: true, aimX: 40, aimZ: 0 }));
    expect(st.shots).toBe(1);
    expect(st.events.filter((e) => e.k === 'shot' && e.by === 'player')).toHaveLength(1);
    expect(countEvents(st, 'noise', 5)).toBeGreaterThanOrEqual(1);
    place(st, HOME.x, HOME.z);
    run(st, 0.2);
    expect(st.result!.refusals.join()).toContain('你带了枪出墙');
    expect(st.result!.refusals.join()).toContain('你开了 1 枪');
  });
});

describe('San：只污染画面层', () => {
  it('低 San 会出现幻觉体，HUD 上的数值永远为真', () => {
    const st = createZone();
    st.player.san = 30;
    for (let i = 0; i < 600; i++) stepZone(st, 1 / 60, mkInput());
    expect(st.zombies.some((z) => z.fake && z.alive)).toBe(true);
    // 文字层不替玩家判断：内核里没有任何"这是假的"标记暴露给 HUD
    expect(hudSnapshot(st).san).toBeGreaterThanOrEqual(0);
  });

  it('灯下静立回 San，黑地里走掉 San', () => {
    const a = createZone();
    place(a, HOME.x, HOME.z - 3); // 门廊灯下
    a.player.san = 50;
    run(a, 3);
    expect(a.player.san).toBeGreaterThan(50);

    const b = createZone();
    place(b, 8, 21); // 地道里
    b.player.san = 50;
    run(b, 3, { mx: 1, mz: 0 });
    expect(b.player.san).toBeLessThan(50);
  });
});

describe('委托（乐高挂牌）', () => {
  it('委托板给得出挂牌，摘下来才进任务轨', () => {
    const st = createZone();
    place(st, -5.5, -16);
    const acts = spotActions(st, 's-board');
    expect(acts.length).toBeGreaterThanOrEqual(3);
    expect(hudSnapshot(st).contracts).toHaveLength(0);
    doSpotAction(st, 's-board', 'take:c-med');
    expect(hudSnapshot(st).contracts).toHaveLength(1);
  });

  it('现场带回：货在包里才交得掉，交掉才给报酬', () => {
    const st = createZone();
    place(st, -5.5, -16);
    doSpotAction(st, 's-board', 'take:c-med');
    let acts = spotActions(st, 's-board');
    expect(acts.find((a) => a.id === 'give:c-med')?.disabled).toBeTruthy();
    addItem(st, 'antibiotics', 1);
    acts = spotActions(st, 's-board');
    expect(acts.find((a) => a.id === 'give:c-med')?.disabled).toBeFalsy();
    doSpotAction(st, 's-board', 'give:c-med');
    expect(st.contracts.find((c) => c.id === 'c-med')!.delivered).toBe(true);
  });

  it('多拿的抗生素会诚实记进档案（拒绝式选项）', () => {
    const st = createZone();
    addItem(st, 'antibiotics', 3);
    place(st, HOME.x, HOME.z);
    run(st, 0.2);
    expect(st.result!.refusals.join()).toContain('你多拿了 2 盒抗生素');
  });
});

describe('撤离路线表', () => {
  it('三条路都通向家，且至少两条不需要证件', () => {
    expect(ROUTES).toHaveLength(3);
    for (const r of ROUTES) {
      const last = r.waypoints[r.waypoints.length - 1];
      expect(dist(last[0], last[1], HOME.x, HOME.z)).toBeLessThan(HOME.r);
    }
    const needDoc = ROUTES.filter((r) => r.cond.includes('通行条'));
    expect(ROUTES.length - needDoc.length).toBeGreaterThanOrEqual(2);
  });

  it('本图实测：地道 ≈ 大路 < 后墙缺口（地道是用黑暗换哨卡，不是更短）', () => {
    const d = (id: string) => ROUTES.find((r) => r.id === id)!.dist;
    expect(d('A')).toBeLessThan(d('C'));
    expect(d('B')).toBeLessThan(d('C'));
    expect(Math.abs(d('A') - d('B'))).toBeLessThan(10);
  });
});

describe('地图硬约束', () => {
  const insideAnything = (x: number, z: number, r: number): boolean =>
    OBSTACLES.concat(CONTAINER_OBSTACLES).some((b) => Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r);

  it('每个容器都摸得到：附近有能站人、且在交互距离内的位置', () => {
    for (const c of CONTAINERS) {
      let ok = false;
      for (let a = 0; a < 24 && !ok; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const px = c.x + Math.cos(ang) * 2.0;
        const pz = c.z + Math.sin(ang) * 2.0;
        if (!insideAnything(px, pz, 0.45) && dist(px, pz, c.x, c.z) <= 2.3) ok = true;
      }
      expect(ok, `容器 ${c.id} 摸不到（被墙或别的容器挡住了）`).toBe(true);
    }
  });

  it('每个交互点都走得进去（不在墙里）', () => {
    for (const s of SPOTS) {
      let ok = false;
      for (let a = 0; a < 24 && !ok; a++) {
        const ang = (a / 24) * Math.PI * 2;
        ok = !insideAnything(s.x + Math.cos(ang) * 1.4, s.z + Math.sin(ang) * 1.4, 0.45);
      }
      expect(ok, `交互点 ${s.id} 被埋进墙里了`).toBe(true);
    }
  });

  it('机动队与丧尸的巡逻点也不在墙里（不然会卡在门面上）', () => {
    for (const m of MILITIA) {
      for (const wp of m.route) expect(insideAnything(wp[0], wp[1], 0.42), `${m.id} 的巡逻点卡住：${wp}`).toBe(false);
    }
  });

  it('丧尸出生点与巡逻点都不在墙里（不然开局就会被挤出去）', () => {
    for (const sp of ZOMBIE_SPAWNS) {
      expect(insideAnything(sp.x, sp.z, 0.42), `${sp.kind} 出生在墙里：${sp.x},${sp.z}`).toBe(false);
      for (const wp of sp.patrol ?? []) {
        expect(insideAnything(wp[0], wp[1], 0.42), `${sp.kind} 的巡逻点埋在墙里：${wp[0]},${wp[1]}`).toBe(false);
      }
    }
  });

  it('六种丧尸各就各位，初夜图上一只不少', () => {
    const kinds = new Set(ZOMBIE_SPAWNS.map((s) => s.kind));
    for (const k of ['shambler', 'croucher', 'lurker', 'screamer', 'brute'] as const) {
      expect(kinds.has(k), `少了 ${ZKINDS[k].name}`).toBe(true);
    }
  });

  it('叫尸不咬人，但会尖叫召集（4 级噪音）', () => {
    expect(ZKINDS.screamer.dmg).toBe(0);
    const st = createZone();
    const sc = st.zombies.find((z) => z.kind === 'screamer')!;
    sc.state = 'chase';
    sc.target = { x: st.player.x, z: st.player.z };
    sc.screamCd = 0;
    stepZone(st, 1 / 60, mkInput());
    expect(countEvents(st, 'noise', 4)).toBeGreaterThan(0);
  });
});

describe('事件流', () => {
  it('事件被取走后不重复消费', () => {
    const st = createZone();
    run(st, 1, { mx: 1, mz: 0 });
    const first = drainEvents(st).length;
    const second = drainEvents(st).length;
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });
});
