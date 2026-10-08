/**
 * zkernel.ts —— 域外探索 · 单夜切片的内核
 *
 * 纯逻辑：不 import THREE、不碰 DOM。全部状态可序列化、可单测。
 * 表现层(zscene)与 UI(zmain)只读状态 + 消费事件，不反向写入规则。
 *
 * 设计支柱照抄设计文档第 2 节，尤其是第 5 条：**文字层不撒谎**——
 * San 只污染画面层（幻觉体），HUD 上所有数值永远为真。
 */

import {
  BAG_CELLS, BAG_COLS, BAG_HEAVY, BAG_ROWS, BLOCKS, CONTRACTS, CONTAINERS, DOORS, FLASHLIGHT,
  FORCE_END_MIN, GAME_MIN_PER_SEC, HOME, ITEMS, KO, LAMPS, MAP, MED, MILITIA, MILITIA_CLEANUP_DELAY, MILITIA_SPEED,
  MILITIA_CLEANUP_SPEED, MILITIA_LOOT, NIGHT_MIN, NEST, NOISE_RADIUS, PLAYER, ROUTES, RUNNER_COUNT, RUNNER_MIN,
  RUNNER_NEST, SAN, SPAWN, SPEED, SPOTS, STAMINA, STEP_NOISE, WAKE, ZKINDS, ZOMBIE_SPAWNS,
  CONTAINER_BOX, clockText, clamp, dist, inTunnel, seeded, wrapAngle,
  type ContainerDef, type ContractDef, type Stance, type ZKind
} from './zdata';

// ---------------------------------------------------------------- 类型

export type Phase = 'night' | 'dawn' | 'over';

export interface BagItem { uid: number; id: string; x: number; y: number; n: number; rot: boolean }
export interface GroundItem { uid: number; id: string; x: number; z: number; n: number }
export interface NoiseMark { uid: number; x: number; z: number; level: number; t: number; life: number }
/** 找尸之旅：被打倒时掉在原地、一直在那儿等你的那一包 */
export interface DroppedBag { uid: number; x: number; z: number; loot: string[] }
export interface LogLine { t: string; text: string; type: 'fact' | 'uncertain' | 'choice' }

export interface PlayerState {
  x: number; z: number; face: number;
  stance: Stance;
  hp: number; san: number; stamina: number;
  /** 失血账：伤口数 */
  bleed: number;
  /** 感染账：剩余秒；null = 未感染 */
  infection: number | null;
  /** 手电余量 0..1 */
  battery: number;
  light: boolean;
  weapon: string;
  weaponDur: number;
  gun: boolean;
  ammo: number;
  swingCd: number;
  throwCd: number;
  runIdle: number;
  stepCd: number;
  pry: { id: string; t: number; ticks: number } | null;
  search: { id: string; t: number; taken: number } | null;
  down: boolean;
  moving: boolean;
}

export interface ZombieState {
  id: string; kind: ZKind; x: number; z: number; face: number;
  hp: number; alive: boolean; fake: boolean;
  state: 'ambush' | 'patrol' | 'alert' | 'chase' | 'dead';
  homeX: number; homeZ: number;
  patrol: [number, number][]; wp: number; dir: number;
  target: { x: number; z: number } | null;
  alertT: number; lostT: number; cd: number; screamCd: number;
  wobble: number;
}

export interface MilitiaState {
  id: string; kind: 'patrol' | 'checkpoint' | 'cleanup';
  x: number; z: number; face: number;
  route: [number, number][]; wp: number; dir: number;
  alive: boolean; hp: number;
  state: 'patrol' | 'engage' | 'hunt';
  target: { x: number; z: number } | null;
  cd: number; warned: boolean; warnedT: number;
  light: boolean; sweep: number;
  speed: number;
}

export interface DoorState { id: string; open: boolean; locked: boolean; pried: number }
export interface ContainerState { id: string; left: string[] }
export interface ContractState { id: string; taken: boolean; done: boolean; delivered: boolean }

export interface NightResult {
  home: boolean;
  dawnOut: boolean;
  recorded: boolean;
  ko: number;
  shots: number;
  loot: { id: string; name: string; n: number }[];
  contracts: { id: string; title: string; done: boolean }[];
  refusals: string[];
  clock: string;
  san: number;
  hp: number;
  register: 'honest' | 'fake' | null;
  days: number;
}

export interface ZoneState {
  seed: number;
  rng: () => number;
  t: number;
  gameMin: number;
  phase: Phase;
  player: PlayerState;
  zombies: ZombieState[];
  militia: MilitiaState[];
  noises: NoiseMark[];
  doors: DoorState[];
  containers: ContainerState[];
  contracts: ContractState[];
  bag: BagItem[];
  ground: GroundItem[];
  bagDrop: DroppedBag[]; // 被打倒时掉下的那包（留在原地等人）
  log: LogLine[];
  events: ZoneEvent[];
  flags: Record<string, number>;
  koCount: number;
  shots: number;
  cleanupTimer: number;
  cleanupCd: number;
  cleanupAt: { x: number; z: number } | null;
  uid: number;
  result: NightResult | null;
  days: number;
}

export type ZoneEvent =
  | { k: 'toast'; text: string; tone?: 'warn' | 'bad' | 'good' }
  | { k: 'log'; text: string; type?: 'fact' | 'uncertain' | 'choice' }
  | { k: 'noise'; x: number; z: number; level: number }
  | { k: 'loot'; id: string; name: string }
  | { k: 'pickup'; id: string; name: string }
  | { k: 'bagfull'; name: string }
  | { k: 'door'; id: string; how: 'key' | 'pry' | 'open' }
  | { k: 'bite'; deep: boolean }
  | { k: 'ko'; x: number; z: number }
  | { k: 'wake' }
  | { k: 'shot'; x: number; z: number; by: 'player' | 'militia' }
  | { k: 'warn' }
  | { k: 'dawn' }
  | { k: 'home' }
  | { k: 'contract'; id: string }
  | { k: 'deliver'; id: string; title: string }
  | { k: 'spot'; id: string; label: string }
  | { k: 'swing'; hit: boolean }
  | { k: 'throw'; x: number; z: number }
  | { k: 'use'; id: string }
  | { k: 'read'; text: string }
  | { k: 'trade'; text: string }
  | { k: 'result'; result: NightResult };

// ---------------------------------------------------------------- 几何

export interface AABB { x: number; z: number; hw: number; hd: number; h: number }

export const OBSTACLES: AABB[] = BLOCKS.map((b) => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, h: b.h }));

/** 货架 / 货箱 / 柜台 / 铁柜 / 工作台：会挡路（不然人和丧尸都从货架上穿过去） */
export const CONTAINER_OBSTACLES: AABB[] = CONTAINERS
  .filter((c) => CONTAINER_BOX[c.kind])
  .map((c) => {
    const [w, d] = CONTAINER_BOX[c.kind];
    return { x: c.x, z: c.z, hw: w / 2, hd: d / 2, h: 1.1 };
  });
const STATIC_OBSTACLES: AABB[] = OBSTACLES.concat(CONTAINER_OBSTACLES);

function closedDoorBoxes(st: ZoneState): AABB[] {
  const out: AABB[] = [];
  for (const d of st.doors) {
    if (d.open) continue;
    const def = DOORS.find((x) => x.id === d.id);
    if (!def) continue;
    out.push({ x: def.block.x, z: def.block.z, hw: def.block.w / 2, hd: def.block.d / 2, h: def.block.h });
  }
  return out;
}

function pushOut(x: number, z: number, r: number, boxes: AABB[]): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const all = boxes.length ? STATIC_OBSTACLES.concat(boxes) : STATIC_OBSTACLES;
    for (const b of all) {
      const dx = x - b.x, dz = z - b.z;
      const px = b.hw + r - Math.abs(dx);
      const pz = b.hd + r - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) x += (dx < 0 ? -1 : 1) * px;
        else z += (dz < 0 ? -1 : 1) * pz;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: clamp(x, MAP.minX + r, MAP.maxX - r), z: clamp(z, MAP.minZ + r, MAP.maxZ - r) };
}

/** 轴分离移动：撞墙自然贴边滑行 */
function slide(st: ZoneState, x: number, z: number, dx: number, dz: number, r: number): { x: number; z: number } {
  const boxes = closedDoorBoxes(st);
  let nx = x + dx;
  let p = pushOut(nx, z, r, boxes);
  nx = p.x; let nz = p.z;
  p = pushOut(nx, nz + dz, r, boxes);
  return { x: p.x, z: p.z };
}

