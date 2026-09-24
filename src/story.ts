/**
 * story.ts —— 《Z年纪事》第一章 Demo 叙事内核（纯数据 + 状态机，不依赖 DOM）
 *
 * 设计基线：doc/02、doc/03、doc/05 正文；节点与验收要求见 doc/24。
 * 本文件只做：节点数据、选择、物品派生、日志、存档闸门与版本校验。
 * 不把原文直接当作可执行脚本；对话文本为受控数据。
 */

import { CH1_ITEMS, CH1_NODES } from './data/chapter1';
import { CH2_ITEMS, CH2_NODES, type Ch2SceneId, type Ch2WorldEvent } from './data/chapter2';

// ---------------------------------------------------------------- 类型

export type SceneId = 'park' | 'depot' | 'quarantine' | 'gate' | Ch2SceneId;
export type LightPreset = 'dawn' | 'noon' | 'dusk' | 'night';
export type LightMode = 'auto' | LightPreset;
export type LogType = 'fact' | 'uncertain' | 'choice';

export interface Page {
  /** 省略表示叙述 */
  speaker?: string;
  text: string;
}

export interface ChoiceDef {
  id: string;
  /** 按钮正文 */
  label: string;
  /** 选中后追加播放的页 */
  pages: Page[];
  /** 记入日志 */
  log?: { type: LogType; text: string };
  /** 选择与事实不能这样写：拒绝提交，返回选择页 */
  rejected?: boolean;
  rejectReason?: string;
}

export interface NodeEffects {
  addItems?: string[];
  removeItems?: string[];
  log?: { type: LogType; text: string }[];
  flags?: string[];
  /** 通知 world.ts 的场景事件（与剧情事实一一对应） */
  worldEvent?:
    | 'open-side-door'
    | 'medical-arrive'
    | 'mark-pallets'
    | 'mesh-noted'
    | 'dog-to-shed'
    | Ch2WorldEvent;
  /** 完成后切换到的压缩场景 */
  toScene?: SceneId;
}

export interface NodeDef {
  id: string;
  title: string;
  objective: string;
  scene: SceneId;
  /** 世界坐标 [x, z] */
  target: [number, number];
  interactLabel: string;
  pages: Page[];
  choices?: ChoiceDef[];
  effects: NodeEffects;
}

export interface LogEntry {
  type: LogType;
  text: string;
  node: string;
}

export interface ItemDef {
  id: string;
  name: string;
  tag: '个人' | '借用' | '任务';
  note: string;
}

interface ItemDelta {
  node: string;
  add: string[];
  remove: string[];
}

export interface GameState {
  version: number;
  /** 已完成节点 id（必须严格按定义顺序） */
  completed: string[];
  choices: Record<string, string>;
  log: LogEntry[];
  flags: string[];
  itemJournal: ItemDelta[];
  player: { x: number; z: number };
  scene: SceneId;
  finished: boolean;
  lightMode: LightMode;
  volume: number;
  muted: boolean;
  /** 新局开始时间戳（毫秒），通关结算展示用时 */
  startTs?: number;
  /** 通关时间戳 */
  finishTs?: number;
}

// ---------------------------------------------------------------- 常量

export const SAVE_KEY = 'yoz.chapter1.v1';
export const WORKSHOP_KEY = 'yoz.workshop.v1';
/** 存档结构版本；每次新增/变更 GameState 字段就 +1，并在 migrateSave() 里补一级迁移 */
export const SAVE_VERSION = 2;
/** 交互判定距离（米） */
export const INTERACT_RANGE = 2.6;

// ---------------------------------------------------------------- 物品

/** 全部物品定义：第一章 + 第二章合并（同 id 后者覆盖前者，目前无冲突） */
export const ITEMS: Record<string, ItemDef> = { ...CH1_ITEMS, ...CH2_ITEMS };

/** 初始物品（母亲手套、早餐饼、反光背心）；其他物品由节点派生，避免重复领取 */
export const INITIAL_ITEMS = ['gloves', 'biscuit', 'vest'];

// ---------------------------------------------------------------- 节点数据
// 坐标对应 world.ts 的各场景布局；数据本体已按章拆分到 src/data/chapter1.ts、chapter2.ts，
// 这里只做拼接：存档闸门"严格按定义顺序推进"天然覆盖跨章节的连续序号。

export const NODES: NodeDef[] = [...CH1_NODES, ...CH2_NODES];

export const NODE_INDEX: Record<string, number> = Object.fromEntries(NODES.map((n, i) => [n.id, i]));

// ---------------------------------------------------------------- 状态机

