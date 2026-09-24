/**
 * mapdata.ts —— 地图与引导的纯数据层（不依赖 DOM）
 *
 * 单一来源：场景出生点、园区静态阻挡（供 world.ts 建物理、tests 做一致性校验）、
 * 引路路点图（Dijkstra 求路，仅园区；目标由 story.ts 节点给出）、
 * 环境叙事热点（只读"注视"文本：不写新事实、不进日志、不给物品）。
 */

import type { Page, SceneId } from './story';

// ---------------------------------------------------------------- 场景

export const SPAWNS: Record<SceneId, { x: number; z: number }> = {
  park: { x: -12, z: 37 },
  depot: { x: -6, z: 7.5 },
  quarantine: { x: 0.2, z: 2.2 },
  gate: { x: 0.5, z: 3.6 },
  // 第二章占位场景（本次接入范围：数据 + 通用占位建图，无精细人物/道具）
  yard: { x: -1, z: 9 },
  road: { x: 0, z: 3 },
  pump: { x: 0, z: 0 },
  liuanli: { x: 0, z: 2 },
  canteen: { x: 0, z: -2 },
  // 第三章
  dongjie: { x: 0, z: 6 },       // 铁网门外的街口
  kitchen: { x: 0.5, z: 4.0 },   // 临时厨房（活动室）门内
  obsroom: { x: -0.5, z: 3.2 }   // 外勤观察处走廊侧
};

export const SCENE_CAPTIONS: Partial<Record<SceneId, string>> = {
  depot: '物资站 · 食品厂卸货口 —— 当天傍晚',
  quarantine: '围墙外 · 外勤观察点 —— 当夜',
  gate: '小区门口 —— 次日晨',
  yard: '小区院内 —— 第二次出发',
  road: '沿街卡点 · 下穿道 —— 上午',
  pump: '检修便道 · 泵站通道',
  liuanli: '柳岸里 · 北侧卸货口 —— 上午',
  canteen: '小区临时食堂 —— 傍晚',
  dongjie: '旧城东街 · 职工宿舍门口 —— 上午',
  kitchen: '东街临时厨房 · 原职工活动室',
  obsroom: '外勤观察处 —— 当夜至次日'
};

/** 场景可活动外框（测试校验目标点在界内） */
export const SCENE_BOUNDS: Record<SceneId, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  park: { minX: -29.5, maxX: 45.5, minZ: -33.5, maxZ: 42.5 },
  depot: { minX: -30, maxX: 30, minZ: -22, maxZ: 22 },
  quarantine: { minX: -4.2, maxX: 4.2, minZ: -3.0, maxZ: 3.0 },
  gate: { minX: -30, maxX: 30, minZ: -21, maxZ: 21 },
  // 第二章占位场景：外框按各自节点 target 覆盖范围留出边距，供 world.ts 占位建图与测试使用
  yard: { minX: -8, maxX: 8, minZ: -2, maxZ: 14 },
  road: { minX: -4, maxX: 16, minZ: -8, maxZ: 6 },
  pump: { minX: -8, maxX: 12, minZ: -4, maxZ: 12 },
  liuanli: { minX: -6, maxX: 8, minZ: -2, maxZ: 16 },
  canteen: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
  // 第三章：厨房是遭遇战场地，外框与 combat.ts 的 ARENA 对齐（留 0.4 米墙厚余量）
  dongjie: { minX: -10, maxX: 10, minZ: -6, maxZ: 10 },
  kitchen: { minX: -7, maxX: 7, minZ: -5.2, maxZ: 5.2 },
  obsroom: { minX: -6, maxX: 6, minZ: -4, maxZ: 5 }
};

// ---------------------------------------------------------------- 园区静态阻挡（与 world.ts parkPhysics 同步被消费）
// h 缺省 3；name 用于可移除阻挡。

export interface WallRect { x: number; z: number; hx: number; hz: number; h?: number; name?: string }