/** 视线：线段是否被高墙挡住 */
function losBlocked(ax: number, az: number, bx: number, bz: number, extra: AABB[]): boolean {
  const dx = bx - ax, dz = bz - az;
  const all = extra.length ? STATIC_OBSTACLES.concat(extra) : STATIC_OBSTACLES;
  for (const b of all) {
    if (b.h < 2) continue;
    if (Math.hypot(b.x - ax, b.z - az) > Math.hypot(dx, dz) + 6) continue;
    const minx = b.x - b.hw, maxx = b.x + b.hw, minz = b.z - b.hd, maxz = b.z + b.hd;
    let t0 = 0, t1 = 1;
    const clip = (p: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-8) return p >= lo && p <= hi;
      let a = (lo - p) / d, bb = (hi - p) / d;
      if (a > bb) { const tmp = a; a = bb; bb = tmp; }
      if (a > t0) t0 = a;
      if (bb < t1) t1 = bb;
      return t0 <= t1;
    };
    if (!clip(ax, dx, minx, maxx)) continue;
    if (!clip(az, dz, minz, maxz)) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- 灯光 / 时间

export function inLight(_st: ZoneState, x: number, z: number): boolean {
  for (const l of LAMPS) if (dist(x, z, l.x, l.z) < l.r) return true;
  return false;
}

export function isDark(x: number, z: number): boolean {
  return inTunnel(x, z);
}

// ---------------------------------------------------------------- 背包（占格 + 负重）

export function bagValue(bag: BagItem[]): number {
  let v = 0;
  for (const it of bag) {
    const d = ITEMS[it.id];
    if (!d) continue;
    v += d.w * d.h * (1 + (it.n - 1) * 0.6);
  }
  return v;
}

export function isHeavy(bag: BagItem[]): boolean {
  return bagValue(bag) > BAG_HEAVY;
}

function occupied(bag: BagItem[], skipUid = -1): boolean[][] {
  const g: boolean[][] = Array.from({ length: BAG_ROWS }, () => new Array<boolean>(BAG_COLS).fill(false));
  for (const it of bag) {
    if (it.uid === skipUid) continue;
    const d = ITEMS[it.id];
    if (!d) continue;
    const w = it.rot ? d.h : d.w;
    const h = it.rot ? d.w : d.h;
    for (let y = it.y; y < it.y + h; y++) for (let x = it.x; x < it.x + w; x++) {
      if (g[y] && x < BAG_COLS) g[y][x] = true;
    }
  }
  return g;
}

function fits(g: boolean[][], x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > BAG_COLS || y + h > BAG_ROWS) return false;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j][i]) return false;
  return true;
}

/** 放得下就返回落点，放不下返回 null（旋转一次也试） */
export function findSlot(bag: BagItem[], id: string): { x: number; y: number; w: number; h: number } | null {
  const d = ITEMS[id];
  if (!d) return null;
  const g = occupied(bag);
  for (let y = 0; y < BAG_ROWS; y++) for (let x = 0; x < BAG_COLS; x++) {
    if (fits(g, x, y, d.w, d.h)) return { x, y, w: d.w, h: d.h };
    if (d.w !== d.h && fits(g, x, y, d.h, d.w)) return { x, y, w: d.h, h: d.w };
  }
  return null;
}

export function bagCellsUsed(bag: BagItem[]): number {
  const g = occupied(bag);
  let n = 0;
  for (const row of g) for (const c of row) if (c) n++;
  return n;
}

export function countItem(st: ZoneState, id: string): number {
  let n = 0;
  for (const it of st.bag) if (it.id === id) n += it.n;
  return n;
}

function addItem(st: ZoneState, id: string, n = 1): boolean {
  const d = ITEMS[id];
  if (!d) return false;
  const stack = d.stack ?? 1;
  if (stack > 1) {
    for (const it of st.bag) {
      if (it.id === id && it.n < stack) {
        const take = Math.min(stack - it.n, n);
        it.n += take; n -= take;
        if (n <= 0) return true;
      }
    }
  }
  while (n > 0) {
    const slot = findSlot(st.bag, id);
    if (!slot) return false;
    const take = stack > 1 ? Math.min(stack, n) : 1;
    st.bag.push({ uid: st.uid++, id, x: slot.x, y: slot.y, n: take, rot: slot.w !== d.w });
    n -= take;
  }
  return true;
}

function takeItem(st: ZoneState, id: string, n = 1): number {
  let left = n;
  for (let i = st.bag.length - 1; i >= 0 && left > 0; i--) {
    const it = st.bag[i];
    if (it.id !== id) continue;
    const take = Math.min(it.n, left);
    it.n -= take; left -= take;
    if (it.n <= 0) st.bag.splice(i, 1);
  }
  return n - left;
}

function dropOnGround(st: ZoneState, id: string, n: number, x: number, z: number): void {
  for (const g of st.ground) {
    if (g.id === id && dist(g.x, g.z, x, z) < 1.6) { g.n += n; return; }
  }
  st.ground.push({ uid: st.uid++, id, x, z, n });
}

// ---------------------------------------------------------------- 事件

function emit(st: ZoneState, e: ZoneEvent): void {
  st.events.push(e);
  if (e.k === 'log') st.log.push({ t: clockText(st.gameMin), text: e.text, type: e.type ?? 'fact' });
}

export function drainEvents(st: ZoneState): ZoneEvent[] {
  const out = st.events;
  st.events = [];
  return out;
}

export function noiseAt(st: ZoneState, x: number, z: number, level: number): void {
  if (level <= 0) return;
  const life = 0.7 + level * 0.2;
  st.noises.push({ uid: st.uid++, x, z, level, t: 0, life });
  emit(st, { k: 'noise', x, z, level });
  const r = NOISE_RADIUS[level];
  // 丧循声
  for (const z0 of st.zombies) {
    if (!z0.alive || z0.fake) continue;
    if (z0.state === 'ambush' && level < 3) continue; // 伏着的只对撬门这种大动静有反应
    if (dist(z0.x, z0.z, x, z) > r) continue;
    alertTo(z0, x, z);
  }
  // 机动队循声
  for (const m of st.militia) {
    if (!m.alive) continue;
    if (dist(m.x, m.z, x, z) > r) continue;
    if (m.kind !== 'cleanup') m.target = { x, z };
  }
}

function alertTo(z: ZombieState, x: number, z2: number): void {
  if (z.state === 'chase') return;
  z.state = 'alert';
  z.target = { x, z: z2 };
  z.alertT = 7;
}

// ---------------------------------------------------------------- 创建

export function createZone(seed = 20261004, days = 1): ZoneState {
  const rng = seeded(seed);
  DYNAMIC_CONTAINERS.clear();
  const st: ZoneState = {
    seed, rng, t: 0, gameMin: 0, phase: 'night',
    player: {
      x: SPAWN.x, z: SPAWN.z, face: Math.PI, stance: 'walk',
      hp: PLAYER.hpMax, san: PLAYER.sanMax, stamina: STAMINA.max,
      bleed: 0, infection: null, battery: 1, light: false,
      weapon: 'crowbar-bent', weaponDur: ITEMS['crowbar-bent'].weapon!.dur,
      gun: false, ammo: 0,
      swingCd: 0, throwCd: 0, runIdle: 0, stepCd: 0,
      pry: null, search: null, down: false, moving: false
    },
    zombies: [], militia: [], noises: [],
    doors: DOORS.map((d) => ({ id: d.id, open: false, locked: d.locked, pried: 0 })),
    containers: CONTAINERS.map((c) => ({ id: c.id, left: c.loot.slice() })),
    contracts: CONTRACTS.map((c) => ({ id: c.id, taken: false, done: false, delivered: false })),
    bag: [], ground: [], bagDrop: [],
    log: [], events: [],
    flags: {}, koCount: 0, shots: 0, cleanupTimer: 0, cleanupCd: 0, cleanupAt: null,
    uid: 1, result: null, days
  };

  ZOMBIE_SPAWNS.forEach((s, i) => {
    const k = ZKINDS[s.kind];
    st.zombies.push({
      id: `z${i}`, kind: s.kind, x: s.x, z: s.z, face: rng() * Math.PI * 2,
      hp: k.hp, alive: true, fake: false,
      state: k.ambush ? 'ambush' : 'patrol',
      homeX: s.x, homeZ: s.z,
      patrol: s.patrol ?? [[s.x, s.z]], wp: 0, dir: 1,
      target: null, alertT: 0, lostT: 0, cd: 0, screamCd: 0, wobble: rng() * Math.PI * 2
    });
  });

  MILITIA.forEach((p, pi) => {
    for (let i = 0; i < p.n; i++) {
      const side = i - (p.n - 1) / 2;
      st.militia.push({
        id: `${p.id}-${i}`, kind: p.id === 'm-checkpoint' ? 'checkpoint' : 'patrol',
        x: p.route[0][0] + (p.id === 'm-checkpoint' ? 0 : side * 0.9),
        z: p.route[0][1] + (p.id === 'm-checkpoint' ? side * 1.6 : 0),
        face: 0,
        route: p.route, wp: 0, dir: 1,
        alive: true, hp: 60,
        state: 'patrol', target: null, cd: 0, warned: false, warnedT: 0,
        light: p.light && i === 0, sweep: (pi * 1.3 + i) % (Math.PI * 2),
        speed: MILITIA_SPEED
      });
    }
  });

  // 出门三件消耗品：电池 / 绷带 / 吃的（手电是固定装备，不占格）
  addItem(st, 'bandage', 1);
  addItem(st, 'battery', 1);
  addItem(st, 'can', 2);
  addItem(st, 'food', 1);

  emit(st, { k: 'log', text: '20:00 出门。门廊灯在身后亮着。', type: 'fact' });
  return st;
}

