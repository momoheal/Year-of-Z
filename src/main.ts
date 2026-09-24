/**
 * main.ts —— UI、输入、存档和帧循环
 *
 * 负责：标题/结尾覆盖层、对话逐页与选择、任务卡、背包/日志/设置互斥面板、
 * 键盘与触屏输入、localStorage 版本化存档（节点完成与节流写盘，不逐帧写）、
 * Web Audio 合成音频（可静音，首次操作后启动）、工坊入口与场景切换。
 */

import './style.css';
import {
  createElement,
  Backpack, BookOpenText, Settings, Volume2, VolumeX, Wrench,
  Hand, Cookie, Shirt, Droplets, Hammer, FileText, Camera, Barcode, Package, MapPin,
  Phone, Wheat, PackageX, Utensils, NotebookPen, ClipboardList, ScrollText, ListChecks
} from 'lucide';
import {
  autoLight, canInteract, canStart, completeNode, createNewState, currentNode,
  itemsFor, INTERACT_RANGE, NODES, parseSave, SAVE_KEY, serialize,
  type ChoiceDef, type GameState, type LightMode, type NodeDef, type Page, type SceneId
} from './story';
import { SPAWNS, SCENE_CAPTIONS } from './mapdata';
import { GameWorld } from './world';
import { Workshop } from './workshop';
import {
  ARENA, canSprint, createCombat, isLocked, stepCombat, TUNING,
  type CombatEvent, type CombatState
} from './combat';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ITEM_ICONS: Record<string, typeof Package> = {
  gloves: Hand,
  biscuit: Cookie,
  vest: Shirt,
  'personal-water': Droplets,
  crowbar: Hammer,
  'task-sheet': FileText,
  'transfer-photo': Camera,
  'batch-photo': Barcode,
  rations: Package,
  'lead-liuanli': MapPin,
  // 第二章
  'crowbar-2': Hammer,
  raincoat: Shirt,
  'handover-liuanli': FileText,
  'checkpoint-card': Phone,
  'van-plate-photo': Camera,
  'rice-8': Wheat,
  'oil-3': Droplets,
  'dry-gloves': Hand,
  'rice-7': Wheat,
  'rice-damaged': PackageX,
  'lead-dongjie': MapPin,
  // 第三章
  'meal-17': Utensils,
  'roster-note': NotebookPen,
  'transfer-slip': ClipboardList,
  'obs-card': ClipboardList,
  'statement-copy': ScrollText,
  'list-22': ListChecks
};

// ---------------------------------------------------------------- 音频（Web Audio 合成，无外部资源）

class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private volume = 0.7;
  private muted = false;

  /** 首次用户操作后调用 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    if (!this.muted) this.startDrone();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
    // 关闭后不留持续声源
    if (m) this.stopDrone();
    else if (this.ctx) this.startDrone();
  }

  private noiseBuffer(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, dur * ctx.sampleRate), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  private startDrone(): void {
    if (!this.ctx || !this.master || this.drone) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2.5);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 190;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.drone = { src, gain: g };
  }

  private stopDrone(): void {
    if (!this.drone) return;
    try { this.drone.src.stop(); } catch { /* 已停止 */ }
    this.drone.src.disconnect();
    this.drone.gain.disconnect();
    this.drone = null;
  }

  private burst(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, filterFreq: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  step(run: boolean): void { this.noiseBurst(0.09, run ? 500 : 380, 0.08); }
  page(): void { this.burst(720, 0.05, 0.05, 'triangle'); }
  ui(): void { this.burst(520, 0.06, 0.06, 'triangle'); }
  chime(): void { this.burst(660, 0.16, 0.07, 'sine'); this.burst(880, 0.22, 0.05, 'sine'); }
  clang(): void { this.noiseBurst(0.22, 2400, 0.16); this.burst(180, 0.2, 0.12, 'square'); }
  rumble(): void { this.noiseBurst(0.5, 120, 0.14); }
  // 遭遇战：全部为低频撞击与摩擦，不做惨叫或血腥音效
  thud(): void { this.noiseBurst(0.26, 160, 0.2); this.burst(70, 0.26, 0.14, 'sine'); }
  scrape(): void { this.noiseBurst(0.34, 900, 0.1); }
  breath(): void { this.noiseBurst(0.3, 300, 0.07); }
}

const audio = new AudioBus();

// ---------------------------------------------------------------- 全局

let world: GameWorld;
let workshop: Workshop | null = null;
let state: GameState;
let recoveredReason: string | undefined;
let started = false;

let session: {
  node: NodeDef;
  pages: Page[];
  idx: number;
  phase: 'pages' | 'choices' | 'choice-pages';
  choice?: ChoiceDef;
  rejectedBack?: boolean;
} | null = null;

let transitioning = false;
let endShown = false;
// 第三章遭遇战
let combat: CombatState | null = null;
let combatWinAt = 0;
let mouseGuard = false;
let touchGuard = false;
const edge = { guard: false, strike: false, interact: false };
let dirty = false;
let lastSave = 0;
let stepTimer = 0;
const keys = new Set<string>();
const joy = { active: false, x: 0, z: 0 };
let mouseAim: { x: number; z: number; t: number } | null = null;

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------------------------------------------------------------- 基础工具

