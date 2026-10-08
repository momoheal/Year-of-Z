/**
 * zdata.ts —— 域外探索 · 单夜切片的单一数据源
 *
 * 全部为纯数据 + 纯函数，不依赖 THREE / DOM，供内核(zkernel)、建景(zscene)与测试共用。
 * 世界尺度：1 世界单位 = 40 设计 px（设计文档 3200×2200 px → 80×55 单位）。
 */

// ---------------------------------------------------------------- 尺度与时钟

/** 设计 px → 世界单位 */
export const PX = 1 / 40;

export const MAP = { minX: -40, maxX: 40, minZ: -27.5, maxZ: 27.5 };

/** 一夜 20:00 → 05:30 = 570 游戏分；0.75 游戏分/现实秒 → 约 12.7 现实分钟 */
export const NIGHT_MIN = 570;
export const GAME_MIN_PER_SEC = 0.75;
export const CURFEW_MIN = 120; // 22:00
export const RUNNER_MIN = 180; // 23:00 快尸出巢
export const DAWN_MIN = 570; // 05:30
export const FORCE_END_MIN = 600; // 06:00 强制收摊

export const TIME_BASE_H = 20;

/** 游戏分 → "HH:MM" */
export function clockText(min: number): string {
  const total = TIME_BASE_H * 60 + Math.floor(min);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 玩家 / 生态

export type Stance = 'sneak' | 'walk' | 'run';

export const SPEED: Record<Stance, number> = {
  sneak: 74 * PX, // 1.85
  walk: 138 * PX, // 3.45
  run: 218 * PX // 5.45
};

export const STAMINA = { max: 100, runDrain: 16, swing: 11, regen: 11, regenDelay: 0.6 };

export const PLAYER = {
  r: 0.45,
  hpMax: 100,
  sanMax: 100,
  swingRange: 1.9,
  swingArc: Math.PI * 0.55,
  interactRange: 2.3,
  swingCooldown: 0.62,
  throwCooldown: 1.1
};

/** 噪音等级 → 听觉半径（世界单位） */
export const NOISE_RADIUS = [0, 90 * PX, 200 * PX, 340 * PX, 540 * PX, 950 * PX];
export const NOISE_LABEL = ['无声', '细响', '清楚', '半条街', '刺耳', '全城'];

/** 走路/疾跑的持续脚步噪音：[等级, 间隔秒] */
export const STEP_NOISE: Record<Stance, { level: number; every: number } | null> = {
  sneak: null,
  walk: { level: 1, every: 0.62 },
  run: { level: 2, every: 0.4 }
};

export const FLASHLIGHT = { drainPerSec: 100 / 420, batteryRefill: 0.6, coneRange: 16, coneAngle: 0.42 };

export const SAN = {
  darkMove: 0.35,
  darkStill: 0.15,
  lightGain: 1.4,
  nearZombie: 0.8,
  nearZombieDist: 3.2,
  onKill: -6,
  onHurt: -4,
  onKO: -20,
  onEat: 18,
  phantomBelow: 45,
  phantomMax: 3
};

export const MED = {
  limbBite: { dmg: 8, bleed: 1 },
  torsoBite: { dmg: 16, bleed: 1, infect: true },
  bleedPerSec: 0.62,
  infectSeconds: 90,
  infectDps: 1.15,
  infectSanDrain: 0.5,
  bruteKnockback: 4.2,
  militiaShot: 22
};

export const KO = { gameMin: 180, san: -20, wakeHp: 35, wakeStamina: 40 };

// ---------------------------------------------------------------- 乐高物品牌

export type BrickShape = 'plate' | 'brick' | 'rod' | 'tile' | 'bottle';

export interface ItemDef {
  id: string;
  name: string;
  /** 背包占格 */
  w: number;
  h: number;
  shape: BrickShape;
  color: number;
  /** 可堆叠上限 */
  stack?: number;
  desc: string;
  /** 拒绝式选项标记：拿了会进结算档案 */
  refusal?: string;
  /** 使用效果 */
  use?: 'bandage' | 'antibiotics' | 'battery' | 'food' | 'equip';
  weapon?: { dmg: number; knock: number; noise: number; dur: number };
}

const W = (dmg: number, knock: number, noise: number, dur: number) => ({ dmg, knock, noise, dur });

export const ITEMS: Record<string, ItemDef> = {
  crowbar: {
    id: 'crowbar', name: '撬棍', w: 1, h: 3, shape: 'rod', color: 0x8f979e,
    desc: '武器也是钥匙。有耐久，会弯。', weapon: W(34, 2.2, 2, 100)
  },
  'crowbar-bent': {
    id: 'crowbar-bent', name: '弯撬棍', w: 1, h: 3, shape: 'rod', color: 0x7b6a55,
    desc: '弯了也能撑到回家——但撬门时会多响一点。', weapon: W(24, 1.6, 3, 45)
  },
  pipe: {
    id: 'pipe', name: '钢管', w: 1, h: 3, shape: 'rod', color: 0x9aa096,
    desc: '击退强化，撬门不行。', weapon: W(30, 3.6, 2, 80)
  },
  axe: {
    id: 'axe', name: '消防斧', w: 2, h: 3, shape: 'rod', color: 0x9a4f2f,
    desc: '高伤高噪音，破坏潜行。', weapon: W(62, 3.0, 3, 70)
  },
  pistol: {
    id: 'pistol', name: '手枪', w: 1, h: 2, shape: 'brick', color: 0x2f3532,
    desc: '约 8 发。枪声 5 级 = 清剿队 + 全街丧尸。永远提供，永远不建议。',
    refusal: '你带了枪出墙'
  },
  ammo: { id: 'ammo', name: '弹匣', w: 1, h: 1, shape: 'brick', color: 0x5b646c, stack: 4, desc: '一压子 6 发。' },
  bandage: { id: 'bandage', name: '绷带', w: 1, h: 1, shape: 'plate', color: 0xe8e4d6, stack: 4, desc: '止得住血，止不住感染。', use: 'bandage' },
  antibiotics: { id: 'antibiotics', name: '抗生素', w: 1, h: 1, shape: 'bottle', color: 0xc97363, stack: 4, desc: '止得住感染，止不住血。', use: 'antibiotics' },
  battery: { id: 'battery', name: '电池', w: 1, h: 1, shape: 'plate', color: 0xd9a05b, stack: 4, desc: '手电 +60%。', use: 'battery' },
  can: { id: 'can', name: '空罐', w: 1, h: 1, shape: 'plate', color: 0xb0b6b0, stack: 6, desc: '扔出去是声东击西；罐可回收再用。' },
  food: { id: 'food', name: '罐头', w: 1, h: 1, shape: 'brick', color: 0xd08a4a, stack: 6, desc: '吃口热的是 San 的活。', use: 'food' },
  flashlight: { id: 'flashlight', name: '手电', w: 1, h: 2, shape: 'brick', color: 0xd9c07a, desc: '照得见 = 被看见（丧尸视距 +50%）。' },
  pass: { id: 'pass', name: '通行条', w: 1, h: 1, shape: 'tile', color: 0x6f93b8, desc: '一张纸。也是归顺的象征物。' },
  key: { id: 'key', name: '钥匙串', w: 1, h: 1, shape: 'tile', color: 0xc9b273, desc: '挂在死人腰带上的那串。' },
  'key-north': { id: 'key-north', name: '北仓钥匙', w: 1, h: 1, shape: 'tile', color: 0x9fb07a, desc: '武器柜的。机动队身上或定居点换。' },
  register: { id: 'register', name: '登记本', w: 1, h: 2, shape: 'tile', color: 0xd8d4c8, desc: '只回声，不撒谎，不推任务。' }
};

export const BAG_COLS = 6;
export const BAG_ROWS = 5;
export const BAG_CELLS = BAG_COLS * BAG_ROWS;
/** 超过这个格数开始压速度、吃体力 */
export const BAG_HEAVY = 18;

// ---------------------------------------------------------------- 委托（乐高挂牌）

export interface ContractDef {
  id: string;
  title: string;
  /** 挂牌颜色：红=药 黄=料 蓝=人 */
  color: number;
  studs: number;
  brief: string;
  /** 交货需要的物品与数量 */
  need?: { id: string; n: number };
  /** 完成判定用的旗帜（非交货型委托） */
  flag?: string;
  /** 带回超过需求 → 拒绝式记录 */
  refusalOn?: { id: string; over: number; text: (n: number) => string };
  reward: string[];
}

export const CONTRACTS: ContractDef[] = [
  {
    id: 'c-med', title: '药房后库还有抗生素', color: 0xc97363, studs: 2,
    brief: '后库锁着。钥匙在便利店柜台后面——那具伏尸还没被翻干净。要一盒，只要一盒。',
    need: { id: 'antibiotics', n: 1 },
    refusalOn: { id: 'antibiotics', over: 1, text: (n) => `你多拿了 ${n} 盒抗生素` },
    reward: ['bandage', 'bandage', 'food']
  },
  {
    id: 'c-tool', title: '换一根直的回来', color: 0xd9a05b, studs: 1,
    brief: '五金店工作台上有根直的。我这根弯的，撬第三下就废了。',
    need: { id: 'crowbar', n: 1 },
    reward: ['battery', 'can']
  },
  {
    id: 'c-look', title: '南仓里困着一个人', color: 0x6f93b8, studs: 1,
    brief: '门是从外面顶上的。看一眼就行——我没让你把他带回来。',
    flag: 'sawTrapped',
    reward: ['food', 'bandage']
  }
];

/** 容器占地的碰撞尺寸（伏尸不挡路：趴在地上，走近就能搜） */
export const CONTAINER_BOX: Record<string, [number, number]> = {
  shelf: [2.4, 0.8], counter: [2.6, 1.0], crate: [1.6, 1.2], cage: [1.9, 0.7], desk: [1.8, 0.9]
};

// ---------------------------------------------------------------- 地图：静态几何

export interface BlockDef {
  x: number; z: number; w: number; d: number; h: number;
  color: number;
  kind: 'wall' | 'house' | 'shop' | 'warehouse' | 'tent' | 'prop' | 'shelf';
  sign?: string;
  roof?: number;
  /** 顶部是否收边（乐高薄板压顶） */
  cap?: number;
}

/**
 * 房间 = 四面墙 + 门洞，无屋顶（乐高剖面：俯视角要能读清室内）。
 * 商店与仓库都这样建——"室内"是真的能走进去的地方。
 */
export interface RoomDef {
  id: string; x: number; z: number; w: number; d: number; h: number;
  color: number; sign?: string; cap?: number;
  /** 门洞：side 决定在哪面墙上，at 是沿墙的偏移（相对房间中心），w 是洞宽 */
  door: { side: 'n' | 's' | 'e' | 'w'; at: number; w: number };
  /** 额外的内隔墙（后库 / 内间），同样是"墙 + 洞" */
  partitions?: { side: 'v' | 'h'; at: number; from: number; to: number; gapAt: number; gapW: number }[];
}

const T = 0.5; // 墙厚

function wallSeg(out: BlockDef[], cx: number, cz: number, w: number, d: number, h: number, color: number): void {
  if (w <= 0.02 || d <= 0.02) return;
  out.push({ x: cx, z: cz, w, d, h, color, kind: 'wall' });
}

/** 沿一条轴线切两段，中间留洞 */
function splitSeg(out: BlockDef[], axis: 'x' | 'z', fixed: number, from: number, to: number,
                  gapAt: number, gapW: number, thick: number, h: number, color: number): void {
  const ga = gapAt - gapW / 2;
  const gb = gapAt + gapW / 2;
  const push = (a: number, b: number) => {
    if (b - a <= 0.02) return;
    if (axis === 'x') wallSeg(out, (a + b) / 2, fixed, b - a, thick, h, color);
    else wallSeg(out, fixed, (a + b) / 2, thick, b - a, h, color);
  };
  push(from, Math.min(ga, to));
  push(Math.max(gb, from), to);
}

function buildRoom(r: RoomDef): BlockDef[] {
  const out: BlockDef[] = [];
  const hw = r.w / 2, hd = r.d / 2;
  const color = r.color, h = r.h;
  const d = r.door;
  if (d.side === 'n' || d.side === 's') {
    const fz = r.z + (d.side === 'n' ? -hd : hd);
    splitSeg(out, 'x', fz, r.x - hw, r.x + hw, r.x + d.at, d.w, T, h, color);
    splitSeg(out, 'z', r.x - hw, r.z - hd, r.z + hd, r.z, 0, T, h, color);
    splitSeg(out, 'z', r.x + hw, r.z - hd, r.z + hd, r.z, 0, T, h, color);
  } else {
    const fx = r.x + (d.side === 'w' ? -hw : hw);
    splitSeg(out, 'z', fx, r.z - hd, r.z + hd, r.z + d.at, d.w, T, h, color);
    splitSeg(out, 'x', r.z - hd, r.x - hw, r.x + hw, r.x, 0, T, h, color);
    splitSeg(out, 'x', r.z + hd, r.x - hw, r.x + hw, r.x, 0, T, h, color);
  }
  for (const p of r.partitions ?? []) {
    if (p.side === 'v') splitSeg(out, 'z', p.at, p.from, p.to, p.gapAt, p.gapW, T, h, color);
    else splitSeg(out, 'x', p.at, p.from, p.to, p.gapAt, p.gapW, T, h, color);
  }
  return out;
}

export const ROOMS: RoomDef[] = [
  // 商业街三店：门都开在东侧，正对街道
  { id: 'mart', x: -17.5, z: 1, w: 7, d: 6, h: 3.4, color: 0xc9c5b8, sign: '便利店', cap: 0x9a4f2f, door: { side: 'e', at: 0, w: 2.4 } },
  {
    id: 'pharmacy', x: -19, z: 7.5, w: 10, d: 6, h: 3.4, color: 0xc9c5b8, sign: '药房', cap: 0x93b48c,
    door: { side: 'e', at: 0, w: 2.4 },
    partitions: [{ side: 'v', at: -16.5, from: 4.5, to: 10.5, gapAt: 8.6, gapW: 2.2 }]
  },
  { id: 'tool', x: -17.5, z: 14, w: 7, d: 6, h: 3.4, color: 0xc9c5b8, sign: '五金店', cap: 0xd9a05b, door: { side: 'e', at: 0, w: 2.4 } },
  { id: 'grocery', x: -8.5, z: 9.5, w: 5, d: 11, h: 3.2, color: 0xb9b5a8, sign: '杂货', cap: 0x7d8387, door: { side: 'w', at: 0, w: 2.4 } },
  // 两座仓库：门开在彼此相对的那一面
  {
    id: 'north', x: 27, z: -17, w: 16, d: 12, h: 5, color: 0x9aa096, sign: '北仓', cap: 0x7d8387,
    door: { side: 's', at: 0, w: 3.2 },
    partitions: [{ side: 'h', at: -19.6, from: 19, to: 35, gapAt: 27, gapW: 2.4 }]
  },
  {
    id: 'south', x: 27, z: 9, w: 16, d: 12, h: 5, color: 0x9aa096, sign: '南仓', cap: 0x7d8387,
    door: { side: 'n', at: 0, w: 3.2 },
    partitions: [
      { side: 'h', at: 11.5, from: 28, to: 33, gapAt: 30.5, gapW: 2.2 },
      { side: 'v', at: 28, from: 11.5, to: 15, gapAt: 13, gapW: 0 },
      { side: 'v', at: 33, from: 11.5, to: 15, gapAt: 13, gapW: 0 }
    ]
  }
];

export const BLOCKS: BlockDef[] = [
  // ---- 小区（西南 · 家）
  { x: -40, z: 20.75, w: 0.6, d: 13.5, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -26, z: 16.5, w: 0.6, d: 5, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -26, z: 24.5, w: 0.6, d: 6, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -37, z: 14, w: 6, d: 0.6, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -30, z: 14, w: 8, d: 0.6, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -33, z: 27.2, w: 14, d: 0.6, h: 2.4, color: 0x8b9187, kind: 'wall' },
  { x: -34, z: 20, w: 7, d: 7, h: 7, color: 0xc9c5b8, kind: 'house', roof: 0x7d8387 },
  { x: -36, z: 25.4, w: 4, d: 3, h: 2.6, color: 0x9aa096, kind: 'prop' }, // 车棚
  { x: -28.5, z: 25.6, w: 4.5, d: 3, h: 3, color: 0xb0a894, kind: 'prop', sign: '核酸' }, // 核酸点

  // ---- 街道小品
  { x: -18.5, z: -3.2, w: 2.2, d: 2.2, h: 2.6, color: 0x8f979e, kind: 'prop', sign: '报' },

  // ---- 主干道 · 哨卡（中）
  { x: 0, z: -2.4, w: 5, d: 1.4, h: 1.6, color: 0x9a4f2f, kind: 'prop' },
  { x: 0, z: 2.4, w: 5, d: 1.4, h: 1.6, color: 0x9a4f2f, kind: 'prop' },
  { x: 5.5, z: -5.4, w: 4, d: 3.4, h: 3, color: 0x6f7469, kind: 'prop', sign: '卡' },
  { x: -16, z: -4.5, w: 5, d: 2, h: 3, color: 0x8b9187, kind: 'prop', sign: '站' },
  { x: -9, z: -5.2, w: 3.4, d: 0.4, h: 2.4, color: 0x8b6f4e, kind: 'prop', sign: '栏' },
  { x: 12, z: -4.6, w: 4.6, d: 2.1, h: 1.7, color: 0x5b6a74, kind: 'prop', sign: '警' },

  // ---- 定居点（北）
  { x: -9.5, z: -19.5, w: 0.6, d: 13, h: 2.2, color: 0x8b6f4e, kind: 'wall' },
  { x: 9.5, z: -19.5, w: 0.6, d: 13, h: 2.2, color: 0x8b6f4e, kind: 'wall' },
  { x: 0, z: -26.5, w: 19.6, d: 0.6, h: 2.2, color: 0x8b6f4e, kind: 'wall' },
  { x: -6.5, z: -13.2, w: 6.6, d: 0.6, h: 2.2, color: 0x8b6f4e, kind: 'wall' },
  { x: 6.2, z: -13.2, w: 6.6, d: 0.6, h: 2.2, color: 0x8b6f4e, kind: 'wall' },
  { x: -7, z: -22, w: 3.5, d: 3, h: 2.6, color: 0x9a8f76, kind: 'tent' },
  { x: 6.5, z: -23, w: 3.5, d: 3, h: 2.6, color: 0x9a8f76, kind: 'tent' },
  { x: 2, z: -16, w: 3, d: 1.6, h: 1, color: 0x8b6f4e, kind: 'prop' },

  // ---- 仓库区货柜
  { x: 20, z: -6, w: 4, d: 2.6, h: 2.6, color: 0x9a4f2f, kind: 'prop' },
  { x: 25, z: -6.5, w: 4, d: 2.6, h: 2.6, color: 0x6f7469, kind: 'prop' },
  { x: 17, z: -3.5, w: 2.6, d: 4, h: 2.6, color: 0x9a4f2f, kind: 'prop' },
  { x: 33, z: -6, w: 2.6, d: 4, h: 2.6, color: 0x6f7469, kind: 'prop' },
  { x: 30, z: 4.5, w: 2, d: 2, h: 1.5, color: 0xd9a05b, kind: 'prop' },

  // ---- 地道（南缘）：一条封闭的暗走廊，两端开口
  { x: 4, z: 19, w: 52, d: 0.7, h: 3.2, color: 0x5b646c, kind: 'wall' },
  { x: 4, z: 23, w: 52, d: 0.7, h: 3.2, color: 0x5b646c, kind: 'wall' },

  // ---- 西北野外（后墙缺口路线 C）
  { x: -30, z: -4, w: 8, d: 5, h: 2, color: 0x6b6a5c, kind: 'prop' },
  { x: -34, z: 4.5, w: 4.5, d: 2, h: 1.6, color: 0x5b6a74, kind: 'prop' },
  { x: -22, z: -9, w: 3, d: 3, h: 2.4, color: 0x6b6a5c, kind: 'prop' },

  // ---- 房间（乐高剖面：四壁 + 门洞）
  ...ROOMS.flatMap(buildRoom)
];

/** 地面分区（道路 / 草地 / 室内地板），只影响观感与脚步音色占位 */
export interface GroundDef { x: number; z: number; w: number; d: number; kind: 'road' | 'dirt' | 'floor' | 'dark' }

export const GROUNDS: GroundDef[] = [
  { x: 0, z: 0, w: 80, d: 6, kind: 'road' }, // 主干道
  { x: -12.5, z: 6, w: 3.5, d: 22, kind: 'road' }, // 商业街
  { x: -33, z: 20, w: 14, d: 13, kind: 'floor' }, // 小区院内
  { x: 0, z: -20, w: 19, d: 14, kind: 'floor' }, // 定居点
  { x: 4, z: 21, w: 52, d: 4, kind: 'dark' }, // 地道
  { x: -30, z: -4, w: 22, d: 14, kind: 'dirt' }, // 西北空地
  // 室内地板（乐高剖面：没有屋顶，看得见地板）
  { x: -17.5, z: 1, w: 7, d: 6, kind: 'floor' },
  { x: -19, z: 7.5, w: 10, d: 6, kind: 'floor' },
  { x: -17.5, z: 14, w: 7, d: 6, kind: 'floor' },
  { x: -8.5, z: 9.5, w: 5, d: 11, kind: 'floor' },
  { x: 27, z: -17, w: 16, d: 12, kind: 'floor' },
  { x: 27, z: 9, w: 16, d: 12, kind: 'floor' }
];

/** 光源：路灯 / 灶火 / 门廊灯（San 恢复点与安全岛） */
export interface LampDef { id: string; x: number; z: number; r: number; kind: 'pole' | 'fire' | 'porch' | 'checkpoint'; warm?: number }

export const LAMPS: LampDef[] = [
  { id: 'home', x: -30, z: 20, r: 7.5, kind: 'porch', warm: 0xffd9a0 },
  { id: 'nucleic', x: -28.5, z: 25.6, r: 5, kind: 'pole' },
  { id: 'st-fire', x: 0, z: -20, r: 9, kind: 'fire', warm: 0xffb066 },
  { id: 'st-a', x: -2, z: -15.5, r: 5.5, kind: 'pole' },
  { id: 'st-b', x: 4, z: -21, r: 5.5, kind: 'pole' },
  { id: 'rd-a', x: -22, z: -2.4, r: 7, kind: 'pole' },
  { id: 'rd-b', x: 20, z: -2.4, r: 7, kind: 'pole' },
  { id: 'rd-c', x: 8, z: 2.6, r: 6, kind: 'pole' },
  { id: 'cp', x: 2.6, z: 0, r: 9, kind: 'checkpoint', warm: 0xfff0cc },
  { id: 'shop-a', x: -14, z: 2, r: 6, kind: 'pole' },
  { id: 'shop-b', x: -14, z: 12, r: 6, kind: 'pole' }
];

// ---------------------------------------------------------------- 门 / 容器 / 掉落

export interface DoorDef {
  id: string; x: number; z: number; w: number; ry: number;
  label: string; locked: boolean; keyId?: string;
  /** 门后的东西（撬开/打开后会被惊动） */
  behind?: string[];
  block: { x: number; z: number; w: number; d: number; h: number };
}

export const DOORS: DoorDef[] = [
  {
    id: 'd-pharmacy', x: -16.5, z: 8.6, w: 2.2, ry: Math.PI / 2, label: '药房后库', locked: true, keyId: 'key',
    behind: ['zl-pharm'],
    block: { x: -16.5, z: 8.6, w: 0.5, d: 2.2, h: 2.8 }
  },
  {
    id: 'd-northcage', x: 27, z: -19.6, w: 2.4, ry: 0, label: '北仓武器柜', locked: true, keyId: 'key-north',
    block: { x: 27, z: -19.6, w: 2.4, d: 0.5, h: 2.6 }
  },
  {
    id: 'd-southroom', x: 30.5, z: 11.5, w: 2.2, ry: 0, label: '南仓内间（从外面顶上的）', locked: false,
    block: { x: 30.5, z: 11.5, w: 2.2, d: 0.5, h: 2.6 }
  }
];

export interface ContainerDef {
  id: string; x: number; z: number; label: string;
  loot: string[];
  /** 需要门开着的 */
  needsDoor?: string;
  /** 搜刮耗时（秒） */
  time: number;
  /** 搜刮噪音等级（每件） */
  noise: number;
  kind: 'shelf' | 'counter' | 'crate' | 'body' | 'cage' | 'desk' | 'board';
}

export const CONTAINERS: ContainerDef[] = [
  { id: 'k-mart-a', x: -19.5, z: 0.2, label: '便利店货架', loot: ['food', 'can', 'battery'], time: 1.5, noise: 1, kind: 'shelf' },
  { id: 'k-mart-b', x: -15.4, z: 0.3, label: '柜台后的伏尸', loot: ['key', 'can', 'food'], time: 2.2, noise: 2, kind: 'body' },
  { id: 'k-pharm-f', x: -19.5, z: 5.2, label: '药房前厅', loot: ['bandage', 'bandage'], time: 1.4, noise: 1, kind: 'shelf' },
  { id: 'k-pharm-b', x: -21, z: 9.4, label: '药房后库', loot: ['antibiotics', 'antibiotics', 'antibiotics', 'bandage'], time: 2.0, noise: 2, kind: 'crate', needsDoor: 'd-pharmacy' },
  { id: 'k-tool-a', x: -19.5, z: 13.2, label: '五金店货架', loot: ['pipe', 'can', 'battery'], time: 1.6, noise: 1, kind: 'shelf' },
  { id: 'k-tool-b', x: -15.6, z: 15.6, label: '五金店工作台', loot: ['crowbar', 'battery'], time: 1.8, noise: 1, kind: 'desk' },
  { id: 'k-groc', x: -9.8, z: 10.4, label: '杂货店货箱', loot: ['can', 'food', 'bandage'], time: 1.6, noise: 1, kind: 'crate' },
  { id: 'k-car', x: 12, z: -3.2, label: '警车残骸', loot: ['pistol', 'ammo', 'ammo'], time: 2.4, noise: 2, kind: 'crate' },
  { id: 'k-north-a', x: 22.5, z: -14.5, label: '北仓货箱', loot: ['bandage', 'battery', 'food'], time: 1.6, noise: 1, kind: 'crate' },
  { id: 'k-north-b', x: 31, z: -14.5, label: '北仓货箱', loot: ['can', 'food', 'ammo'], time: 1.6, noise: 1, kind: 'crate' },
  { id: 'k-north-cage', x: 27, z: -21.4, label: '北仓武器柜', loot: ['axe'], time: 2.2, noise: 2, kind: 'cage', needsDoor: 'd-northcage' },
  { id: 'k-south-a', x: 22.5, z: 6, label: '南仓货箱', loot: ['food', 'bandage', 'can'], time: 1.6, noise: 1, kind: 'crate' },
  { id: 'k-south-b', x: 31.5, z: 6, label: '南仓货箱', loot: ['food', 'battery'], time: 1.6, noise: 1, kind: 'crate' },
  { id: 'k-tunnel', x: 8, z: 21, label: '地道里的箱子', loot: ['battery', 'can'], time: 1.8, noise: 2, kind: 'crate' },
  { id: 'k-settle', x: 2, z: -15.4, label: '定居点物资桌', loot: ['bandage', 'can'], time: 1.4, noise: 1, kind: 'desk' }
];

/** 特殊交互点（非容器） */
export interface SpotDef { id: string; x: number; z: number; label: string; kind: 'board' | 'bench' | 'fire' | 'bed' | 'home' | 'trapped' | 'gate' }

export const SPOTS: SpotDef[] = [
  { id: 's-board', x: -5.5, z: -16, label: '委托板', kind: 'board' },
  { id: 's-bench', x: 5.5, z: -17, label: '陈工的修械台', kind: 'bench' },
  { id: 's-fire', x: 0, z: -20, label: '灶火', kind: 'fire' },
  { id: 's-bed', x: -3, z: -24, label: '行军床', kind: 'bed' },
  { id: 's-home', x: -30, z: 20, label: '家（门廊灯）', kind: 'home' },
  { id: 's-trapped', x: 30.5, z: 13.2, label: '门后的人', kind: 'trapped' }
];

// ---------------------------------------------------------------- 出生表

export type ZKind = 'shambler' | 'runner' | 'croucher' | 'lurker' | 'screamer' | 'brute' | 'phantom';

export interface ZKindDef {
  kind: ZKind; name: string; speed: number; sight: number; hp: number;
  dmg: number; color: number; scale: number;
  /** 静止伏击型 */
  ambush?: boolean;
  /** 不可战胜 */
  invincible?: boolean;
  note: string;
}

export const ZKINDS: Record<ZKind, ZKindDef> = {
  shambler: { kind: 'shambler', name: '游荡者', speed: 1.55, sight: 9, hp: 60, dmg: 8, color: 0x7d8d6a, scale: 1, note: '噪音的听众。' },
  runner: { kind: 'runner', name: '快尸', speed: 4.6, sight: 13, hp: 45, dmg: 11, color: 0xc06a3a, scale: 0.96, note: '23:00 出巢。' },
  croucher: { kind: 'croucher', name: '蹲伏者', speed: 4.2, sight: 4, hp: 50, dmg: 12, color: 0x6b7a80, scale: 0.94, ambush: true, note: '惩罚贴墙抄近路。' },
  lurker: { kind: 'lurker', name: '伏地尸', speed: 3.4, sight: 3, hp: 45, dmg: 10, color: 0x8a6f7a, scale: 0.9, ambush: true, note: '惩罚搜刮与撬门的贪婪。' },
  screamer: { kind: 'screamer', name: '叫尸', speed: 1.3, sight: 10, hp: 70, dmg: 0, color: 0xd8c98a, scale: 1.02, note: '不咬人，尖叫召集半径内全体。优先目标。' },
  brute: { kind: 'brute', name: '重尸', speed: 1.05, sight: 6, hp: 400, dmg: 20, color: 0x5d5a52, scale: 1.62, invincible: true, note: '极慢、不可战胜。活的地形：逼你改道。' },
  phantom: { kind: 'phantom', name: '幻觉体', speed: 2.1, sight: 99, hp: 9999, dmg: 0, color: 0xa8b8d8, scale: 1, note: '低 San 时出现。挥击永远落空。' }
};

export interface ZSpawn { kind: ZKind; x: number; z: number; patrol?: [number, number][] }

export const ZOMBIE_SPAWNS: ZSpawn[] = [
  // 商业街：搜刮主课堂
  { kind: 'shambler', x: -12.5, z: 3, patrol: [[-12.5, 0], [-12.5, 15]] },
  { kind: 'shambler', x: -12.8, z: 10, patrol: [[-12.8, 6], [-12.8, 16]] },
  { kind: 'shambler', x: -22, z: -3.6 },
  { kind: 'lurker', x: -15.4, z: 1.6 }, // 便利店柜台后（钥匙就挂在他身上）
  { kind: 'croucher', x: -22.2, z: 7.6 }, // 药房前厅
  { kind: 'lurker', x: -20.6, z: 7.6 }, // 药房后库：撬门就会醒
  // 主干道：三方互咬的舞台
  { kind: 'shambler', x: -6, z: 1.2, patrol: [[-6, 1.2], [10, -1.4]] },
  { kind: 'shambler', x: 17, z: -1, patrol: [[17, -1], [24, 1.6]] },
  { kind: 'screamer', x: 7, z: 1.6, patrol: [[7, 1.6], [-4, -1.8]] },
  { kind: 'croucher', x: 2.6, z: 4.4 },
  // 仓库区：高风险高回报
  { kind: 'brute', x: 27, z: -10.2 }, // 北仓门口
  { kind: 'brute', x: 27, z: 1.8 }, // 南仓门口
  { kind: 'shambler', x: 21, z: -8.5, patrol: [[21, -8.5], [34, -8.5]] },
  { kind: 'shambler', x: 20, z: 16.5, patrol: [[20, 16.5], [34, 16.5]] },
  { kind: 'screamer', x: 30, z: -8 },
  { kind: 'croucher', x: 19.8, z: 6 },
  { kind: 'lurker', x: 31.2, z: 13.2 }, // 南仓内间，守着门后的人
  // 地道：黑、慢、有伏地尸
  { kind: 'lurker', x: 12, z: 21 },
  { kind: 'lurker', x: -6, z: 21 },
  { kind: 'shambler', x: 2, z: 21, patrol: [[-4, 21], [16, 21]] },
  // 城缘与西北野外
  { kind: 'shambler', x: -25, z: -8, patrol: [[-25, -8], [-25, 8]] },
  { kind: 'shambler', x: -37, z: 8, patrol: [[-37, 8], [-37, -10]] },
  { kind: 'shambler', x: 36, z: 20, patrol: [[36, 20], [36, -6]] },
  { kind: 'shambler', x: -20.5, z: 24, patrol: [[-20.5, 24], [-20.5, 26.5]] } // 地道西口外
];

export const RUNNER_NEST: { x: number; z: number } = { x: 36, z: -25 };
export const RUNNER_COUNT = 4;

// ---------------------------------------------------------------- 机动队

export interface PatrolDef {
  id: string;
  route: [number, number][];
  n: number;
  /** 探照灯 */
  light: boolean;
  /** 清剿队（枪声触发，不在初始表内） */
  cleanup?: boolean;
}

export const MILITIA: PatrolDef[] = [
  { id: 'm-checkpoint', route: [[2.6, 0], [2.6, 0]], n: 2, light: true },
  { id: 'm-road', route: [[-10, -1.4], [30, -1.4], [30, 1.4], [-10, 1.4]], n: 3, light: true },
  { id: 'm-shop', route: [[-12.5, 2.5], [-12.5, 16], [-12.5, 2.5]], n: 2, light: false }
];

/** 战后掉落：钥匙经济的"尸体"来源之一 */
export const MILITIA_LOOT: string[] = ['pass', 'ammo', 'bandage', 'key-north'];

export const MILITIA_SPEED = 2.5;
export const MILITIA_CLEANUP_DELAY = 25; // 秒
export const MILITIA_CLEANUP_SPEED = 3.4;

// ---------------------------------------------------------------- 撤离路线

export interface RouteDef { id: string; name: string; cond: string; risk: string; dist: number; waypoints: [number, number][] }

export const ROUTES: RouteDef[] = [
  {
    id: 'A', name: '大路 · 哨卡', cond: '通行条，或潜行钻探照灯死角', risk: '宵禁后极高', dist: 74,
    waypoints: [[27, 3.5], [-13.4, 0], [-13.4, 12], [-24, 19], [-30, 20]]
  },
  {
    id: 'B', name: '地道 · 南缘', cond: '手电 / 电池（摸黑也行，San 狂掉）', risk: '黑暗 + 伏地尸，无机动队', dist: 77,
    waypoints: [[30, 21], [-22, 21], [-26, 20], [-30, 20]]
  },
  {
    id: 'C', name: '后墙缺口 · 野外', cond: '无', risk: '最长，绕行西北空地', dist: 100,
    waypoints: [[8, -6], [-14, -8], [-27, -9], [-34, 3], [-33.5, 14], [-30, 20]]
  }
];

/** 回家判定圈 */
export const HOME = { x: -30, z: 20, r: 3.4 };
/** 出生点（小区正门外） */
export const SPAWN = { x: -24.6, z: 20 };
/** 昏迷醒来点（定居点行军床） */
export const WAKE = { x: -3, z: -24 };
/** 快尸巢 */
export const NEST = { x: 36, z: -25 };

// ---------------------------------------------------------------- 工具

/** 地道内部（纯黑区） */
export function inTunnel(x: number, z: number): boolean {
  return x > -22 && x < 30 && z > 19 && z < 23;
}

export const TUNNEL = { minX: -22, maxX: 30, minZ: 19, maxZ: 23, west: { x: -22, z: 21 }, east: { x: 30, z: 21 } };

/** 可复现随机源 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 角度归一到 [-PI, PI] */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