// ---------------------------------------------------------------- 交互目标

export type InteractTarget =
  | { kind: 'container'; id: string; label: string; progress: number; hint: string }
  | { kind: 'door'; id: string; label: string; progress: number; hint: string }
  | { kind: 'spot'; id: string; label: string; hint: string }
  | { kind: 'ground'; uid: number; label: string; hint: string }
  | { kind: 'bag'; uid: number; label: string; hint: string }
  | null;

/** 动态容器（机动队尸体）登记表——由 zscene 读取建景 */
export const DYNAMIC_CONTAINERS = new Map<string, ContainerDef>();

export function containerDef(id: string): ContainerDef | undefined {
  return CONTAINERS.find((c) => c.id === id) ?? DYNAMIC_CONTAINERS.get(id);
}

export function interactTarget(st: ZoneState): InteractTarget {
  const p = st.player;
  let best: { d: number; t: InteractTarget } = { d: 1e9, t: null };

  const consider = (x: number, z: number, t: InteractTarget) => {
    const d = dist(p.x, p.z, x, z);
    if (d < PLAYER.interactRange && d < best.d) best = { d, t };
  };

  for (const g of st.bagDrop) consider(g.x, g.z, { kind: 'bag', uid: g.uid, label: '你掉下的那个包', hint: '捡回来' });
  for (const g of st.ground) consider(g.x, g.z, { kind: 'ground', uid: g.uid, label: `${ITEMS[g.id]?.name ?? g.id}${g.n > 1 ? ` ×${g.n}` : ''}`, hint: '捡起来' });
  for (const c of st.containers) {
    const def = containerDef(c.id);
    if (!def || c.left.length === 0) continue;
    if (def.needsDoor && !st.doors.find((d) => d.id === def.needsDoor)?.open) continue;
    consider(def.x, def.z, { kind: 'container', id: c.id, label: def.label, progress: p.search?.id === c.id ? p.search.t : 0, hint: '长按搜刮' });
  }
  for (const d of st.doors) {
    if (d.open) continue;
    const def = DOORS.find((x) => x.id === d.id);
    if (!def) continue;
    if (dist(p.x, p.z, def.x, def.z) > PLAYER.interactRange) continue;
    const hasKey = d.locked && def.keyId ? countItem(st, def.keyId) > 0 : false;
    const pry = p.pry?.id === d.id ? p.pry.t : 0;
    consider(def.x, def.z, {
      kind: 'door', id: d.id, label: def.label, progress: pry,
      hint: d.locked ? (hasKey ? '有钥匙 · 长按开锁' : `锁着 · 长按撬（噪音 ${NOISE_RADIUS[3] > 0 ? 3 : 3} 级）`) : '长按推开'
    });
  }
  for (const s of SPOTS) {
    if (s.kind === 'home') continue; // 家不是一个要按 E 的东西：走进圈里就算到家
    consider(s.x, s.z, { kind: 'spot', id: s.id, label: s.label, hint: '按 E' });
  }
  return best.t;
}

// ---------------------------------------------------------------- 委托 / 特殊点

export interface SpotAction { id: string; label: string; hint?: string; disabled?: string }

export function spotActions(st: ZoneState, spotId: string): SpotAction[] {
  const spot = SPOTS.find((s) => s.id === spotId);
  if (!spot) return [];
  switch (spot.kind) {
    case 'board': {
      const out: SpotAction[] = [];
      for (const c of CONTRACTS) {
        const cs = st.contracts.find((x) => x.id === c.id)!;
        if (!cs.taken) out.push({ id: `take:${c.id}`, label: `接下 · ${c.title}`, hint: c.brief });
        else if (!cs.delivered) {
          const ready = contractReady(st, c);
          out.push({
            id: `give:${c.id}`, label: `交货 · ${c.title}`,
            hint: ready ? '把货给他' : '还差东西',
            disabled: ready ? undefined : '还没带回该带的东西'
          });
        } else out.push({ id: `none:${c.id}`, label: `${c.title} · 已交`, disabled: '交过了' });
      }
      return out;
    }
    case 'bench': {
      const w = ITEMS[st.player.weapon];
      return [
        {
          id: 'repair', label: `修一下 ${w?.name ?? '手上的家伙'}`,
          hint: '拿废料垫一垫，耐久回满',
          disabled: countItem(st, 'can') > 0 ? undefined : '需要一个空罐当垫料'
        },
        {
          id: 'buy:pass', label: '换一张通行条', hint: '两个罐头',
          disabled: countItem(st, 'food') >= 2 ? undefined : '要两个罐头'
        },
        {
          id: 'buy:key-north', label: '换北仓钥匙', hint: '三个罐头 + 一节电池',
          disabled: (countItem(st, 'food') >= 3 && countItem(st, 'battery') >= 1) ? undefined : '要三个罐头和一节电池'
        }
      ];
    }
    case 'fire':
      return [{
        id: 'eat', label: '吃口热的', hint: 'San +18，血 +6',
        disabled: countItem(st, 'food') > 0 ? undefined : '没有吃的'
      }];
    case 'bed':
      return [{ id: 'rest', label: '躺一会儿', hint: 'San +12，代价是 30 分钟' }];
    case 'trapped':
      return [
        { id: 'help', label: '把他扶出来' },
        { id: 'look', label: '只看看，然后走开' }
      ];
    default:
      return [];
  }
}

function contractReady(st: ZoneState, c: ContractDef): boolean {
  if (c.need && countItem(st, c.need.id) >= c.need.n) return true;
  if (c.flag && (st.flags[c.flag] ?? 0) > 0) return true;
  return false;
}

export function doSpotAction(st: ZoneState, spotId: string, actionId: string): void {
  const spot = SPOTS.find((s) => s.id === spotId);
  if (!spot) return;
  if (actionId.startsWith('take:')) {
    const c = CONTRACTS.find((x) => x.id === actionId.slice(5));
    const cs = st.contracts.find((x) => x.id === c!.id)!;
    cs.taken = true;
    emit(st, { k: 'contract', id: c!.id });
    emit(st, { k: 'log', text: `接下委托：${c!.title}。`, type: 'fact' });
    emit(st, { k: 'toast', text: `挂牌摘下来了：${c!.title}`, tone: 'good' });
    return;
  }
  if (actionId.startsWith('give:')) {
    const c = CONTRACTS.find((x) => x.id === actionId.slice(5))!;
    if (!contractReady(st, c)) return;
    if (c.need) takeItem(st, c.need.id, c.need.n);
    const cs = st.contracts.find((x) => x.id === c.id)!;
    cs.delivered = true; cs.done = true;
    for (const r of c.reward) { if (!addItem(st, r)) dropOnGround(st, r, 1, st.player.x, st.player.z); }
    emit(st, { k: 'deliver', id: c.id, title: c.title });
    emit(st, { k: 'log', text: `交货：${c.title}。`, type: 'fact' });
    emit(st, { k: 'toast', text: `${c.title} —— 交了。`, tone: 'good' });
    return;
  }
  switch (actionId) {
    case 'repair': {
      if (countItem(st, 'can') < 1) return;
      takeItem(st, 'can', 1);
      const w = ITEMS[st.player.weapon];
      st.player.weaponDur = w?.weapon?.dur ?? st.player.weaponDur;
      emit(st, { k: 'trade', text: `陈工敲了两下：${w?.name ?? '家伙'}还能撑。` });
      break;
    }
    case 'buy:pass': {
      if (countItem(st, 'food') < 2) return;
      takeItem(st, 'food', 2);
      if (!addItem(st, 'pass')) dropOnGround(st, 'pass', 1, st.player.x, st.player.z);
      emit(st, { k: 'trade', text: '两个罐头换一张纸。他没说是谁的纸。' });
      break;
    }
    case 'buy:key-north': {
      if (countItem(st, 'food') < 3 || countItem(st, 'battery') < 1) return;
      takeItem(st, 'food', 3); takeItem(st, 'battery', 1);
      if (!addItem(st, 'key-north')) dropOnGround(st, 'key-north', 1, st.player.x, st.player.z);
      emit(st, { k: 'trade', text: '钥匙从工具箱底下摸出来，上面刻着"北"。' });
      break;
    }
    case 'eat': {
      if (countItem(st, 'food') < 1) return;
      takeItem(st, 'food', 1);
      st.player.san = clamp(st.player.san + SAN.onEat, 0, PLAYER.sanMax);
      st.player.hp = clamp(st.player.hp + 6, 0, PLAYER.hpMax);
      emit(st, { k: 'use', id: 'food' });
      emit(st, { k: 'toast', text: '热的东西下去，手不抖了。', tone: 'good' });
      break;
    }
    case 'rest': {
      st.player.san = clamp(st.player.san + 12, 0, PLAYER.sanMax);
      st.gameMin += 30;
      emit(st, { k: 'toast', text: '躺了半小时。天亮又近了一点。', tone: 'warn' });
      break;
    }
    case 'help': {
      st.flags.helpedTrapped = 1;
      st.flags.sawTrapped = 1;
      st.player.san = clamp(st.player.san - 4, 0, PLAYER.sanMax);
      emit(st, { k: 'log', text: '你把他扶出来了。他没说谢谢，你也没等。', type: 'choice' });
      break;
    }
    case 'look': {
      st.flags.sawTrapped = 1;
      emit(st, { k: 'log', text: '你看了他一眼，他也看了你一眼。你把门带上了。', type: 'choice' });
      break;
    }
  }
}