function toast(msg: string, ms = 2600): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(Number(el.dataset.timer ?? 0));
  el.dataset.timer = String(setTimeout(() => el.classList.add('hidden'), ms));
}

function markDirty(): void { dirty = true; }

function saveNow(): void {
  try {
    if (started && world) {
      const p = world.playerPos();
      if (Number.isFinite(p.x)) state.player = { x: p.x, z: p.z };
    }
    localStorage.setItem(SAVE_KEY, serialize(state));
    dirty = false;
    lastSave = performance.now();
  } catch {
    // 存储不可写：本次游玩不受影响（doc/25）
  }
}

function paused(): boolean {
  return !!session || transitioning || !(($('title-screen')).classList.contains('hidden')) ||
    !($('end-screen')).classList.contains('hidden') ||
    ['panel-inventory', 'panel-log', 'panel-settings'].some((id) => !$(id).classList.contains('hidden')) ||
    !!(workshop && !$('workshop')?.classList.contains('hidden'));
}

/** 遭遇战进行中（未分胜负）：允许移动，但屏蔽普通交互与面板 */
function inCombat(): boolean {
  return !!combat && combat.outcome === 'none';
}

function anyPanelOpen(): boolean {
  return ['panel-inventory', 'panel-log', 'panel-settings'].some((id) => !$(id).classList.contains('hidden'));
}

// ---------------------------------------------------------------- 图标

function iconTo(el: HTMLElement, icon: typeof Package): void {
  el.innerHTML = '';
  el.appendChild(createElement(icon));
}

function initToolbar(): void {
  iconTo($('btn-inventory'), Backpack);
  iconTo($('btn-log'), BookOpenText);
  iconTo($('btn-settings'), Settings);
  iconTo($('btn-workshop'), Wrench);
  refreshMuteIcon();
}

function refreshMuteIcon(): void {
  iconTo($('btn-mute'), state.muted ? VolumeX : Volume2);
  $('btn-mute').classList.toggle('on', state.muted);
}

// ---------------------------------------------------------------- 面板

function togglePanel(id: string): void {
  if (inCombat()) return; // 打起来的时候不给开背包
  const el = $(id);
  const willOpen = el.classList.contains('hidden');
  for (const pid of ['panel-inventory', 'panel-log', 'panel-settings']) $(pid).classList.add('hidden');
  if (willOpen) {
    if (id === 'panel-inventory') renderInventory();
    if (id === 'panel-log') renderLog();
    el.classList.remove('hidden');
    audio.ui();
  }
}

function renderInventory(): void {
  const list = $('inventory-list');
  list.innerHTML = '';
  const items = itemsFor(state);
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-line">空。</div>';
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'item-card';
    const ic = document.createElement('div');
    ic.className = 'item-icon';
    ic.appendChild(createElement(ITEM_ICONS[item.id] ?? Package));
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    const tag = document.createElement('span');
    tag.className = 'item-tag';
    tag.textContent = item.tag;
    name.appendChild(tag);
    const note = document.createElement('div');
    note.className = 'item-note';
    note.textContent = item.note;
    body.appendChild(name);
    body.appendChild(note);
    card.appendChild(ic);
    card.appendChild(body);
    list.appendChild(card);
  }
  $('btn-inventory').querySelector('.tb-badge')?.remove();
}

function renderLog(): void {
  const list = $('log-list');
  list.innerHTML = '';
  if (state.log.length === 0) {
    list.innerHTML = '<div class="empty-line">还没有记录。任务完成后会按“事实 / 待核 / 选择”归档。</div>';
    return;
  }
  for (const entry of [...state.log].reverse()) {
    const row = document.createElement('div');
    row.className = 'log-row';
    const chip = document.createElement('span');
    chip.className = `chip chip-${entry.type === 'uncertain' ? 'uncertain' : entry.type}`;
    chip.textContent = entry.type === 'fact' ? '事实' : entry.type === 'uncertain' ? '待核' : '选择';
    const body = document.createElement('div');
    const text = document.createElement('div');
    text.className = 'log-text';
    text.textContent = entry.text;
    const node = document.createElement('div');
    node.className = 'log-node';
    node.textContent = entry.node === 'init' ? '—' : entry.node;
    body.appendChild(text);
    body.appendChild(node);
    row.appendChild(chip);
    row.appendChild(body);
    list.appendChild(row);
  }
  $('btn-log').querySelector('.tb-badge')?.remove();
}

function badge(btnId: string, n: number): void {
  const btn = $(btnId);
  btn.querySelector('.tb-badge')?.remove();
  if (n <= 0) return;
  const b = document.createElement('span');
  b.className = 'tb-badge';
  b.textContent = String(n);
  btn.appendChild(b);
}

// ---------------------------------------------------------------- 任务卡与标记