export const PARK_WALLS: WallRect[] = [
  // 围墙
  { x: 8, z: -34.4, hx: 39.4, hz: 0.5 },
  { x: -30.4, z: -2, hx: 0.5, hz: 33 },
  { x: 46.4, z: -2, hx: 0.5, hz: 33 },
  { x: -17, z: 30.4, hx: 13.5, hz: 0.5 },
  { x: 25, z: 30.4, hx: 21.5, hz: 0.5 },
  // 门外活动带外边界
  { x: 8, z: 44, hx: 40, hz: 0.6 },
  { x: -30.4, z: 37, hx: 0.5, hz: 7.5 },
  { x: 46.4, z: 37, hx: 0.5, hz: 7.5 },
  // 大型结构
  { x: -12, z: 34.5, hx: 4.3, hz: 1.45 },        // 卡车
  { x: -22.6, z: 33, hx: 1.5, hz: 1.35 },        // 收发亭（墙外）
  { x: -18, z: 2, hx: 5.4, hz: 4.4 },            // 办公楼
  { x: -17, z: 34, hx: 1.8, hz: 1.5 },           // 工具棚
  { x: -14.6, z: 34.6, hx: 0.8, hz: 1.0, h: 1 }, // 工具笼
  // 南库墙体（西侧留侧门开口）
  { x: 0, z: -19.4, hx: 13.9, hz: 0.5, h: 5.4 },
  { x: 13.1, z: -12, hx: 0.5, hz: 7.8, h: 5.4 },
  { x: -13.1, z: -14.2, hx: 0.5, hz: 4.9, h: 5.4 },
  { x: -13.1, z: -5.9, hx: 0.5, hz: 1.2, h: 5.4 },
  { x: 0, z: -5.1, hx: 13.3, hz: 0.35, h: 1.0 },
  { x: -13.1, z: -8.05, hx: 0.6, hz: 1.55, h: 3, name: 'side-door' },
  // 库内家具
  { x: -2.2, z: -14.5, hx: 8, hz: 0.7, h: 2 },   // 货架×南
  { x: -2.2, z: -17.5, hx: 8, hz: 0.7, h: 2 },   // 货架×北
  { x: 8.2, z: -15.4, hx: 2.2, hz: 0.2, h: 2 },  // 床单隔断
  { x: 6.9, z: -14.6, hx: 0.5, hz: 0.32, h: 1 }, // 折叠桌
  // 雨棚托盘区
  { x: 22.2, z: -7.2, hx: 2.9, hz: 0.9, h: 1.4 },
  { x: 28.8, z: -7.0, hx: 2.9, hz: 0.9, h: 1.4 },
  // 网门围栏
  { x: 37, z: -6, hx: 0.4, hz: 2.8, h: 2.5 },
  { x: 40, z: -8.6, hx: 3.4, hz: 0.4, h: 2.5 },
  { x: 40, z: -3.4, hx: 3.4, hz: 0.4, h: 2.5 },
  { x: 43, z: -6, hx: 0.4, hz: 3.0, h: 2.5 },
  // 绿篱与门柱
  { x: 14, z: 27.5, hx: 8, hz: 0.7, h: 1.1 },
  { x: -8, z: -24, hx: 5, hz: 0.7, h: 1.1 },
  { x: -4.2, z: 30.2, hx: 0.7, hz: 0.7, h: 3.4 },
  { x: 4.2, z: 30.2, hx: 0.7, hz: 0.7, h: 3.4 },
  { x: -9, z: 33.5, hx: 0.9, hz: 0.6, h: 0.6 },
  { x: 6, z: 33.5, hx: 0.9, hz: 0.6, h: 0.6 }
];

// ---------------------------------------------------------------- 园区引路路点图

export interface Waypoint { id: string; x: number; z: number; links: string[] }