// ---------------------------------------------------------------- 主步进

export interface ZoneInput {
  mx: number; mz: number;
  stance: Stance;
  aimX: number; aimZ: number;
  interact: boolean;
  swing: boolean;
  shoot: boolean;
  throwCan: boolean;
  toggleLight: boolean;
}

export function stepZone(st: ZoneState, dt: number, input: ZoneInput): void {
  if (st.phase === 'over') return;
  dt = Math.min(dt, 0.05);
  st.t += dt;

  // ---- 时钟
  const before = st.gameMin;
  st.gameMin += dt * GAME_MIN_PER_SEC;
  if (before < RUNNER_MIN && st.gameMin >= RUNNER_MIN) spawnRunners(st);
  if (before < NIGHT_MIN && st.gameMin >= NIGHT_MIN) onDawn(st);
  if (st.gameMin >= FORCE_END_MIN) { finish(st, false); return; }

  // ---- 噪音寿命
  for (const n of st.noises) n.t += dt;
  st.noises = st.noises.filter((n) => n.t < n.life);

  updatePlayer(st, dt, input);
  if (st.result) return;
  updateZombies(st, dt);
  updateMilitia(st, dt);
  updateSan(st, dt);
  updateCleanup(st, dt);

  // ---- 回家判定
  if (dist(st.player.x, st.player.z, HOME.x, HOME.z) < HOME.r) finish(st, true);
}

// ---------------------------------------------------------------- 玩家

function updatePlayer(st: ZoneState, dt: number, input: ZoneInput): void {
  const p = st.player;
  if (p.down) return;

  p.swingCd = Math.max(0, p.swingCd - dt);
  p.throwCd = Math.max(0, p.throwCd - dt);

  // 手电
  if (input.toggleLight) {
    if (!p.light && p.battery <= 0.02) emit(st, { k: 'toast', text: '电池没电了。', tone: 'warn' });
    else { p.light = !p.light; if (p.light) noiseAt(st, p.x, p.z, 1); }
  }
  if (p.light) {
    p.battery = Math.max(0, p.battery - FLASHLIGHT.drainPerSec * dt);
    if (p.battery <= 0) { p.light = false; emit(st, { k: 'toast', text: '手电灭了。', tone: 'warn' }); }
  }

  // 姿态与速度
  const heavy = isHeavy(st.bag);
  let stance = input.stance;
  if (stance === 'run' && (p.stamina <= 0.5 || heavy)) stance = 'walk';
  p.stance = stance;

  const len = Math.hypot(input.mx, input.mz);
  let vx = 0, vz = 0;
  if (len > 0.001) {
    vx = (input.mx / len); vz = (input.mz / len);
    let sp = SPEED[stance];
    if (heavy) sp *= 0.85;
    if (p.bleed > 0) sp *= 0.94;
    if (p.infection !== null) sp *= 0.92;
    const moved = slide(st, p.x, p.z, vx * sp * dt, vz * sp * dt, PLAYER.r);
    p.moving = dist(p.x, p.z, moved.x, moved.z) > 0.0005;
    p.x = moved.x; p.z = moved.z;
  } else p.moving = false;

  // 朝向：挥击/开枪时朝准星，否则朝移动方向
  if (input.swing || input.shoot || input.throwCan) {
    p.face = Math.atan2(input.aimX - p.x, input.aimZ - p.z);
  } else if (p.moving) {
    const want = Math.atan2(vx, vz);
    p.face += wrapAngle(want - p.face) * Math.min(1, dt * 14);
  }

  // 体力
  if (stance === 'run' && p.moving) {
    p.stamina = Math.max(0, p.stamina - STAMINA.runDrain * (heavy ? 1.6 : 1) * dt);
    p.runIdle = STAMINA.regenDelay;
  } else {
    p.runIdle = Math.max(0, p.runIdle - dt);
    if (p.runIdle <= 0) p.stamina = Math.min(STAMINA.max, p.stamina + STAMINA.regen * dt);
  }

  // 脚步噪音
  const sn = STEP_NOISE[stance];
  if (sn && p.moving) {
    p.stepCd -= dt;
    if (p.stepCd <= 0) { noiseAt(st, p.x, p.z, sn.level); p.stepCd = sn.every; }
  } else p.stepCd = 0;

  // 动作
  if (input.swing && p.swingCd <= 0) doSwing(st);
  if (input.shoot) doShoot(st, input);
  if (input.throwCan && p.throwCd <= 0) doThrow(st, input);
  if (input.interact) doInteract(st, dt);
  else { p.search = null; p.pry = null; }

  // 医疗两本账
  if (p.bleed > 0) p.hp -= MED.bleedPerSec * p.bleed * dt;
  if (p.infection !== null) {
    p.infection -= dt;
    if (p.infection <= 0) {
      p.hp -= MED.infectDps * dt;
      p.san = Math.max(0, p.san - MED.infectSanDrain * dt);
    }
  }
  if (p.hp <= 0) knockOut(st);
}

function doSwing(st: ZoneState): void {
  const p = st.player;
  const w = ITEMS[p.weapon]?.weapon;
  if (!w) return;
  p.swingCd = PLAYER.swingCooldown;
  p.stamina = Math.max(0, p.stamina - STAMINA.swing);
  p.runIdle = STAMINA.regenDelay;
  p.weaponDur = Math.max(0, p.weaponDur - 1.2);
  noiseAt(st, p.x, p.z, w.noise);

  let hit = false;
  for (const z of st.zombies) {
    if (!z.alive) continue;
    const d = dist(p.x, p.z, z.x, z.z);
    if (d > PLAYER.swingRange) continue;
    const ang = Math.abs(wrapAngle(Math.atan2(z.x - p.x, z.z - p.z) - p.face));
    if (ang > PLAYER.swingArc / 2) continue;
    if (z.fake) { emit(st, { k: 'swing', hit: false }); continue; } // 幻觉体：挥击永远落空
    const k = ZKINDS[z.kind];
    if (k.invincible) {
      // 活的地形：打不动，只会把自己震开
      const kb = 1.6;
      const nx = p.x - Math.sin(p.face) * kb, nz = p.z - Math.cos(p.face) * kb;
      const moved = pushOut(nx, nz, PLAYER.r, closedDoorBoxes(st));
      p.x = moved.x; p.z = moved.z;
      p.stamina = Math.max(0, p.stamina - 10);
      emit(st, { k: 'toast', text: '你打不动它。它是地形，不是敌人。', tone: 'warn' });
      hit = true;
      continue;
    }
    z.hp -= w.dmg;
    hit = true;
    const kx = (z.x - p.x) / (d || 1), kz = (z.z - p.z) / (d || 1);
    const moved = pushOut(z.x + kx * (w.knock * 0.35), z.z + kz * (w.knock * 0.35), 0.45, closedDoorBoxes(st));
    z.x = moved.x; z.z = moved.z;
    z.state = 'chase'; z.target = { x: p.x, z: p.z };
    if (z.hp <= 0) {
      z.alive = false; z.state = 'dead';
      st.player.san = clamp(st.player.san + SAN.onKill, 0, PLAYER.sanMax);
      emit(st, { k: 'log', text: `${k.name}倒下了。声音比你预想的小。`, type: 'fact' });
    }
  }
  emit(st, { k: 'swing', hit });
  if (hit && p.weaponDur <= 0) emit(st, { k: 'toast', text: `${ITEMS[p.weapon].name}断了。`, tone: 'bad' });
}

function doShoot(st: ZoneState, input: ZoneInput): void {
  const p = st.player;
  if (!p.gun || p.ammo <= 0) return;
  p.ammo--; st.shots++;
  p.swingCd = 0.45;
  noiseAt(st, p.x, p.z, 5);
  emit(st, { k: 'shot', x: p.x, z: p.z, by: 'player' });
  st.cleanupAt = { x: p.x, z: p.z };
  if (st.cleanupTimer <= 0) st.cleanupTimer = MILITIA_CLEANUP_DELAY;
  p.face = Math.atan2(input.aimX - p.x, input.aimZ - p.z);
  // 沿准星方向最近的那个
  const dx = Math.sin(p.face), dz = Math.cos(p.face);
  let best: ZombieState | null = null; let bestD = 1e9;
  for (const z of st.zombies) {
    if (!z.alive || z.fake) continue;
    const rx = z.x - p.x, rz = z.z - p.z;
    const along = rx * dx + rz * dz;
    if (along < 0 || along > 22) continue;
    const off = Math.abs(rx * dz - rz * dx);
    if (off > 1.1) continue;
    if (along < bestD) { bestD = along; best = z; }
  }
  if (best && !ZKINDS[best.kind].invincible) { best.hp = 0; best.alive = false; best.state = 'dead'; }
  emit(st, { k: 'log', text: `你开了一枪。整条街都听见了。（第 ${st.shots} 枪）`, type: 'choice' });
  if (st.cleanupTimer === MILITIA_CLEANUP_DELAY) {
    emit(st, { k: 'toast', text: '枪声传出去。清剿队会来。', tone: 'bad' });
  }
}