function refreshTaskCard(): void {
  const node = currentNode(state);
  $('task-progress').textContent = `${state.completed.length} / ${NODES.length}`;
  ($('task-progress-fill') as HTMLDivElement).style.width = `${(state.completed.length / NODES.length) * 100}%`;
  if (node) {
    $('task-title').textContent = `${node.id} · ${node.title}`;
    $('task-objective').textContent = node.objective;
  } else {
    $('task-title').textContent = '第一章 · 完';
    $('task-objective').textContent = '可查看日志、重玩本章或进入工坊试作。';
  }
  const done = $('task-done');
  done.innerHTML = '';
  for (const id of state.completed.slice(-3)) {
    const def = NODES.find((n) => n.id === id);
    if (!def) continue;
    const row = document.createElement('div');
    row.className = 'done-row';
    row.textContent = def.title;
    done.appendChild(row);
  }
  done.classList.toggle('has', state.completed.length > 0);

  const marker = node && node.scene === state.scene && !node.encounter && !combat ? node.target : null;
  world.setMarker(marker ? marker[0] : null, marker ? marker[1] : 0);
  if (!marker) $('task-guide').classList.add('hidden');
}

// ---------------------------------------------------------------- 任务指引罗盘（HUD 内，指向当前目标）
// 固定等距机位（camOffset x=9,y=33,z=24）下，世界 -Z（“北”）方向投影到屏幕近似朝上偏右，
// 因此箭头角度直接用目标相对玩家的世界向量换算，指向与地面引路箭头保持一致。

function updateTaskGuide(): void {
  const guide = $('task-guide');
  if (!started || paused()) { guide.classList.add('hidden'); return; }
  const marker = world.getMarker();
  if (!marker) { guide.classList.add('hidden'); return; }
  const p = world.playerPos();
  const dx = marker.x - p.x;
  const dz = marker.z - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= INTERACT_RANGE) { guide.classList.add('hidden'); return; }
  guide.classList.remove('hidden');
  const bearing = world.screenBearing(dx, dz);
  ($('task-guide-arrow') as unknown as SVGElement).style.transform = `rotate(${bearing}deg)`;
  $('task-guide-dist').textContent = `${Math.round(dist)} 米`;
}

// ---------------------------------------------------------------- 对话

function openDialog(node: NodeDef): void {
  session = { node, pages: node.pages, idx: 0, phase: 'pages' };
  $('dialog').classList.remove('hidden');
  $('interact-hint').classList.add('hidden');
  $('btn-interact-touch').classList.add('hidden');
  renderDialogPage();
}

function closeDialog(): void {
  session = null;
  $('dialog').classList.add('hidden');
}

function renderDialogPage(): void {
  if (!session) return;
  const page = session.pages[session.idx];
  const dlg = $('dialog');
  dlg.classList.toggle('叙述', !page.speaker);
  $('dialog-speaker').textContent = page.speaker ?? '';
  $('dialog-text').textContent = page.text;
  $('dialog-page').textContent = `${session.idx + 1} / ${session.pages.length}`;
  $('dialog-next').textContent = session.idx < session.pages.length - 1
    ? '继续 ▸'
    : session.node.choices && !session.choice ? '……' : '好 ▸';
  $('dialog-choices').classList.add('hidden');
  $('dialog-next').classList.remove('hidden');
}

function showChoices(): void {
  if (!session) return;
  session.phase = 'choices';
  const box = $('dialog-choices');
  box.innerHTML = '';
  $('dialog-text').textContent = '';
  $('dialog-page').textContent = '';
  $('dialog-next').classList.add('hidden');
  box.classList.remove('hidden');
  session.node.choices!.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'choice-btn';
    const key = document.createElement('b');
    key.textContent = String.fromCharCode(65 + i);
    b.appendChild(key);
    b.appendChild(document.createTextNode(c.label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pickChoice(c);
    });
    box.appendChild(b);
  });
}

function pickChoice(c: ChoiceDef): void {
  if (!session) return;
  audio.ui();
  session.choice = c;
  session.pages = c.pages;
  session.idx = 0;
  session.phase = 'choice-pages';
  session.rejectedBack = !!c.rejected;
  renderDialogPage();
}

function advanceDialog(): void {
  if (!session) return;
  if (session.phase === 'choices') return; // 必须点选
  session.idx++;
  audio.page();
  if (session.idx < session.pages.length) {
    renderDialogPage();
    return;
  }
  // 当前批页播完
  if (session.phase === 'pages' && session.node.choices && !session.choice) {
    showChoices();
    return;
  }
  if (session.rejectedBack) {
    // 被退回的写法：回到选择页，不改变任何状态
    session.rejectedBack = false;
    session.choice = undefined;
    session.idx = 0;
    $('dialog-text').textContent = '';
    showChoices();
    return;
  }
  finalizeDialog();
}