export function createNewState(): GameState {
  return {
    version: SAVE_VERSION,
    completed: [],
    choices: {},
    log: [],
    flags: [],
    itemJournal: [{ node: 'init', add: [...INITIAL_ITEMS], remove: [] }],
    player: { x: -12, z: 37 },
    scene: 'park',
    finished: false,
    lightMode: 'auto',
    volume: 0.7,
    muted: false
  };
}

export function currentNode(state: GameState): NodeDef | null {
  if (state.finished) return null;
  return NODES[state.completed.length] ?? null;
}

export function hasFlag(state: GameState, f: string): boolean {
  return state.flags.includes(f);
}

/** 存档闸门：只允许按定义顺序推进，且不能重复完成 */
export function canStart(state: GameState, nodeId: string): { ok: true } | { ok: false; reason: string } {
  const node = NODES.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: '没有找到这个目标。' };
  if (state.finished) return { ok: false, reason: '本章已完成，可在设置或结尾处重玩。' };
  if (state.completed.includes(nodeId)) return { ok: false, reason: '这里已经处理过了。' };
  const next = currentNode(state);
  if (!next || next.id !== nodeId) {
    return { ok: false, reason: `先完成当前任务：${next ? `${next.id} ${next.title}` : '—'}` };
  }
  return { ok: true };
}

/** 交互距离判定（测试用例直接覆盖此纯函数） */
export function canInteract(distance: number): boolean {
  return distance <= INTERACT_RANGE;
}

export function distanceToNode(state: GameState, nodeId: string): number {
  const node = NODES.find((n) => n.id === nodeId);
  if (!node) return Infinity;
  const dx = state.player.x - node.target[0];
  const dz = state.player.z - node.target[1];
  return Math.hypot(dx, dz);
}

export type CompletionResult =
  | {
      ok: true;
      node: NodeDef;
      choice?: ChoiceDef;
      worldEvent?: NodeEffects['worldEvent'];
      toScene?: SceneId;
      finishedNow: boolean;
    }
  | { ok: false; reason: string; rejected?: boolean; pages?: Page[] };

/**
 * 完成节点。带选择的节点必须给出合法且未被拒绝的 choiceId；
 * 被拒绝的提交（如回收单勾选“无人”）不改变状态，返回回退页。
 */
export function completeNode(state: GameState, nodeId: string, choiceId?: string): CompletionResult {
  const start = canStart(state, nodeId);
  if (!start.ok) return { ok: false, reason: start.reason };
  const node = NODES.find((n) => n.id === nodeId)!;

  let choice: ChoiceDef | undefined;
  if (node.choices && node.choices.length > 0) {
    choice = node.choices.find((c) => c.id === choiceId);
    if (!choice) {
      return { ok: false, reason: '需要先作出一个选择。' };
    }
    if (choice.rejected) {
      return { ok: false, reason: choice.rejectReason ?? '这个提交方式被退回了。', rejected: true, pages: choice.pages };
    }
  }

  // 应用：完成顺序、选择记录
  state.completed.push(node.id);
  if (choice) state.choices[node.id] = choice.id;

  // 物品派生：结点效果 + 选择特例（C01-05 给水）
  const add = [...(node.effects.addItems ?? [])];
  const remove = [...(node.effects.removeItems ?? [])];
  if (node.id === 'C01-05' && choice?.id === 'give-water') remove.push('personal-water');
  state.itemJournal.push({ node: node.id, add, remove });

  // 日志：结点事实 + 选择记录
  for (const entry of node.effects.log ?? []) state.log.push({ ...entry, node: node.id });
  if (choice?.log) state.log.push({ ...choice.log, node: node.id });

  // 标志
  for (const f of node.effects.flags ?? []) {
    if (!state.flags.includes(f)) state.flags.push(f);
  }

  if (choice) {
    // 分支事实以 flag 形式留档（供后续章节读取）
    if (!state.flags.includes(`choice:${node.id}=${choice.id}`)) {
      state.flags.push(`choice:${node.id}=${choice.id}`);
    }
  }

  if (state.completed.length >= NODES.length) {
    state.finished = true;
    if (!state.finishTs) state.finishTs = Date.now();
  }

  return {
    ok: true,
    node,
    choice,
    worldEvent: node.effects.worldEvent,
    toScene: node.effects.toScene,
    finishedNow: state.finished && node.id === NODES[NODES.length - 1].id
  };
}