function doThrow(st: ZoneState, input: ZoneInput): void {
  const p = st.player;
  if (countItem(st, 'can') <= 0) { emit(st, { k: 'toast', text: '没有空罐。', tone: 'warn' }); return; }
  takeItem(st, 'can', 1);
  p.throwCd = PLAYER.throwCooldown;
  let tx = input.aimX, tz = input.aimZ;
  const d = dist(p.x, p.z, tx, tz);
  if (d > 13) { tx = p.x + (tx - p.x) / d * 13; tz = p.z + (tz - p.z) / d * 13; }
  const boxes = closedDoorBoxes(st);
  if (losBlocked(p.x, p.z, tx, tz, boxes)) { tx = p.x + (tx - p.x) * 0.45; tz = p.z + (tz - p.z) * 0.45; }
  dropOnGround(st, 'can', 1, tx, tz);
  noiseAt(st, tx, tz, 2);
  emit(st, { k: 'throw', x: tx, z: tz });
}

// ---------------------------------------------------------------- 交互（长按）

function doInteract(st: ZoneState, dt: number): void {
  const p = st.player;
  const target = interactTarget(st);
  if (!target) { p.search = null; p.pry = null; return; }

  if (target.kind === 'ground' || target.kind === 'bag') {
    if (target.kind === 'bag') {
      const bag = st.bagDrop.find((x) => x.uid === target.uid);
      if (!bag) return;
      // 找尸之旅：整个包一次性回来（装不下的留在原地）
      let all = true;
      for (const it of bag.loot) if (!addItem(st, it, 1)) all = false;
      st.bagDrop = st.bagDrop.filter((x) => x.uid !== bag.uid);
      emit(st, { k: 'log', text: all ? '包回来了。一样没少。' : '包回来了，但你塞不下，有几样留在了地上。', type: 'fact' });
      emit(st, { k: 'toast', text: all ? '包回来了。' : '包回来了，装不下的留在地上', tone: all ? 'good' : 'warn' });
      return;
    }
    const g = st.ground.find((x) => x.uid === target.uid);
    if (!g) return;
    const d = ITEMS[g.id];
    const ok = addItem(st, g.id, g.n);
    if (!ok) { emit(st, { k: 'bagfull', name: d?.name ?? g.id }); return; }
    if (!d?.use && d?.weapon) equipWeapon(st, g.id);
    st.ground = st.ground.filter((x) => x.uid !== g.uid);
    emit(st, { k: 'pickup', id: g.id, name: d?.name ?? g.id });
    return;
  }

  if (target.kind === 'container') {
    const def = containerDef(target.id)!;
    const cs = st.containers.find((c) => c.id === target.id)!;
    if (!p.search || p.search.id !== target.id) p.search = { id: target.id, t: 0, taken: 0 };
    p.search.t += dt;
    const per = def.time / def.loot.length;
    while (p.search.taken < def.loot.length && p.search.t >= (p.search.taken + 1) * per) {
      const id = def.loot[p.search.taken];
      p.search.taken++;
      noiseAt(st, p.x, p.z, def.noise);
      const d = ITEMS[id];
      if (d?.weapon) { equipWeapon(st, id); emit(st, { k: 'loot', id, name: d.name }); }
      else if (id === 'pistol') {
        p.gun = true;
        emit(st, { k: 'loot', id, name: d.name });
        emit(st, { k: 'log', text: '你拿了枪。它一直在那儿，一直不建议拿。', type: 'choice' });
      } else if (id === 'ammo') {
        p.ammo += 6;
        emit(st, { k: 'loot', id, name: d.name });
      } else if (addItem(st, id)) emit(st, { k: 'loot', id, name: d?.name ?? id });
      else { dropOnGround(st, id, 1, p.x, p.z); emit(st, { k: 'bagfull', name: d?.name ?? id }); }
    }
    if (p.search.taken >= def.loot.length) {
      cs.left = [];
      p.search = null;
      emit(st, { k: 'toast', text: `${def.label}：空了。`, tone: 'good' });
    }
    return;
  }

  if (target.kind === 'door') {
    const def = DOORS.find((d) => d.id === target.id)!;
    const ds = st.doors.find((d) => d.id === target.id)!;
    const hasKey = ds.locked && def.keyId ? countItem(st, def.keyId) > 0 : false;
    if (ds.locked && hasKey) {
      ds.locked = false; ds.open = true;
      takeItem(st, def.keyId!, 1);
      noiseAt(st, p.x, p.z, 1);
      emit(st, { k: 'door', id: def.id, how: 'key' });
      emit(st, { k: 'log', text: `${def.label}：钥匙开了。一点声音都没有。`, type: 'fact' });
      p.pry = null;
      return;
    }
    if (!ds.locked) {
      // 没锁：推开就行，一下轻响
      if (!p.pry || p.pry.id !== target.id) p.pry = { id: target.id, t: 0, ticks: 0 };
      p.pry.t += dt;
      if (p.pry.t >= 0.5) {
        ds.open = true;
        noiseAt(st, p.x, p.z, 1);
        emit(st, { k: 'door', id: def.id, how: 'open' });
        emit(st, { k: 'log', text: `${def.label}：推开了。铰链响了一声。`, type: 'fact' });
        p.pry = null;
      }
      return;
    }
    if (!p.pry || p.pry.id !== target.id) p.pry = { id: target.id, t: 0, ticks: 0 };
    p.pry.t += dt;
    if (p.pry.t >= (p.pry.ticks + 1) * 0.9) {
      p.pry.ticks++;
      noiseAt(st, p.x, p.z, 3);
      p.weaponDur = Math.max(0, p.weaponDur - 6);
      wakeNear(st, def.x, def.z, 5);
      if (p.pry.ticks >= 3) {
        ds.locked = false; ds.open = true;
        emit(st, { k: 'door', id: def.id, how: 'pry' });
        emit(st, { k: 'log', text: `${def.label}：撬开了。半条街听得见。`, type: 'choice' });
        p.pry = null;
      }
    }
    return;
  }
}

function equipWeapon(st: ZoneState, id: string): void {
  const p = st.player;
  const d = ITEMS[id];
  if (!d?.weapon) return;
  if (p.weapon && p.weapon !== id) dropOnGround(st, p.weapon, 1, p.x, p.z);
  p.weapon = id;
  p.weaponDur = d.weapon.dur;
}

function wakeNear(st: ZoneState, x: number, z: number, r: number): void {
  for (const zz of st.zombies) {
    if (!zz.alive || zz.fake) continue;
    if (dist(zz.x, zz.z, x, z) > r) continue;
    zz.state = 'chase';
    zz.target = { x: st.player.x, z: st.player.z };
  }
}

// ---------------------------------------------------------------- 使用物品

export function useItem(st: ZoneState, id: string): void {
  const p = st.player;
  const d = ITEMS[id];
  if (!d?.use || countItem(st, id) <= 0) return;
  if (id === 'bandage') {
    if (p.bleed <= 0) { emit(st, { k: 'toast', text: '没有在流血。', tone: 'warn' }); return; }
    takeItem(st, id, 1); p.bleed = 0;
    emit(st, { k: 'use', id });
    emit(st, { k: 'log', text: '绷带缠上了。血止住了——感染是另一回事。', type: 'fact' });
    return;
  }
  if (id === 'antibiotics') {
    if (p.infection === null) { emit(st, { k: 'toast', text: '没有要压的感染。', tone: 'warn' }); return; }
    takeItem(st, id, 1); p.infection = null;
    emit(st, { k: 'use', id });
    emit(st, { k: 'log', text: '抗生素下去了。倒计时停了。', type: 'fact' });
    return;
  }
  if (id === 'battery') {
    if (p.battery > 0.95) { emit(st, { k: 'toast', text: '电池还是满的。', tone: 'warn' }); return; }
    takeItem(st, id, 1);
    p.battery = clamp(p.battery + FLASHLIGHT.batteryRefill, 0, 1);
    emit(st, { k: 'use', id });
    return;
  }
  if (id === 'food') {
    takeItem(st, id, 1);
    p.san = clamp(p.san + SAN.onEat * 0.7, 0, PLAYER.sanMax);
    p.hp = clamp(p.hp + 5, 0, PLAYER.hpMax);
    emit(st, { k: 'use', id });
  }
}

// ---------------------------------------------------------------- 丧尸