function finalizeDialog(): void {
  if (!session) return;
  const node = session.node;
  const r = completeNode(state, node.id, session.choice?.id);
  world.setNpcStage(state.completed.length); // NPC 随剧情换站位
  const choice = session.choice;
  closeDialog();
  if (!r.ok) {
    toast(r.reason);
    return;
  }
  // 特殊音效
  if (node.id === 'C01-03') {
    if (choice?.id === 'self') { audio.clang(); setTimeout(() => audio.rumble(), 480); }
    else audio.rumble();
  }
  audio.chime();
  if (r.worldEvent) world.applyWorldEvent(r.worldEvent);
  world.setLightMode(state.lightMode, autoLight(state));
  refreshTaskCard();
  badge('btn-log', 1);
  badge('btn-inventory', 1);
  saveNow();
  if (node.encounter) {
    // 遭遇战节点结算完毕：收起战斗 HUD 与镜头，来人不再出现在后续场景
    combat = null;
    world.renderCombat(null, 0);
    world.setEncounter(false);
    syncCombatHud();
  }
  if (r.toScene) {
    sceneTransition(r.toScene);
  }
  // 下一节点若是自动段落或遭遇战，不需要玩家再跑一趟
  if (!r.finishedNow) setTimeout(() => maybeAutoNode(), r.toScene ? 1500 : 700);
  if (r.finishedNow) {
    setTimeout(() => {
      $('end-screen').classList.remove('hidden');
      endShown = true;
    }, transitioning ? 1400 : 600);
  }
}

// ---------------------------------------------------------------- 场景切换

function sceneTransition(to: SceneId): void {
  transitioning = true;
  const fade = $('fade');
  $('fade-caption').textContent = SCENE_CAPTIONS[to] ?? '';
  fade.classList.remove('hidden', 'out');
  setTimeout(() => {
    state.scene = to;
    const spawn = SPAWNS[to];
    state.player = { x: spawn.x, z: spawn.z };
    world.setScene(to, spawn);
    world.setLightMode(state.lightMode, autoLight(state));
    refreshTaskCard();
    saveNow();
    fade.classList.add('out');
    setTimeout(() => {
      fade.classList.add('hidden');
      transitioning = false;
      maybeAutoNode();
    }, 620);
  }, 620);
}

// ---------------------------------------------------------------- 标题与开始

function bootTitle(): void {
  const savedRaw = localStorage.getItem(SAVE_KEY);
  const parsed = parseSave(savedRaw);
  state = parsed.state;
  recoveredReason = parsed.recovered ? (parsed.reason ?? '存档不可用') : undefined;
  const hasProgress = !parsed.recovered && (state.completed.length > 0 || state.finished);
  $('btn-continue').classList.toggle('hidden', !hasProgress);
  $('btn-start').textContent = hasProgress ? '重新开始' : '开始新的一天';
  $('btn-start').classList.toggle('primary', true);
  $('btn-start').classList.remove('danger', 'confirm');
}

function armNewGame(): void {
  const btn = $('btn-start');
  const savedRaw = localStorage.getItem(SAVE_KEY);
  const parsed = parseSave(savedRaw);
  const hasProgress = !parsed.recovered && (parsed.state.completed.length > 0);
  if (hasProgress && !btn.classList.contains('confirm')) {
    btn.classList.add('danger', 'confirm');
    btn.classList.remove('primary');
    btn.textContent = '将清除上次进度，再次点击确认';
    return;
  }
  if (hasProgress) localStorage.removeItem(SAVE_KEY);
  state = createNewState();
  startGame(true);
}

/**
 * 试玩入口：把一、二章按默认选择补全，直接从第三章开始（`?jump=fight` 则直接进厨房开打）。
 * 只用于试玩与回归，不改变正式流程：补全的进度与正常通关写入的是同一套存档结构。
 */
function jumpToChapter3(toFight: boolean): void {
  localStorage.removeItem(SAVE_KEY);
  state = createNewState();
  const stopAt = toFight ? 'C03-03' : 'C03-00';
  for (const n of NODES) {
    if (n.id === stopAt) break;
    const r = completeNode(state, n.id, n.choices?.find((c) => !c.rejected)?.id);
    if (!r.ok) break;
    if (r.toScene) state.scene = r.toScene;
  }
  const spawn = SPAWNS[state.scene];
  state.player = { x: spawn.x, z: spawn.z };
  startGame(true);
  toast(toFight ? '试玩：直接进入东街厨房的那一刻。' : '试玩：第三章开始，一、二章已按默认选择补全。', 4200);
}

function startGame(fresh: boolean): void {
  $('title-screen').classList.add('hidden');
  audio.unlock();
  if (recoveredReason) {
    toast(`${recoveredReason}，已恢复为新局。`);
    recoveredReason = undefined;
  }
  const spawn = fresh ? SPAWNS[state.scene] : SPD(state);
  world.setScene(state.scene, spawn);
  world.syncFromState(state);
  refreshTaskCard();
  started = true;
  saveNow();
  toast(currentNode(state) ? `当前任务：${currentNode(state)!.title}` : '章节已完成', 3200);
  setTimeout(() => maybeAutoNode(), 900);
}