export const PARK_WAYPOINTS: Waypoint[] = [
  { id: 'truck', x: -12, z: 36.8, links: ['gate-out', 'kiosk'] },
  { id: 'kiosk', x: -21.3, z: 33.5, links: ['truck'] },
  { id: 'gate-out', x: -2, z: 33.6, links: ['truck', 'gate'] },
  { id: 'gate', x: 0, z: 30.8, links: ['gate-out', 'gate-in'] },
  { id: 'gate-in', x: 0, z: 27.2, links: ['gate', 'road', 'east-road'] },
  { id: 'road', x: -4, z: 19.5, links: ['gate-in', 'office-se', 'east-road'] },
  { id: 'office-se', x: -12.5, z: 10, links: ['road', 'office-s', 'office-w1', 'yard-e'] },
  { id: 'office-s', x: -15, z: 7.8, links: ['office-se'] },
  { id: 'office-w1', x: -20, z: 8.2, links: ['office-se', 'office-w2'] },
  { id: 'office-w2', x: -24.5, z: 4, links: ['office-w1', 'office-w3'] },
  { id: 'office-w3', x: -24.5, z: -3.8, links: ['office-w2', 'yard-w'] },
  { id: 'yard-w', x: -19, z: -4.6, links: ['office-w3', 'door-appr'] },
  { id: 'door-appr', x: -16, z: -6.5, links: ['yard-w', 'side-door'] },
  { id: 'side-door', x: -14.5, z: -8.1, links: ['door-appr', 'wh-w', 'yard-swh'] },
  { id: 'yard-swh', x: -14, z: -3.6, links: ['side-door', 'yard-e'] },
  { id: 'wh-w', x: -11.5, z: -8.8, links: ['side-door', 'wh-c'] },
  { id: 'wh-c', x: 0, z: -9, links: ['wh-w', 'pillar'] },
  { id: 'pillar', x: 4, z: -9, links: ['wh-c', 'sheets-e'] },
  { id: 'sheets-e', x: 11.4, z: -13.2, links: ['pillar'] },
  { id: 'yard-e', x: 8, z: 2, links: ['office-se', 'yard-swh', 'channel'] },
  { id: 'channel', x: 17, z: -1, links: ['yard-e', 'shed-s'] },
  { id: 'shed-s', x: 26, z: -3, links: ['channel', 'shed'] },
  { id: 'shed', x: 26, z: -4.6, links: ['shed-s', 'mesh-appr'] },
  { id: 'mesh-appr', x: 33.5, z: -6, links: ['shed', 'mesh'] },
  { id: 'mesh', x: 35.9, z: -6, links: ['mesh-appr'] },
  { id: 'east-road', x: 18, z: 18, links: ['gate-in', 'road'] }
];

/** Dijkstra：玩家位置 → 目标位置的园区引路点列（含两端） */
export function routePark(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const ids = PARK_WAYPOINTS.map((w) => w.id);
  const pos = (id: string) => PARK_WAYPOINTS.find((w) => w.id === id)!;
  const nearest = (p: { x: number; z: number }) =>
    ids.reduce((a, b) => {
      const da = Math.hypot(pos(a).x - p.x, pos(a).z - p.z);
      const db = Math.hypot(pos(b).x - p.x, pos(b).z - p.z);
      return db < da ? b : a;
    });
  const start = nearest(from);
  const goal = nearest(to);
  const dist: Record<string, number> = { [start]: 0 };
  const prev: Record<string, string | undefined> = {};
  const open = new Set(ids);
  while (open.size > 0) {
    let u = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist[id] ?? Infinity;
      if (d < best) { best = d; u = id; }
    }
    if (u === '' || u === goal) break;
    open.delete(u);
    for (const v of pos(u).links) {
      if (!open.has(v)) continue;
      const w = Math.hypot(pos(v).x - pos(u).x, pos(v).z - pos(u).z);
      if ((dist[u] ?? 0) + w < (dist[v] ?? Infinity)) {
        dist[v] = (dist[u] ?? 0) + w;
        prev[v] = u;
      }
    }
  }
  const chain: { x: number; z: number }[] = [];
  let cur: string | undefined = goal;
  while (cur) {
    chain.unshift({ x: pos(cur).x, z: pos(cur).z });
    if (cur === start) break;
    cur = prev[cur];
  }
  if (chain.length === 0 || chain[0].x !== pos(start).x || chain[0].z !== pos(start).z) {
    chain.unshift({ x: pos(start).x, z: pos(start).z });
  }
  return [from, ...chain, to];
}

// ---------------------------------------------------------------- 环境叙事热点（只读，不写新事实）
// 口径：正文已有细节的回声；不产生物品/日志/剧情推进；正文逐条核对 doc/00 与 doc/24。

export interface HotspotDef {
  id: string;
  scene: SceneId;
  x: number;
  z: number;
  /** 触发半径，默认 2.4 */
  r?: number;
  label: string;
  pages: Page[];
  /** 需要已完成某节点才出现 */
  afterNode?: string;
  /** 这些节点为当前任务时让位（节点优先） */
  exceptNodes?: string[];
}