function sightRange(st: ZoneState, z: ZombieState): number {
  const k = ZKINDS[z.kind];
  let s = k.sight;
  if (st.player.stance === 'sneak') s *= 0.55;
  else if (st.player.stance === 'run') s *= 1.25;
  if (st.player.light) s *= 1.5;
  if (st.phase === 'dawn') s *= 2;
  if (isDark(st.player.x, st.player.z) && !st.player.light) s *= 0.6;
  return s;
}

function updateZombies(st: ZoneState, dt: number): void {
  const p = st.player;
  const boxes = closedDoorBoxes(st);
  for (const z of st.zombies) {
    if (!z.alive) continue;
    const k = ZKINDS[z.kind];
    z.cd = Math.max(0, z.cd - dt);
    z.screamCd = Math.max(0, z.screamCd - dt);
    z.wobble += dt;

    if (z.fake) {
      // 幻觉体：只靠近、不掉血、挥击落空；San 回来就散
      const d = dist(z.x, z.z, p.x, p.z);
      if (d > 1.2) moveZombie(st, z, p.x, p.z, k.speed * 0.8, dt);
      if (p.san > SAN.phantomBelow + 14) z.alive = false;
      continue;
    }

    const d = dist(z.x, z.z, p.x, p.z);
    const canSee = d < sightRange(st, z) && !losBlocked(z.x, z.z, p.x, p.z, boxes);

    if (z.state === 'ambush') {
      if (canSee || d < 1.6) {
        z.state = 'chase'; z.target = { x: p.x, z: p.z };
        emit(st, { k: 'toast', text: `${k.name}从暗处起来了。`, tone: 'bad' });
      }
      continue;
    }

    if (canSee) {
      if (z.state !== 'chase') {
        z.state = 'chase';
        if (z.kind === 'screamer') scream(st, z);
      }
      z.target = { x: p.x, z: p.z };
      z.lostT = 0;
    } else if (z.state === 'chase') {
      z.lostT += dt;
      if (z.lostT > 4) { z.state = 'alert'; z.alertT = 5; }
    }

    if (z.state === 'chase') {
      if (z.kind === 'screamer' && z.screamCd <= 0) scream(st, z);
      if (d > 1.15) moveZombie(st, z, z.target?.x ?? p.x, z.target?.z ?? p.z, k.speed, dt);
      else if (z.cd <= 0) bite(st, z);
    } else if (z.state === 'alert') {
      z.alertT -= dt;
      if (z.target) {
        const td = dist(z.x, z.z, z.target.x, z.target.z);
        if (td > 0.8) moveZombie(st, z, z.target.x, z.target.z, k.speed * 0.85, dt);
        else { z.target = null; z.alertT = Math.min(z.alertT, 1); }
      }
      if (z.alertT <= 0) { z.state = 'patrol'; }
    } else {
      // 巡逻 / 游荡
      if (z.patrol.length > 1) {
        const wp = z.patrol[z.wp];
        if (dist(z.x, z.z, wp[0], wp[1]) < 0.9) z.wp = (z.wp + 1) % z.patrol.length;
        else moveZombie(st, z, wp[0], wp[1], k.speed * 0.42, dt);
      } else {
        const wx = z.homeX + Math.sin(z.wobble * 0.35) * 2.2;
        const wz = z.homeZ + Math.cos(z.wobble * 0.27) * 2.2;
        moveZombie(st, z, wx, wz, k.speed * 0.3, dt);
      }
    }
  }
}

function moveZombie(st: ZoneState, z: ZombieState, tx: number, tz: number, speed: number, dt: number): void {
  const dx = tx - z.x, dz = tz - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const step = Math.min(speed * dt, d);
  const jitter = z.state === 'alert' ? 0 : Math.sin(z.wobble * 3.1) * 0.12;
  const nx = (dx / d) * step + (dz / d) * jitter * step;
  const nz = (dz / d) * step - (dx / d) * jitter * step;
  const moved = slide(st, z.x, z.z, nx, nz, 0.42);
  z.x = moved.x; z.z = moved.z;
  z.face = Math.atan2(dx, dz);
}

function scream(st: ZoneState, z: ZombieState): void {
  z.screamCd = 7;
  noiseAt(st, z.x, z.z, 4);
  emit(st, { k: 'toast', text: '叫尸在叫。半径内全都听见了。', tone: 'bad' });
  for (const o of st.zombies) {
    if (!o.alive || o.fake || o === z) continue;
    if (dist(o.x, o.z, z.x, z.z) > NOISE_RADIUS[4]) continue;
    alertTo(o, z.x, z.z);
  }
}

function bite(st: ZoneState, z: ZombieState): void {
  const p = st.player;
  const k = ZKINDS[z.kind];
  z.cd = 1.5;
  if (k.invincible) {
    // 重尸：把你撞开，不咬
    const dx = p.x - z.x, dz = p.z - z.z;
    const d = Math.hypot(dx, dz) || 1;
    const moved = pushOut(p.x + dx / d * MED.bruteKnockback * 0.4, p.z + dz / d * MED.bruteKnockback * 0.4, PLAYER.r, closedDoorBoxes(st));
    p.x = moved.x; p.z = moved.z;
    p.hp -= 6;
    p.san = clamp(p.san + SAN.onHurt * 0.5, 0, PLAYER.sanMax);
    emit(st, { k: 'toast', text: '重尸把你撞开了。绕过去，别打它。', tone: 'warn' });
    if (p.hp <= 0) knockOut(st);
    return;
  }
  const deep = st.rng() < 0.34;
  if (deep) {
    p.hp -= MED.torsoBite.dmg;
    p.bleed += MED.torsoBite.bleed;
    if (p.infection === null) {
      p.infection = MED.infectSeconds;
      emit(st, { k: 'toast', text: '躯干深咬。90 秒内不处理就感染了。', tone: 'bad' });
      emit(st, { k: 'log', text: '被咬在身上。倒计时开始了。', type: 'fact' });
    }
  } else {
    p.hp -= MED.limbBite.dmg;
    p.bleed += MED.limbBite.bleed;
    emit(st, { k: 'toast', text: '咬在四肢。浅，但一直在流血。', tone: 'warn' });
  }
  p.san = clamp(p.san + SAN.onHurt, 0, PLAYER.sanMax);
  emit(st, { k: 'bite', deep });
  if (p.hp <= 0) knockOut(st);
}

function spawnRunners(st: ZoneState): void {
  for (let i = 0; i < RUNNER_COUNT; i++) {
    const a = (i / RUNNER_COUNT) * Math.PI * 2;
    st.zombies.push({
      id: `zr${i}`, kind: 'runner', x: RUNNER_NEST.x + Math.cos(a) * 1.6, z: RUNNER_NEST.z + Math.sin(a) * 1.6,
      face: 0, hp: ZKINDS.runner.hp, alive: true, fake: false, state: 'patrol',
      homeX: RUNNER_NEST.x, homeZ: RUNNER_NEST.z,
      patrol: [[RUNNER_NEST.x, RUNNER_NEST.z], [24, -8], [30, -1]], wp: 1, dir: 1,
      target: null, alertT: 0, lostT: 0, cd: 0, screamCd: 0, wobble: st.rng() * 6
    });
  }
  emit(st, { k: 'toast', text: '23:00。东北那边，快尸出巢了。', tone: 'bad' });
  emit(st, { k: 'log', text: '23:00 快尸出巢。该往回走了。', type: 'fact' });
}

// ---------------------------------------------------------------- 机动队