function SPD(s: GameState): { x: number; z: number } {
  // 载入时恢复坐标；异常值则回出生点
  const p = s.player;
  if (s.scene === 'park' && Number.isFinite(p.x) && p.x > -40 && p.x < 55 && p.z > -50 && p.z < 50) return { x: p.x, z: p.z };
  return SPAWNS[s.scene];
}

// ---------------------------------------------------------------- 结束画面

function initEndScreen(): void {
  $('btn-end-log').addEventListener('click', () => {
    $('end-screen').classList.add('hidden');
    togglePanel('panel-log');
  });
  $('btn-end-roam').addEventListener('click', () => {
    $('end-screen').classList.add('hidden');
    toast('本章已完成。日志与背包仍可查看；下一章内容待解锁。');
  });
  $('btn-end-replay').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = '将清除本章存档，确认重玩？';
      return;
    }
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });
  $('btn-end-workshop').addEventListener('click', () => {
    $('end-screen').classList.add('hidden');
    openWorkshop();
  });
}

function openWorkshop(): void {
  if (!workshop) {
    workshop = new Workshop($('app'));
    workshop.onClose = () => {
      if (state.finished && !endShown) {
        // 打开工坊前已在结尾流程则无需处理
      }
      audio.ui();
    };
  }
  for (const pid of ['panel-inventory', 'panel-log', 'panel-settings']) $(pid).classList.add('hidden');
  workshop.open();
}

// ---------------------------------------------------------------- 设置

function initSettings(): void {
  for (const b of $('light-seg').querySelectorAll<HTMLButtonElement>('button[data-light]')) {
    b.addEventListener('click', () => {
      state.lightMode = b.dataset.light as LightMode;
      world.setLightMode(state.lightMode, autoLight(state));
      markDirty();
      saveNow();
      syncLightSeg();
      audio.ui();
    });
  }
  syncLightSeg();
  const vol = $('volume') as HTMLInputElement;
  vol.value = String(Math.round(state.volume * 100));
  vol.addEventListener('input', () => {
    state.volume = Number(vol.value) / 100;
    audio.unlock();
    audio.setVolume(state.volume);
    markDirty();
  });
  vol.addEventListener('change', () => saveNow());
  $('btn-restart').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = '确认清除并重玩？';
      setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = '重玩'; }, 3200);
      return;
    }
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });
}

function syncLightSeg(): void {
  for (const b of $('light-seg').querySelectorAll<HTMLButtonElement>('button[data-light]')) {
    b.classList.toggle('on', b.dataset.light === state.lightMode);
  }
}

// ---------------------------------------------------------------- 输入

function initInput(): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F5' || e.code === 'F12') return;
    keys.add(e.code);
    audio.unlock();
    if (e.code === 'Escape') {
      if (session) { closeDialog(); return; }
      if (anyPanelOpen()) {
        for (const pid of ['panel-inventory', 'panel-log', 'panel-settings']) $(pid).classList.add('hidden');
      }
      return;
    }
    if (session && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      advanceDialog();
      return;
    }
    if (paused()) return;
    if (inCombat()) {
      // 遭遇战：空格=挡（可长按，挣脱时连按），J/K=挥，E=拿手边的东西
      if (e.repeat) return;
      if (e.code === 'Space') { e.preventDefault(); edge.guard = true; }
      if (e.code === 'KeyJ' || e.code === 'KeyK') edge.strike = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') edge.interact = true;
      return;
    }
    if (e.code === 'KeyE' || e.code === 'KeyF') tryInteract();
    if (e.code === 'KeyB') togglePanel('panel-inventory');
    if (e.code === 'KeyL') togglePanel('panel-log');
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // 鼠标朝向 + 点击标记
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || paused()) return;
    const g = world.screenToGround(e.clientX, e.clientY);
    if (g) mouseAim = { x: g.x, z: g.z, t: performance.now() };
  }, { passive: true });

  window.addEventListener('contextmenu', (e) => { if (inCombat()) e.preventDefault(); });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) mouseGuard = false; });
  window.addEventListener('blur', () => { mouseGuard = false; touchGuard = false; });

  document.getElementById('game')!.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (inCombat()) {
      if (e.button === 2) { mouseGuard = true; edge.guard = true; }
      else edge.strike = true;
      return;
    }
    if (e.pointerType !== 'mouse' || paused()) return;
    const marker = world.getMarker();
    if (!marker) return;
    const g = world.screenToGround(e.clientX, e.clientY);
    if (g && Math.hypot(g.x - marker.x, g.z - marker.z) < 2.0) {
      tryInteract();
    }
  });

  // 触屏摇杆
  const jbase = $('joystick');
  const knob = $('joystick-knob');
  if (isTouch) jbase.classList.remove('hidden');
  let joyId = -1;
  const joySet = (e: PointerEvent) => {
    const r = jbase.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2 - 14);
    let dy = (e.clientY - cy) / (r.height / 2 - 14);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    joy.x = dx; joy.z = dy;
    knob.style.transform = `translate(calc(-50% + ${dx * 30}px), calc(-50% + ${dy * 30}px))`;
  };
  jbase.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId;
    joy.active = true;
    jbase.setPointerCapture(e.pointerId);
    joySet(e);
    audio.unlock();
  });
  jbase.addEventListener('pointermove', (e) => {
    if (joy.active && e.pointerId === joyId) joySet(e);
  });
  const joyEnd = () => {
    joy.active = false; joy.x = 0; joy.z = 0; joyId = -1;
    knob.style.transform = 'translate(-50%, -50%)';
  };
  jbase.addEventListener('pointerup', joyEnd);
  jbase.addEventListener('pointercancel', joyEnd);

  $('btn-interact-touch').addEventListener('click', () => {
    audio.unlock();
    tryInteract();
  });

  // 遭遇战触屏按钮：挡（按住）/ 挥 / 拿
  const guardBtn = $('btn-guard');
  guardBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.unlock();
    touchGuard = true;
    edge.guard = true;
  });
  const guardUp = () => { touchGuard = false; };
  guardBtn.addEventListener('pointerup', guardUp);
  guardBtn.addEventListener('pointercancel', guardUp);
  guardBtn.addEventListener('pointerleave', guardUp);
  $('btn-strike').addEventListener('pointerdown', (e) => { e.preventDefault(); edge.strike = true; });
  $('btn-grab').addEventListener('pointerdown', (e) => { e.preventDefault(); edge.interact = true; });
  $('btn-combat-retry').addEventListener('click', () => { audio.ui(); retryEncounter(); });

  $('dialog').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.choice-btn')) return;
    advanceDialog();
  });
}