/** 物品派生：折叠流水账，重复领取与不匹配移除在这里被折叠消除 */
export function itemsFor(state: GameState): ItemDef[] {
  const owned = new Set<string>();
  for (const d of state.itemJournal) {
    for (const r of d.remove) owned.delete(r);
    for (const a of d.add) owned.add(a);
  }
  return [...owned].map((id) => ITEMS[id]).filter(Boolean);
}

export function hasItem(state: GameState, id: string): boolean {
  return itemsFor(state).some((i) => i.id === id);
}

/** 自动光照：跟随剧情时段（清晨出发—午后—傍晚交货—夜间留观—次日回家） */
export function autoLight(state: GameState): LightPreset {
  const n = state.completed.length;
  if (state.scene === 'gate') return 'dawn';
  if (state.scene === 'quarantine') return 'night';
  if (state.scene === 'depot') return 'dusk';
  if (n <= 4) return 'dawn';
  return 'noon';
}

// ---------------------------------------------------------------- 存档

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export interface ParseResult {
  state: GameState;
  /** true 表示原存档不可用，已恢复为新局（UI 应提示且不白屏） */
  recovered: boolean;
  reason?: string;
}

/**
 * 存档迁移链：旧版本存档在结构校验前先按版本号逐级补齐字段，避免新增章节/字段时
 * 老玩家的进度直接报废。每级迁移只做"补默认值"，不改变已有语义；无法识别的版本号
 * （包括未来版本）交由调用方按"版本不兼容"处理，不在这里猜测。
 */
function migrateSave(raw: Record<string, unknown>): Record<string, unknown> {
  let s = raw;
  const v = typeof s.version === 'number' ? s.version : 0;
  // v0（无版本号的极早期存档，理论上不应存在）：仅推进版本号，交由后续结构校验决定去留
  if (v < 1) s = { ...s, version: 1 };
  // v1 → v2：第二章数据接入。GameState 结构未变（无新增字段），仅推进版本号；
  // 若后续章节需要新增字段（如伤情、搬运状态），在这里补 `s = { ...s, 字段: 默认值 }`。
  if (v < 2) s = { ...s, version: 2 };
  return s;
}

export function parseSave(raw: string | null): ParseResult {
  if (raw == null) return { state: createNewState(), recovered: false };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: createNewState(), recovered: true, reason: '存档数据损坏' };
  }
  if (!obj || typeof obj !== 'object') {
    return { state: createNewState(), recovered: true, reason: '存档数据损坏' };
  }
  const s = migrateSave(obj as Record<string, unknown>) as Partial<GameState>;
  if (s.version !== SAVE_VERSION) {
    return { state: createNewState(), recovered: true, reason: '存档版本不兼容' };
  }
  // 结构校验：completed 必须是 NODES 的前缀（与闸门同一不变量）
  const completed = Array.isArray(s.completed) ? (s.completed as string[]) : null;
  if (!completed || completed.length > NODES.length ||
      !completed.every((id, i) => NODES[i]?.id === id)) {
    return { state: createNewState(), recovered: true, reason: '存档进度不合法' };
  }
  if (!Array.isArray(s.itemJournal) || !Array.isArray(s.log) || !Array.isArray(s.flags) ||
      typeof s.choices !== 'object' || s.choices === null ||
      typeof s.player !== 'object' || s.player === null) {
    return { state: createNewState(), recovered: true, reason: '存档字段缺失' };
  }
  const scenes: SceneId[] = ['park', 'depot', 'quarantine', 'gate', 'yard', 'road', 'pump', 'liuanli', 'canteen'];
  const scene = scenes.includes(s.scene as SceneId) ? (s.scene as SceneId) : 'park';
  return {
    state: {
      version: SAVE_VERSION,
      completed,
      choices: s.choices as Record<string, string>,
      log: s.log as LogEntry[],
      flags: [...new Set(s.flags as string[])],
      itemJournal: s.itemJournal as ItemDelta[],
      player: {
        x: typeof (s.player as { x?: unknown }).x === 'number' ? (s.player as { x: number }).x : -12,
        z: typeof (s.player as { z?: unknown }).z === 'number' ? (s.player as { z: number }).z : 37
      },
      scene,
      finished: s.finished === true && completed.length >= NODES.length,
      lightMode: (['auto', 'dawn', 'dusk', 'night'] as LightMode[]).includes(s.lightMode as LightMode)
        ? (s.lightMode as LightMode)
        : 'auto',
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.7,
      muted: s.muted === true,
      startTs: typeof s.startTs === 'number' ? s.startTs : undefined,
      finishTs: typeof s.finishTs === 'number' ? s.finishTs : undefined
    },
    recovered: false
  };
}
