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
  Hand, Cookie, Shirt, Droplets, Hammer, FileText, Camera, Barcode, Package, MapPin
} from 'lucide';
import {
  autoLight, canInteract, canStart, completeNode, createNewState, currentNode,
  itemsFor, INTERACT_RANGE, NODES, parseSave, SAVE_KEY, serialize,
  type ChoiceDef, type GameState, type LightMode, type NodeDef, type Page, type SceneId
} from './story';
import { SPAWNS, SCENE_CAPTIONS } from './mapdata';
import { GameWorld } from './world';
import { Workshop } from './workshop';

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
  'lead-liuanli': MapPin
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

  const marker = node && node.scene === state.scene ? node.target : null;
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
  if (r.toScene) {
    sceneTransition(r.toScene);
  }
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
    toast('章节已完成。日志与背包仍可查看；第二章尚未制作。');
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

  document.getElementById('game')!.addEventListener('pointerdown', (e) => {
    audio.unlock();
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

  $('dialog').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.choice-btn')) return;
    advanceDialog();
  });
}

function tryInteract(): void {
  if (paused() || !started) return;
  const node = currentNode(state);
  if (!node) return;
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
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight');

  let faceTo: number | null = null;
  if (mouseAim && performance.now() - mouseAim.t < 2200 && started && !pz) {
    const p = world.playerPos();
    if (Math.hypot(mouseAim.x - p.x, mouseAim.z - p.z) > 0.6) {
      faceTo = Math.atan2(mouseAim.x - p.x, mouseAim.z - p.z);
    }
  }

  world.step(dt, { x: mx, z: mz }, running, faceTo);

  if (moving && started) {
    stepTimer -= dt * (running ? 1.6 : 1);
    if (stepTimer <= 0) {
      audio.step(running);
      stepTimer = 0.36;
    }
    dirty = true; // 位置变化，走节流写盘
  }

  updateHints();
  updateOffscreenArrow();
  updateTaskGuide();

  if (dirty && now - lastSave > 2600) saveNow();
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
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}

boot();