function tryInteract(): void {
  if (paused() || !started || inCombat()) return;
  const node = currentNode(state);
  if (!node) return;
  if (node.encounter) return; // 遭遇战节点不靠 E 推进
  if (node.scene !== state.scene) return;
  const p = world.playerPos();
  const dist = Math.hypot(p.x - node.target[0], p.z - node.target[1]);
  if (!canInteract(dist)) {
    toast(`距离还远：走近 ${node.title} 的位置再操作。`);
    return;
  }
  const gate = canStart(state, node.id);
  if (!gate.ok) {
    toast(gate.reason);
    return;
  }
  openDialog(node);
}

// ---------------------------------------------------------------- 第三章 · 厨房遭遇战

/**
 * 当前节点若是"自动段落"或"遭遇战"，不再要求玩家走到目标按 E：
 *  - encounter：进入场景即开打（doc/08 的门被拉开那一刻）
 *  - auto：战斗结束后的善后叙述
 * 读档、场景切换、上一节点结算后都会调用一次。
 */
function maybeAutoNode(): void {
  if (!started || transitioning || session || combat) return;
  const node = currentNode(state);
  if (!node || node.scene !== state.scene) return;
  if (node.encounter) {
    startEncounter();
    return;
  }
  if (node.auto) openDialog(node);
}

function startEncounter(): void {
  if (combat) return;
  combat = createCombat();
  combatWinAt = 0;
  world.setEncounter(true);
  for (const pid of ['panel-inventory', 'panel-log', 'panel-settings']) $(pid).classList.add('hidden');
  $('combat-fail').classList.add('hidden');
  syncCombatHud();
  audio.rumble();
  audio.clang();
  toast('门被拉开了。退开——别让他贴上来。', 3400);
}

function retryEncounter(): void {
  $('combat-fail').classList.add('hidden');
  const retries = combat ? combat.retries + 1 : 0;
  combat = createCombat(retries);
  combatWinAt = 0;
  // 回到进门时的站位，重新来过（不写任何剧情事实）
  const spawn = SPAWNS.kitchen;
  world.setPlayerPos(spawn.x, spawn.z);
  world.setEncounter(true);
  syncCombatHud();
  audio.rumble();
}

/** 每帧：把输入喂给战斗内核，再把结果喂给画面与 HUD */
function stepEncounter(dt: number, move: { x: number; z: number }, running: boolean):
  { move: { x: number; z: number }; running: boolean } {
  if (!combat) return { move, running };
  const guardHeld = keys.has('Space') || mouseGuard || touchGuard;
  const locked = isLocked(combat);
  const sprinting = running && !locked && Math.hypot(move.x, move.z) > 0.01 && canSprint(combat);
  const events = stepCombat(combat, {
    dt,
    player: world.playerPos(),
    sprinting,
    guardHeld,
    guardPressed: edge.guard,
    strikePressed: edge.strike,
    interactPressed: edge.interact
  });
  edge.guard = edge.strike = edge.interact = false;
  handleCombatEvents(events);
  world.renderCombat(combat, dt);
  syncCombatHud();
  updateCombatGuide();
  if (locked) return { move: { x: 0, z: 0 }, running: false };
  // 举着东西挡的时候走不快；体力见底也跑不动
  const scale = guardHeld ? 0.55 : 1;
  return { move: { x: move.x * scale, z: move.z * scale }, running: sprinting };
}