export const HOTSPOTS: HotspotDef[] = [
  {
    id: 'hot-truck',
    scene: 'park', x: -9.6, z: 33.4, label: '看看驾驶室',
    exceptNodes: ['C01-00', 'C01-08'],
    pages: [
      { text: '遮阳板后面塞着一袋医院开的药。门内贴着一张卷边的旧线路图，外围被人用红笔涂过，一层盖着一层。' },
      { text: '杜平靠着座椅闭着眼。他说的那句话还在："换个人开，得重新办线路许可。"' }
    ]
  },
  {
    id: 'hot-toolshed',
    scene: 'park', x: -17, z: 32.6, label: '看看工具棚',
    exceptNodes: ['C01-00'],
    pages: [
      { text: '工具箱合着。撬棍的编号牌空在钩上，登记簿摊在旁边——它现在在你手里，五点半前要还回来。' }
    ]
  },
  {
    id: 'hot-pots',
    scene: 'park', x: -21.4, z: 31.9, label: '看看花盆后',
    afterNode: 'C01-01',
    exceptNodes: ['C01-00'],
    pages: [
      { text: '花盆裂成了三瓣。放饼的地方只剩几粒渣。它跟出来了，隔着一段路，耳朵朝着这边。' }
    ]
  },
  {
    id: 'hot-bays',
    scene: 'park', x: 0, z: -11.6, label: '再看一眼空货位',
    afterNode: 'C01-04',
    pages: [
      { text: '黄线里的灰擦掉了又落。六个货位，一个没认错，一个也没剩。转位单的照片已经存进手机。' }
    ]
  },
  {
    id: 'hot-mesh-recheck',
    scene: 'park', x: 35.9, z: -6, label: '再观察一次网门',
    afterNode: 'C01-07',
    exceptNodes: ['C01-07'],
    pages: [
      { text: '那人仍蹲在门后，手探在缝隙里。饭盒在积水边上，没有再动。位置已经另报了——除此之外，什么也不能替他下结论。' }
    ]
  },
  {
    id: 'hot-medvan',
    scene: 'park', x: 4, z: 33, label: '看看医疗车',
    afterNode: 'C01-05',
    exceptNodes: ['C01-00', 'C01-08'],
    pages: [
      { text: '车门敞着，担架空了。母子俩不在这里了——登记单上写着接收站的名字，车号也抄在了回收单背面。' }
    ]
  },
  {
    id: 'hot-rations',
    scene: 'depot', x: -3.4, z: 4.4, label: '看看口粮袋',
    pages: [
      { text: '两小袋米，一盒肉罐头，登记在名下。塑料袋勒住的地方，正好是白天磨破的地方。' },
      { text: '有人低声说"出去一趟，还是有用"。没有恶意。你还是把袋子换到了另一只手后面。' }
    ]
  },
  {
    id: 'hot-depot-shed',
    scene: 'depot', x: -13.4, z: 6.2, label: '看看笼门边',
    pages: [
      { text: '灰灰压着你留在笼门边的布袋。名字叫到第三声，尾巴先动了。照护人说，先找主人，找不到，你来认。' }
    ]
  },
  {
    id: 'hot-notice',
    scene: 'gate', x: -4.4, z: -2.5, label: '看看通知栏',
    pages: [
      { text: '发放表贴得整整齐齐。"已送达"三个字，今天比昨天顺眼了一点——但也只是一点。' }
    ]
  }
];


// ---------------------------------------------------------------- 第三章：临时厨房（遭遇战场地）
// 单一来源：world.ts 建图与物理、combat.ts 的遮挡判定共用同一批矩形，
// 避免"画面上绕桌、逻辑上穿桌"。矩形语义同 WallRect（中心 + 半宽/半深）。

export const KITCHEN_WALLS: WallRect[] = [
  // 四面墙（南墙留门洞：玩家从这里进来）
  { x: 0, z: -5.4, hx: 7.2, hz: 0.4, h: 3 },
  { x: -7.4, z: 0, hx: 0.4, hz: 5.4, h: 3 },
  { x: 7.4, z: 0, hx: 0.4, hz: 5.4, h: 3 },
  { x: -4.2, z: 5.4, hx: 3.2, hz: 0.4, h: 3 },
  { x: 4.6, z: 5.4, hx: 2.8, hz: 0.4, h: 3 },
  // 家具（与 combat.ts BLOCKERS 一致）
  { x: 0, z: -3.0, hx: 3.4, hz: 0.55, h: 0.9 },    // 长桌 · 十七只碗
  { x: 5.5, z: 0.9, hx: 0.6, hz: 2.1, h: 0.95 },   // 备餐台（砧板与刀）
  { x: -5.9, z: -0.6, hx: 0.55, hz: 1.8, h: 0.9 }  // 窗下电饭锅台
];