function updateMilitia(st: ZoneState, dt: number): void {
  const p = st.player;
  const boxes = closedDoorBoxes(st);
  const curfew = st.gameMin >= 120;

  for (const m of st.militia) {
    if (!m.alive) continue;
    m.cd = Math.max(0, m.cd - dt);
    m.warnedT = Math.max(0, m.warnedT - dt);
    if (m.warnedT <= 0 && m.warned && m.kind !== 'checkpoint') m.warned = false;

    if (m.light) m.sweep += dt * 0.55;

    // 被围死
    let near = 0;
    for (const z of st.zombies) if (z.alive && !z.fake && dist(z.x, z.z, m.x, m.z) < 3.4) near++;
    if (near >= 3) { killMilitia(st, m); continue; }

    // 开枪打丧尸（免费的清尸工具）
    let zt: ZombieState | null = null; let zd = 1e9;
    for (const z of st.zombies) {
      if (!z.alive || z.fake) continue;
      const d = dist(z.x, z.z, m.x, m.z);
      if (d < 13 && d < zd && !losBlocked(m.x, m.z, z.x, z.z, boxes)) { zd = d; zt = z; }
    }
    if (zt) {
      m.state = 'engage';
      const dx = zt.x - m.x, dz = zt.z - m.z;
      m.face = Math.atan2(dx, dz);
      if (zd > 8) {
        const moved = slide(st, m.x, m.z, (dx / zd) * m.speed * dt, (dz / zd) * m.speed * dt, 0.42);
        m.x = moved.x; m.z = moved.z;
      }
      if (m.cd <= 0) {
        m.cd = 0.95;
        militiaShot(st, m);
        if (!ZKINDS[zt.kind].invincible) { zt.hp -= 70; if (zt.hp <= 0) { zt.alive = false; zt.state = 'dead'; } }
      }
      continue;
    }

    // 看见玩家
    const pd = dist(m.x, m.z, p.x, p.z);
    const sees = pd < (m.light ? 15 : 9) && !losBlocked(m.x, m.z, p.x, p.z, boxes);
    if (sees) {
      if (m.kind === 'cleanup') {
        m.state = 'hunt';
        m.face = Math.atan2(p.x - m.x, p.z - m.z);
        if (m.cd <= 0 && pd < 14) {
          m.cd = 1.6;
          militiaShot(st, m);
          p.hp -= MED.militiaShot;
          p.bleed += 1;
          p.san = clamp(p.san + SAN.onHurt, 0, PLAYER.sanMax);
          emit(st, { k: 'toast', text: '清剿队开枪了。他们不警告。', tone: 'bad' });
          if (p.hp <= 0) knockOut(st);
        }
        if (pd > 5) {
          const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1;
          const moved = slide(st, m.x, m.z, (dx / d) * MILITIA_CLEANUP_SPEED * dt, (dz / d) * MILITIA_CLEANUP_SPEED * dt, 0.42);
          m.x = moved.x; m.z = moved.z;
        }
        continue;
      }
      if (m.kind === 'checkpoint' && !curfew) {
        if ((st.flags.passChecked ?? 0) === 0) {
          st.flags.passChecked = 1;
          if (countItem(st, 'pass') > 0) {
            emit(st, { k: 'toast', text: '通行条。过去吧。', tone: 'good' });
            emit(st, { k: 'log', text: '哨卡查了通行条，放行。', type: 'fact' });
          } else {
            emit(st, { k: 'toast', text: '没有通行条。他记了一笔，放你过去了。', tone: 'warn' });
            emit(st, { k: 'log', text: '哨卡没有通行条，记了一笔。', type: 'uncertain' });
            st.flags.checked = (st.flags.checked ?? 0) + 1;
          }
        }
      } else if (curfew) {
        m.face = Math.atan2(p.x - m.x, p.z - m.z);
        if (!m.warned) {
          m.warned = true; m.warnedT = 10;
          emit(st, { k: 'warn' });
          emit(st, { k: 'toast', text: '“站住——宵禁。”（第一次是警告）', tone: 'warn' });
        } else if (m.cd <= 0) {
          m.cd = 1.8;
          militiaShot(st, m);
          p.hp -= MED.militiaShot;
          p.bleed += 1;
          p.san = clamp(p.san + SAN.onHurt, 0, PLAYER.sanMax);
          emit(st, { k: 'toast', text: '第二次。他们开枪了。', tone: 'bad' });
          if (p.hp <= 0) knockOut(st);
        }
      }
    }

    // 循声 / 巡逻
    if (m.target) {
      const d2 = dist(m.x, m.z, m.target.x, m.target.z);
      if (d2 < 1.2) m.target = null;
      else {
        const dx = m.target.x - m.x, dz = m.target.z - m.z, d = Math.hypot(dx, dz) || 1;
        m.face = Math.atan2(dx, dz);
        const moved = slide(st, m.x, m.z, (dx / d) * m.speed * dt, (dz / d) * m.speed * dt, 0.42);
        m.x = moved.x; m.z = moved.z;
        continue;
      }
    }
    patrolStep(st, m, dt);
  }
}

function patrolStep(st: ZoneState, m: MilitiaState, dt: number): void {
  if (m.route.length < 2) {
    m.face += dt * 0.4;
    return;
  }
  const wp = m.route[m.wp];
  const d = dist(m.x, m.z, wp[0], wp[1]);
  if (d < 1.0) { m.wp = (m.wp + 1) % m.route.length; return; }
  const dx = wp[0] - m.x, dz = wp[1] - m.z;
  m.face = Math.atan2(dx, dz);
  const moved = slide(st, m.x, m.z, (dx / d) * m.speed * dt, (dz / d) * m.speed * dt, 0.42);
  m.x = moved.x; m.z = moved.z;
}

function militiaShot(st: ZoneState, m: MilitiaState): void {
  noiseAt(st, m.x, m.z, 5);
  emit(st, { k: 'shot', x: m.x, z: m.z, by: 'militia' });
  st.cleanupAt = { x: m.x, z: m.z };
  if (st.cleanupTimer <= 0) st.cleanupTimer = MILITIA_CLEANUP_DELAY;
}

function killMilitia(st: ZoneState, m: MilitiaState): void {
  m.alive = false;
  const loot = [MILITIA_LOOT[Math.floor(st.rng() * MILITIA_LOOT.length)]];
  const id = `k-body-${m.id}`;
  const def: ContainerDef = { id, x: m.x, z: m.z, label: '机动队的尸体', loot, time: 2.0, noise: 2, kind: 'body' };
  DYNAMIC_CONTAINERS.set(id, def);
  st.containers.push({ id, left: loot.slice() });
  emit(st, { k: 'log', text: '巡逻队被围死了。枪声引来的东西比他们打掉的多。', type: 'fact' });
}

function updateCleanup(st: ZoneState, dt: number): void {
  st.cleanupCd = Math.max(0, st.cleanupCd - dt);
  if (st.cleanupTimer <= 0) return;
  st.cleanupTimer -= dt;
  if (st.cleanupTimer > 0) return;
  const aliveSquads = st.militia.filter((m) => m.kind === 'cleanup' && m.alive).length;
  if (aliveSquads >= 2 || st.cleanupCd > 0) { st.cleanupTimer = 0; return; }
  st.cleanupCd = 70;
  const at = st.cleanupAt ?? { x: st.player.x, z: st.player.z };
  // 从最近的图缘出发
  const edgeX = at.x > 0 ? MAP.maxX - 1.5 : MAP.minX + 1.5;
  for (let i = 0; i < 2; i++) {
    st.militia.push({
      id: `m-clean-${st.uid++}`, kind: 'cleanup',
      x: clamp(edgeX, MAP.minX + 2, MAP.maxX - 2), z: clamp(at.z + (i - 0.5) * 3, MAP.minZ + 2, MAP.maxZ - 2),
      face: 0, route: [[at.x, at.z]], wp: 0, dir: 1,
      alive: true, hp: 90, state: 'hunt', target: { x: at.x, z: at.z },
      cd: 0, warned: true, warnedT: 0, light: true, sweep: i, speed: MILITIA_CLEANUP_SPEED
    });
  }
  emit(st, { k: 'toast', text: '清剿队出发了。他们循着枪声，不警告。', tone: 'bad' });
  emit(st, { k: 'log', text: '清剿队循声出发。任何枪声都有这个下场——包括机动队自己的。', type: 'fact' });
}

// ---------------------------------------------------------------- San / 天亮 / KO

function updateSan(st: ZoneState, dt: number): void {
  const p = st.player;
  const lit = inLight(st, p.x, p.z);
  if (lit) p.san = clamp(p.san + SAN.lightGain * dt, 0, PLAYER.sanMax);
  else p.san = clamp(p.san - (p.moving ? SAN.darkMove : SAN.darkStill) * dt, 0, PLAYER.sanMax);
  if (isDark(p.x, p.z) && !p.light) p.san = clamp(p.san - SAN.darkMove * 0.6 * dt, 0, PLAYER.sanMax);

  let near = 0;
  for (const z of st.zombies) if (z.alive && !z.fake && dist(z.x, z.z, p.x, p.z) < SAN.nearZombieDist) near++;
  if (near > 0) p.san = clamp(p.san - SAN.nearZombie * Math.min(near, 3) * 0.5 * dt, 0, PLAYER.sanMax);

  // 幻觉体
  const phantoms = st.zombies.filter((z) => z.fake && z.alive).length;
  if (p.san < SAN.phantomBelow && phantoms < SAN.phantomMax && st.rng() < dt * 0.5) {
    const a = st.rng() * Math.PI * 2;
    const r = 16 + st.rng() * 6;
    st.zombies.push({
      id: `zp-${st.uid++}`, kind: 'phantom',
      x: clamp(p.x + Math.cos(a) * r, MAP.minX + 1, MAP.maxX - 1),
      z: clamp(p.z + Math.sin(a) * r, MAP.minZ + 1, MAP.maxZ - 1),
      face: 0, hp: 1, alive: true, fake: true, state: 'chase',
      homeX: p.x, homeZ: p.z, patrol: [[p.x, p.z]], wp: 0, dir: 1,
      target: { x: p.x, z: p.z }, alertT: 0, lostT: 0, cd: 0, screamCd: 0, wobble: 0
    });
  }
}