function handleCombatEvents(events: CombatEvent[]): void {
  if (!combat) return;
  for (const e of events) {
    switch (e.type) {
      case 'burst-done': audio.thud(); break;
      case 'lunge': audio.breath(); break;
      case 'take-chair': audio.scrape(); toast('抓起椅子。挡一下，一边往备餐台退。', 2600); break;
      case 'take-knife': audio.scrape(); toast('刀在手里了。他扑上来时先挡，挡住了再挥。', 3000); break;
      case 'block': audio.clang(); break;
      case 'shove': audio.thud(); break;
      case 'chair-break': audio.rumble(); toast('椅子散了——备餐台上有把刀。', 2800); break;
      case 'grab': audio.thud(); audio.rumble(); break;
      case 'escape': audio.thud(); break;
      case 'clinch': audio.clang(); break;
      case 'win': {
        audio.thud();
        combatWinAt = performance.now();
        world.setMarker(null);
        $('interact-hint').classList.add('hidden');
        break;
      }
      case 'fail': {
        audio.rumble();
        $('combat-fail').classList.remove('hidden');
        break;
      }
    }
  }
  // 结束后停一拍，再进善后叙述（不给胜利提示音，也不结算"战绩"）
  if (combat.outcome === 'win' && combatWinAt > 0 && performance.now() - combatWinAt > 1900 && !session) {
    const node = currentNode(state);
    if (node && node.encounter) openDialog(node);
    combatWinAt = 0;
  }
}

/** 战斗中手边能拿的东西（顺序由 combat.ts 决定：椅子 → 椅子散架 → 刀） */
function combatPickup(c: CombatState): { x: number; z: number; label: string } | null {
  if (!c.chairTaken) return { x: ARENA.chairX, z: ARENA.chairZ, label: '拿起椅子' };
  if (!c.knifeTaken && !c.hasChair) return { x: ARENA.knifeX, z: ARENA.knifeZ, label: '抓起备餐台上的刀' };
  return null;
}

/** 慌起来很容易忘了东西在哪：地面引路箭头与 E 提示指向下一件能拿的东西 */
function updateCombatGuide(): void {
  const hint = $('interact-hint');
  const tbtn = $('btn-interact-touch');
  tbtn.classList.add('hidden'); // 触屏用战斗按钮组里的「拿」
  const pick = combat && combat.outcome === 'none' ? combatPickup(combat) : null;
  if (!pick) {
    world.setMarker(null);
    hint.classList.add('hidden');
    return;
  }
  world.setMarker(pick.x, pick.z);
  const p = world.playerPos();
  const near = Math.hypot(p.x - pick.x, p.z - pick.z) <= TUNING.pickupRange;
  $('interact-label').textContent = pick.label;
  hint.classList.toggle('hidden', !near || isTouch);
}

function syncCombatHud(): void {
  const hud = $('combat-hud');
  const touch = $('combat-touch');
  if (!combat || combat.outcome === 'fail') {
    hud.classList.add('hidden');
    touch.classList.add('hidden');
    return;
  }
  hud.classList.remove('hidden');
  touch.classList.toggle('hidden', !isTouch);
  $('combat-prompt').textContent = combat.prompt;
  const pct = Math.round((combat.stamina / TUNING.staminaMax) * 100);
  const fill = $('combat-fill') as HTMLDivElement;
  fill.style.width = `${pct}%`;
  fill.classList.toggle('low', pct < 30);
  $('combat-stam').textContent = `体力 ${pct}%`;
  $('combat-gear').textContent = combat.hasKnife ? '备餐台的刀（不是我的）'
    : combat.hasChair ? `椅子 · 还能挡 ${combat.chairHp} 下`
      : combat.chairTaken ? '空手' : '空手（旁边有椅子）';
  const mash = $('combat-mash');
  const grabbed = combat.enemy.state === 'grab';
  mash.classList.toggle('hidden', !grabbed);
  if (grabbed) {
    mash.textContent = `连按 空格 / 点「挣」 挣开　${combat.grabPresses} / ${TUNING.grabPresses}`;
  }
}

// ---------------------------------------------------------------- 帧循环

let lastT = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); // 时间步上限：恢复后不穿墙
  lastT = now;

  const pz = paused();
  let mx = 0, mz = 0;
  if (!pz && started) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    mx += joy.x;
    mz += joy.z;
  }
  const moving = Math.hypot(mx, mz) > 0.01;
  let running = keys.has('ShiftLeft') || keys.has('ShiftRight');

  // 遭遇战：内核先跑一步，再由它决定这一帧玩家还能不能动、能不能跑
  if (combat) {
    const r = stepEncounter(dt, { x: mx, z: mz }, running);
    mx = r.move.x;
    mz = r.move.z;
    running = r.running;
  } else {
    edge.guard = edge.strike = edge.interact = false;
  }

  let faceTo: number | null = null;
  if (mouseAim && performance.now() - mouseAim.t < 2200 && started && !pz) {
    const p = world.playerPos();
    if (Math.hypot(mouseAim.x - p.x, mouseAim.z - p.z) > 0.6) {
      faceTo = Math.atan2(mouseAim.x - p.x, mouseAim.z - p.z);
    }
  }

  world.step(dt, { x: mx, z: mz }, running, faceTo);

  if (moving && started && !isLockedNow()) {
    stepTimer -= dt * (running ? 1.6 : 1);
    if (stepTimer <= 0) {
      audio.step(running);
      stepTimer = 0.36;
    }
    dirty = true; // 位置变化，走节流写盘
  }

  if (!combat) {
    updateHints();
    updateOffscreenArrow();
    updateTaskGuide();
  } else {
    $('task-guide').classList.add('hidden');
    if (arrowEl) arrowEl.style.display = 'none';
  }

  if (dirty && now - lastSave > 2600) saveNow();
}

function isLockedNow(): boolean {
  return !!combat && isLocked(combat);
}

function updateHints(): void {
  const hint = $('interact-hint');
  const tbtn = $('btn-interact-touch');
  const node = started && !paused() ? currentNode(state) : null;
  if (!node || node.scene !== state.scene) {
    hint.classList.add('hidden');
    tbtn.classList.add('hidden');
    return;
  }
  const p = world.playerPos();
  const dist = Math.hypot(p.x - node.target[0], p.z - node.target[1]);
  if (canInteract(dist)) {
    $('interact-label').textContent = node.interactLabel;
    hint.classList.toggle('hidden', isTouch);
    tbtn.classList.toggle('hidden', !isTouch);
  } else {
    hint.classList.add('hidden');
    tbtn.classList.add('hidden');
  }
}

let arrowEl: HTMLDivElement | null = null;

function updateOffscreenArrow(): void {
  if (!arrowEl) {
    arrowEl = document.createElement('div');
    arrowEl.style.cssText = 'position:fixed;z-index:20;pointer-events:none;font-size:22px;color:var(--accent);text-shadow:0 1px 6px #000;display:none;';
    document.body.appendChild(arrowEl);
  }
  const marker = world.getMarker();
  if (!marker || paused() || !started) {
    arrowEl.style.display = 'none';
    return;
  }
  const { nx, ny } = world.project(marker.x, 1.6, marker.z);
  if (Math.abs(nx) < 0.92 && Math.abs(ny) < 0.92) {
    arrowEl.style.display = 'none';
    return;
  }
  const cx = Math.max(-0.9, Math.min(0.9, nx));
  const cy = Math.max(-0.86, Math.min(0.86, ny));
  const sx = (cx * 0.5 + 0.5) * window.innerWidth;
  const sy = (-cy * 0.5 + 0.5) * window.innerHeight;
  const ang = Math.atan2(ny, nx) * 180 / Math.PI;
  arrowEl.style.display = 'block';
  arrowEl.style.left = `${sx - 12}px`;
  arrowEl.style.top = `${sy - 12}px`;
  arrowEl.style.transform = `rotate(${ang}deg)`;
  arrowEl.textContent = '➤';
}

// ---------------------------------------------------------------- 事件绑定与启动

function bindUI(): void {
  $('btn-inventory').addEventListener('click', () => togglePanel('panel-inventory'));
  $('btn-log').addEventListener('click', () => togglePanel('panel-log'));
  $('btn-settings').addEventListener('click', () => togglePanel('panel-settings'));
  $('btn-mute').addEventListener('click', () => {
    audio.unlock();
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    refreshMuteIcon();
    saveNow();
  });
  $('btn-workshop').addEventListener('click', () => openWorkshop());
  for (const b of document.querySelectorAll<HTMLButtonElement>('.panel-close')) {
    b.addEventListener('click', () => {
      const id = b.dataset.close!;
      $(id).classList.add('hidden');
    });
  }
  $('dialog-next').addEventListener('click', (e) => {
    e.stopPropagation();
    advanceDialog();
  });
  $('btn-start').addEventListener('click', () => armNewGame());
  $('btn-continue').addEventListener('click', () => { audio.unlock(); startGame(false); });
  $('btn-jump-ch3').addEventListener('click', () => {
    audio.unlock();
    jumpToChapter3(new URLSearchParams(location.search).get('jump') === 'fight');
  });
  $('btn-webgl-retry').addEventListener('click', () => location.reload());
  $('taskcard').addEventListener('click', () => {
    if (window.innerWidth <= 720) $('taskcard').classList.toggle('compact');
  });
  window.addEventListener('beforeunload', () => { if (started) saveNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started) saveNow();
  });
}

function boot(): void {
  bootTitle();
  // ?jump=c3 / ?jump=fight：试玩直达（见 jumpToChapter3）
  const jump = new URLSearchParams(location.search).get('jump');
  initToolbar();
  initSettings();
  initEndScreen();
  bindUI();
  try {
    world = new GameWorld($('game'));
  } catch (err) {
    console.error('WebGL 初始化失败', err);
    $('webgl-error').classList.remove('hidden');
    return;
  }
  world.setLightMode(state.lightMode, autoLight(state));
  audio.setVolume(state.volume);
  audio.setMuted(state.muted);
  initInput();
  // 首次操作解锁音频（浏览器自动播放限制）
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });
  if (jump === 'c3' || jump === 'fight') jumpToChapter3(jump === 'fight');
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}

boot();