function onDawn(st: ZoneState): void {
  st.phase = 'dawn';
  emit(st, { k: 'dawn' });
  const out = dist(st.player.x, st.player.z, HOME.x, HOME.z) >= HOME.r;
  if (out) {
    st.flags.recorded = 1;
    st.flags.dawnOut = 1;
    emit(st, { k: 'toast', text: '05:30 天亮了。你在街上被看见了——今日核酸作废。', tone: 'bad' });
    emit(st, { k: 'log', text: '05:30 天亮。你没在家里。被记录。', type: 'fact' });
  } else {
    emit(st, { k: 'toast', text: '05:30 天亮了。你在门廊灯底下。', tone: 'good' });
  }
}

export function knockOut(st: ZoneState): void {
  const p = st.player;
  if (p.down) return;
  p.down = true;
  p.hp = 0;
  st.koCount++;
  p.san = clamp(p.san + SAN.onKO, 0, PLAYER.sanMax);

  // 随身物全部掉在原地（包一直在原地等人）
  const loot: string[] = [];
  for (const it of st.bag) for (let i = 0; i < it.n; i++) loot.push(it.id);
  st.bag = [];
  if (p.weapon) loot.push(p.weapon);
  if (p.gun) loot.push('pistol');
  st.bagDrop.push({ uid: st.uid++, x: p.x, z: p.z, loot });
  emit(st, { k: 'ko', x: p.x, z: p.z });
  emit(st, { k: 'log', text: `被打倒。东西全掉在 ${p.x.toFixed(0)}, ${p.z.toFixed(0)} 那一带。`, type: 'fact' });

  // +3 游戏小时，在定居点行军床上醒来
  st.gameMin += KO.gameMin;
  p.x = WAKE.x; p.z = WAKE.z;
  p.hp = KO.wakeHp; p.stamina = KO.wakeStamina;
  p.bleed = 0; p.infection = null;
  p.weapon = ''; p.weaponDur = 0; p.gun = false; p.ammo = 0;
  p.down = false;
  p.light = false;
  emit(st, { k: 'wake' });
  emit(st, { k: 'toast', text: '在行军床上醒来。三个小时没了。包还在原地。', tone: 'bad' });
  emit(st, { k: 'log', text: '昏迷：损失 3 小时，San −20。找尸之旅开始。', type: 'fact' });
}

// ---------------------------------------------------------------- 结算

function finish(st: ZoneState, home: boolean): void {
  if (st.phase === 'over') return;
  st.phase = 'over';
  const p = st.player;

  const loot: { id: string; name: string; n: number }[] = [];
  for (const it of st.bag) {
    const found = loot.find((l) => l.id === it.id);
    if (found) found.n += it.n;
    else loot.push({ id: it.id, name: ITEMS[it.id]?.name ?? it.id, n: it.n });
  }

  const refusals: string[] = [];
  if (p.gun) refusals.push('你带了枪出墙');
  if (st.shots > 0) refusals.push(`你开了 ${st.shots} 枪`);
  const ab = countItem(st, 'antibiotics');
  if (ab > 1) refusals.push(`你多拿了 ${ab - 1} 盒抗生素`);
  if (st.koCount > 0) refusals.push(`你被打倒 ${st.koCount} 次`);
  if ((st.flags.dawnOut ?? 0) > 0) refusals.push('05:30 之后你还在街上');
  if ((st.flags.checked ?? 0) > 0) refusals.push('哨卡记过你一笔（没有通行条）');

  const result: NightResult = {
    home,
    dawnOut: (st.flags.dawnOut ?? 0) > 0,
    recorded: (st.flags.recorded ?? 0) > 0,
    ko: st.koCount,
    shots: st.shots,
    loot,
    contracts: st.contracts.map((c) => ({
      id: c.id, title: CONTRACTS.find((x) => x.id === c.id)!.title, done: c.delivered
    })),
    refusals,
    clock: clockText(st.gameMin),
    san: Math.round(p.san),
    hp: Math.round(p.hp),
    register: null,
    days: st.days
  };
  st.result = result;
  if (home) emit(st, { k: 'home' });
  emit(st, { k: 'result', result });
}

export function finishRegister(st: ZoneState, honest: boolean): void {
  if (!st.result) return;
  st.result.register = honest ? 'honest' : 'fake';
  if (!honest) {
    st.result.refusals.push('登记与事实不符（照四十填）');
    st.result.recorded = true;
  }
  emit(st, { k: 'result', result: st.result });
}

// ---------------------------------------------------------------- 存档（独立键，与正传严格隔离）

export const ZONE_SAVE_KEY = 'yoz.zone.v1';
const SAVE_V = 1;

export function saveZone(st: ZoneState): string {
  return JSON.stringify({
    v: SAVE_V, seed: st.seed, t: st.t, gameMin: st.gameMin, phase: st.phase, days: st.days,
    seedUid: st.uid,
    p: { ...st.player, pry: null, search: null },
    z: st.zombies, m: st.militia,
    doors: st.doors, containers: st.containers, contracts: st.contracts,
    bag: st.bag, ground: st.ground, bagDrop: st.bagDrop,
    log: st.log.slice(-80), flags: st.flags,
    koCount: st.koCount, shots: st.shots,
    cleanupTimer: st.cleanupTimer, cleanupCd: st.cleanupCd, cleanupAt: st.cleanupAt
  });
}

export function loadZone(raw: string | null): ZoneState | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (d.v !== SAVE_V) return null;
    const seed = typeof d.seed === 'number' ? d.seed : 20261004;
    const st = createZone(seed, typeof d.days === 'number' ? d.days : 1);
    st.t = num(d.t, 0);
    st.gameMin = num(d.gameMin, 0);
    st.phase = (d.phase as Phase) ?? 'night';
    Object.assign(st.player, d.p as object);
    st.player.pry = null; st.player.search = null;
    st.zombies = (d.z as ZombieState[]) ?? st.zombies;
    st.militia = (d.m as MilitiaState[]) ?? st.militia;
    st.doors = (d.doors as DoorState[]) ?? st.doors;
    st.containers = (d.containers as ContainerState[]) ?? st.containers;
    st.contracts = (d.contracts as ContractState[]) ?? st.contracts;
    st.bag = (d.bag as BagItem[]) ?? [];
    st.ground = (d.ground as GroundItem[]) ?? [];
    st.bagDrop = (d.bagDrop as DroppedBag[]) ?? [];
    st.log = (d.log as LogLine[]) ?? [];
    st.flags = (d.flags as Record<string, number>) ?? {};
    st.koCount = num(d.koCount, 0);
    st.shots = num(d.shots, 0);
    st.cleanupTimer = num(d.cleanupTimer, 0);
    st.cleanupCd = num(d.cleanupCd, 0);
    st.cleanupAt = (d.cleanupAt as { x: number; z: number } | null) ?? null;
    st.uid = num(d.seedUid, 1);
    // 机动队尸体是动态容器，重建登记表
    for (const c of st.containers) {
      if (c.id.startsWith('k-body-') && !DYNAMIC_CONTAINERS.has(c.id)) {
        DYNAMIC_CONTAINERS.set(c.id, {
          id: c.id,
          x: (c as unknown as { x?: number }).x ?? 0,
          z: (c as unknown as { z?: number }).z ?? 0,
          label: '机动队的尸体', loot: c.left.slice(), time: 2.0, noise: 2, kind: 'body'
        } as ContainerDef);
      }
    }
    return st;
  } catch {
    return null;
  }
}

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

// ---------------------------------------------------------------- 给 UI 的只读快照

export interface HudSnapshot {
  clock: string;
  toDawn: number;
  hp: number; san: number; stamina: number;
  battery: number; light: boolean;
  bleed: number; infection: number | null;
  weapon: string; weaponName: string; weaponDur: number;
  gun: boolean; ammo: number;
  cells: number; cellsMax: number; heavy: boolean;
  contracts: { id: string; title: string; color: number; studs: number; done: boolean; ready: boolean }[];
  bagDrop: { x: number; z: number } | null;
  phase: Phase;
}

export function hudSnapshot(st: ZoneState): HudSnapshot {
  const p = st.player;
  return {
    clock: clockText(st.gameMin),
    toDawn: Math.max(0, NIGHT_MIN - st.gameMin),
    hp: Math.round(p.hp), san: Math.round(p.san), stamina: Math.round(p.stamina),
    battery: p.battery, light: p.light,
    bleed: p.bleed, infection: p.infection,
    weapon: p.weapon, weaponName: ITEMS[p.weapon]?.name ?? '空手',
    weaponDur: Math.round(p.weaponDur),
    gun: p.gun, ammo: p.ammo,
    cells: bagCellsUsed(st.bag), cellsMax: BAG_CELLS, heavy: isHeavy(st.bag),
    contracts: st.contracts.filter((c) => c.taken).map((c) => {
      const def = CONTRACTS.find((x) => x.id === c.id)!;
      return { id: c.id, title: def.title, color: def.color, studs: def.studs, done: c.delivered, ready: contractReady(st, def) };
    }),
    bagDrop: st.bagDrop.length ? { x: st.bagDrop[0].x, z: st.bagDrop[0].z } : null,
    phase: st.phase
  };
}

export { NEST, ROUTES, SPOTS, CONTRACTS, addItem, takeItem };
