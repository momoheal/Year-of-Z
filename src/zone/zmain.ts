/**
 * zmain.ts —— 域外探索的入口：输入、HUD、面板、主循环、存档
 *
 * 规则全在 zkernel 里，这里只做三件事：把输入翻译成 ZoneInput、
 * 把 ZoneState 画出来、把事件播报出去。UI 上的每一个数字都直接来自内核，
 * 不做任何"看起来更好"的加工（支柱 5：文字层不撒谎）。
 */

import '../style.css';
import './zstyle.css';
import type * as THREE from 'three';
import {
  BAG_COLS, BAG_ROWS, BLOCKS, CONTAINERS, CONTRACTS, GAME_MIN_PER_SEC, GROUNDS, HOME, ITEMS,
  LAMPS, MAP, NOISE_LABEL, NOISE_RADIUS, ROUTES, SPOTS, dist
} from './zdata';
import {
  ZONE_SAVE_KEY, createZone, doSpotAction, drainEvents, finishRegister, hudSnapshot, interactTarget,
  loadZone, saveZone, spotActions, stepZone, useItem, type ZoneInput, type ZoneState
} from './zkernel';
import { ZoneScene } from './zscene';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- 全局

let st: ZoneState = createZone();
let scene: ZoneScene | null = null;
let running = false;
let panelOpen = '';
let paused = true;
let soundOn = true;

const keys = new Set<string>();
const joy = { active: false, x: 0, z: 0 };
const edge = { swing: false, shoot: false, throwCan: false, light: false, interactPress: false };
let mouse = { nx: 0, ny: 0 };
let interactHeld = false;
let dirty = false;
let saveTimer = 0;

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------------------------------------------------------------- 音频（合成，无外部资源）

let ac: AudioContext | null = null;
let masterGain: GainNode | null = null;
let volume = 0.6;

function unlockAudio(): void {
  if (ac) { if (ac.state === 'suspended') void ac.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  masterGain = ac.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(ac.destination);
}

function beep(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ac || !masterGain || !soundOn) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.value = 0;
  o.connect(g); g.connect(masterGain);
  const now = ac.currentTime;
  g.gain.linearRampToValueAtTime(gain, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.start(now); o.stop(now + dur + 0.02);
}

function noiseBurst(dur: number, freq: number, gain: number): void {
  if (!ac || !masterGain || !soundOn) return;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq;
  const g = ac.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start();
}

// ---------------------------------------------------------------- 小工具

function toast(msg: string, tone: 'warn' | 'bad' | 'good' | '' = ''): void {
  const el = $('toast');
  el.textContent = msg;
  el.className = tone;
  el.classList.remove('hidden');
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.add('hidden'), 2800);
}

function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }

// ---------------------------------------------------------------- 面板

function setPanel(id: string): void {
  for (const p of ['panel-bag', 'panel-log', 'panel-map', 'panel-spot', 'panel-menu']) {
    $(p).classList.toggle('hidden', p !== id);
  }
  panelOpen = id;
  if (id === 'panel-bag') renderBag();
  if (id === 'panel-log') renderLog();
  if (id === 'panel-map') drawMap();
}

function closePanels(): void { setPanel(''); }

// ---------------------------------------------------------------- 背包（占格底板）

function renderBag(): void {
  const grid = $('bag-grid');
  grid.innerHTML = '';
  const g: boolean[][] = Array.from({ length: BAG_ROWS }, () => new Array<boolean>(BAG_COLS).fill(false));
  for (const it of st.bag) {
    const d = ITEMS[it.id];
    const w = it.rot ? d.h : d.w;
    const h = it.rot ? d.w : d.h;
    for (let y = it.y; y < it.y + h; y++) for (let x = it.x; x < it.x + w; x++) if (g[y]) g[y][x] = true;
  }
  for (let y = 0; y < BAG_ROWS; y++) for (let x = 0; x < BAG_COLS; x++) {
    if (g[y][x]) continue;
    const c = document.createElement('div');
    c.className = 'bag-cell';
    c.style.gridColumn = `${x + 1} / span 1`;
    c.style.gridRow = `${y + 1} / span 1`;
    grid.appendChild(c);
  }
  for (const it of st.bag) {
    const d = ITEMS[it.id];
    const w = it.rot ? d.h : d.w;
    const h = it.rot ? d.w : d.h;
    const el = document.createElement('div');
    el.className = 'bag-item';
    el.style.gridColumn = `${it.x + 1} / span ${w}`;
    el.style.gridRow = `${it.y + 1} / span ${h}`;
    el.style.background = hex(d.color);
    el.title = `${d.name}（${w}×${h}）· ${d.desc}`;
    const studs = document.createElement('div');
    studs.className = 'bi-studs';
    for (let i = 0; i < w; i++) studs.appendChild(document.createElement('i'));
    el.appendChild(studs);
    if (it.n > 1) {
      const n = document.createElement('span');
      n.className = 'bi-n'; n.textContent = `×${it.n}`;
      el.appendChild(n);
    }
    const nm = document.createElement('span');
    nm.className = 'bi-name'; nm.textContent = d.name;
    el.appendChild(nm);
    el.onclick = () => {
      if (d.use) { useItem(st, it.id); renderBag(); refreshHud(); beep(520, 0.12, 0.12, 'triangle'); }
      else toast(`${d.name}：${d.desc}`);
    };
    grid.appendChild(el);
  }
  const used = st.bag.reduce((a, it) => {
    const d = ITEMS[it.id];
    return a + (it.rot ? d.h : d.w) * (it.rot ? d.w : d.h);
  }, 0);
  $('bag-note').textContent =
    `占 ${used} / ${BAG_COLS * BAG_ROWS} 格${used > 18 ? '（压手：慢一点，跑起来更费力气）' : ''}。装不下就丢，丢下的会留在原地。点一下使用，武器与证不能点。`;
}

// ---------------------------------------------------------------- 任务与路线

function renderLog(): void {
  const body = $('log-body');
  const parts: string[] = [];

  parts.push('<div class="log-sec"><h3>撤离路线（每晚重做一次）</h3>');
  for (const r of ROUTES) {
    parts.push(`<div class="route"><span class="route-id">${r.id}</span><div class="route-main">
      <div class="route-name">${r.name}</div>
      <div class="route-meta">条件：${r.cond} · 风险：${r.risk}</div></div>
      <span class="route-dist">≈${r.dist}</span></div>`);
  }
  parts.push('</div>');

  parts.push('<div class="log-sec"><h3>委托（乐高挂牌）</h3>');
  for (const c of CONTRACTS) {
    const cs = st.contracts.find((x) => x.id === c.id)!;
    const state = !cs.taken ? '还挂在板上' : cs.delivered ? '已交货' : '在任务轨上';
    parts.push(`<div class="contract-card">
      <span class="tag-plate" style="background:${hex(c.color)}"></span>
      <div><div class="route-name">${c.title}</div>
      <div class="route-meta">${state}${c.need ? ` · 要 ${c.need.n} 个${ITEMS[c.need.id].name}` : ''}</div></div></div>`);
  }
  parts.push('</div>');

  parts.push('<div class="log-sec"><h3>今夜记录</h3>');
  const lines = st.log.slice(-40).reverse();
  if (!lines.length) parts.push('<div class="log-line">—</div>');
  for (const l of lines) {
    parts.push(`<div class="log-line ${l.type}"><span class="lt">${l.t}</span><span class="lx">${l.text}</span></div>`);
  }
  parts.push('</div>');
  body.innerHTML = parts.join('');
}

// ---------------------------------------------------------------- 地图

function drawMap(): void {
  const cv = $('minimap') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  const sx = W / (MAP.maxX - MAP.minX);
  const sz = H / (MAP.maxZ - MAP.minZ);
  const px = (x: number) => (x - MAP.minX) * sx;
  const pz = (z: number) => (z - MAP.minZ) * sz;

  g.fillStyle = '#171c1b'; g.fillRect(0, 0, W, H);
  // 地面分区
  g.fillStyle = '#252b2a';
  for (const gr of GROUNDS) g.fillRect(px(gr.x - gr.w / 2), pz(gr.z - gr.d / 2), gr.w * sx, gr.d * sz);
  // 建筑与墙
  g.fillStyle = '#4c5450';
  for (const b of BLOCKS) g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * sx, b.d * sz);
  // 灯
  g.fillStyle = 'rgba(255, 214, 150, 0.22)';
  for (const l of LAMPS) {
    g.beginPath(); g.arc(px(l.x), pz(l.z), l.r * sx, 0, Math.PI * 2); g.fill();
  }
  // 家
  g.strokeStyle = '#93b48c'; g.lineWidth = 2;
  g.beginPath(); g.arc(px(HOME.x), pz(HOME.z), HOME.r * sx, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#93b48c'; g.font = '12px sans-serif';
  g.fillText('家', px(HOME.x) + 6, pz(HOME.z) - 6);
  // 路线
  const colors = ['#d9a05b', '#6f93b8', '#93b48c'];
  ROUTES.forEach((r, i) => {
    g.strokeStyle = colors[i % 3]; g.lineWidth = 1.6; g.setLineDash([5, 4]);
    g.beginPath();
    r.waypoints.forEach((w, k) => { const X = px(w[0]), Z = pz(w[1]); k ? g.lineTo(X, Z) : g.moveTo(X, Z); });
    g.stroke(); g.setLineDash([]);
    const last = r.waypoints[0];
    g.fillStyle = colors[i % 3];
    g.fillText(r.id, px(last[0]) + 4, pz(last[1]) - 4);
  });
  // 掉下的包
  for (const d of st.bagDrop) {
    g.fillStyle = '#c97363';
    g.fillRect(px(d.x) - 4, pz(d.z) - 4, 8, 8);
    g.fillStyle = '#e9a99c'; g.font = '11px sans-serif';
    g.fillText('包', px(d.x) + 6, pz(d.z) + 4);
  }
  // 玩家
  g.fillStyle = '#f3f1ea';
  g.beginPath(); g.arc(px(st.player.x), pz(st.player.z), 3.4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f3f1ea'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(px(st.player.x), pz(st.player.z));
  g.lineTo(px(st.player.x) + Math.sin(st.player.face) * 12, pz(st.player.z) + Math.cos(st.player.face) * 12);
  g.stroke();

  $('map-legend').innerHTML = [
    '<span style="color:#93b48c">家 / 撤离点</span>',
    '<span style="color:#d9a05b">路线 A 大路·哨卡</span>',
    '<span style="color:#6f93b8">路线 B 地道·南缘</span>',
    '<span style="color:#93b48c">路线 C 后墙缺口</span>',
    '<span style="color:#c97363">掉下的包</span>',
    '<span style="color:rgba(255,214,150,.8)">灯下安全岛</span>'
  ].join('');
}

// ---------------------------------------------------------------- 地点动作

function openSpot(id: string): void {
  const spot = SPOTS.find((s) => s.id === id);
  if (!spot) return;
  const acts = spotActions(st, id);
  $('spot-title').textContent = spot.label;
  const body = $('spot-body');
  body.innerHTML = '';
  if (!acts.length) {
    body.innerHTML = '<p class="panel-note">这里没有能做的事。</p>';
  }
  for (const a of acts) {
    const b = document.createElement('button');
    b.className = 'spot-act';
    b.innerHTML = `${a.label}${a.hint ? `<small>${a.hint}</small>` : ''}${a.disabled ? `<small>${a.disabled}</small>` : ''}`;
    b.disabled = !!a.disabled;
    b.onclick = () => {
      doSpotAction(st, spot.id, a.id);
      beep(620, 0.1, 0.1, 'triangle');
      openSpot(spot.id);
      refreshHud();
      dirty = true;
    };
    body.appendChild(b);
  }
  setPanel('panel-spot');
}

// ---------------------------------------------------------------- HUD

function refreshHud(): void {
  const h = hudSnapshot(st);
  $('clock').textContent = h.clock;
  const realLeft = Math.max(0, h.toDawn / GAME_MIN_PER_SEC); // 距天亮：按压缩比换成现实秒
  const mm = Math.floor(realLeft / 60), ss = Math.floor(realLeft % 60);
  $('dawn-in').textContent = h.toDawn > 0 ? `距天亮 ${mm}:${String(ss).padStart(2, '0')}` : '天亮了';
  const tag = $('phase-tag');
  tag.textContent = st.gameMin >= 120 ? (h.phase === 'dawn' ? '天亮' : '宵禁') : '夜里';
  tag.classList.toggle('dawn', h.phase === 'dawn');

  $('v-hp').style.width = `${h.hp}%`; $('v-hp-n').textContent = String(h.hp);
  $('v-san').style.width = `${h.san}%`; $('v-san-n').textContent = String(h.san);
  $('v-sta').style.width = `${h.stamina}%`; $('v-sta-n').textContent = String(h.stamina);
  $('v-bat').style.width = `${Math.round(h.battery * 100)}%`; $('v-bat-n').textContent = String(Math.round(h.battery * 100));

  const wounds: string[] = [];
  if (h.bleed > 0) wounds.push(`<span class="wound">失血 ×${h.bleed}</span>`);
  if (h.infection !== null) wounds.push(`<span class="wound infect">感染 ${Math.max(0, Math.ceil(h.infection))}s</span>`);
  $('wounds').innerHTML = wounds.join('');

  const wpn = ITEMS[h.weapon];
  $('gear').innerHTML = h.weapon
    ? `<b>${wpn.name}</b> 耐久 ${h.weaponDur}` + (h.gun ? `<br/><span class="gun">手枪 ${h.ammo} 发（右键）</span>` : '')
    : `空手` + (h.gun ? `<br/><span class="gun">手枪 ${h.ammo} 发（右键）</span>` : '');

  // 任务轨
  const rail = $('taskrail');
  rail.innerHTML = '';
  for (const c of h.contracts) {
    const el = document.createElement('div');
    el.className = `tag ${c.done ? 'done' : c.ready ? 'ready' : ''}`;
    const studs = document.createElement('div');
    studs.className = 'tag-stud';
    for (let i = 0; i < c.studs; i++) {
      const s = document.createElement('i');
      s.style.background = hex(c.color);
      studs.appendChild(s);
    }
    const plate = document.createElement('span');
    plate.className = 'tag-plate';
    plate.style.background = hex(c.color);
    const text = document.createElement('span');
    text.className = 'tag-text';
    text.textContent = c.done ? `${c.title} · 已交` : c.title + (c.ready ? ' · 可以交了' : '');
    el.append(plate, studs, text);
    rail.appendChild(el);
  }

  // 快捷消耗品
  const qb = $('quickbar');
  const quick: [string, string][] = [['bandage', '1'], ['antibiotics', '2'], ['battery', '3'], ['food', '4']];
  qb.innerHTML = '';
  for (const [id, key] of quick) {
    const d = ITEMS[id];
    let n = 0;
    for (const it of st.bag) if (it.id === id) n += it.n;
    const el = document.createElement('div');
    el.className = `qslot ${n ? '' : 'empty'}`;
    el.innerHTML = `<div class="q-brick" style="background:${hex(d.color)}"></div>
      <div class="q-n">${n}</div><div class="q-name">${d.name}</div><div class="q-key">${key}</div>`;
    el.onclick = () => { useItem(st, id); refreshHud(); if (panelOpen === 'panel-bag') renderBag(); };
    qb.appendChild(el);
  }

  // 回家指引
  const dHome = dist(st.player.x, st.player.z, HOME.x, HOME.z);
  $('home-dist').textContent = `家 ${Math.round(dHome)} 米`;
  const ang = Math.atan2(HOME.x - st.player.x, HOME.z - st.player.z);
  ($('home-arrow') as HTMLElement).style.transform = `rotate(${-ang + Math.PI / 2}rad)`;

  if (panelOpen === 'panel-map') drawMap();
}

// ---------------------------------------------------------------- 结算

function showEnd(): void {
  const r = st.result;
  if (!r) return;
  $('title-screen').classList.add('hidden');
  $('end-screen').classList.remove('hidden');
  $('end-register').classList.add('hidden');
  $('end-actions').classList.remove('hidden');

  const ok = r.home && !r.recorded;
  $('end-tag').textContent = r.home ? '到家 · 这一夜的档案' : '没能回家 · 这一夜的档案';
  $('end-title').textContent = ok ? '你还能住在这个小区'
    : r.home ? '当日核酸作废' : '天亮了，你没在门廊灯底下';
  $('end-quote').innerHTML = ok
    ? '“你把包放在门后，<br/>门廊灯在身后亮着。<br/>八点前，你会站在队伍里。”'
    : r.home ? '“到家了。<br/>但记录上那一笔，不会因为你到家就消失。”'
      : '“天亮之后，城市属于视线。<br/>你属于哪一行，由别人写。”';

  const loot = r.loot.length
    ? r.loot.map((l) => `<span class="loot-chip">${l.name} ×${l.n}</span>`).join('')
    : '<span class="loot-chip">空手</span>';
  const contracts = r.contracts.map((c) =>
    `<div class="row"><span class="k">委托</span><span class="${c.done ? 'good' : ''}">${c.title}：${c.done ? '交了' : '没交'}</span></div>`).join('');
  const refusals = r.refusals.length
    ? r.refusals.map((x) => `<div class="row"><span class="k">拒绝</span><span class="bad">${x}</span></div>`).join('')
    : '<div class="row"><span class="k">拒绝</span><span>这一夜没有走捷径。</span></div>';

  $('end-body').innerHTML = `<div class="arch">
    <h4>时 刻</h4>
    <div class="row"><span class="k">收摊</span><span>${r.clock}</span></div>
    <div class="row"><span class="k">心神</span><span>${r.san}</span></div>
    <div class="row"><span class="k">血</span><span>${r.hp}</span></div>
    <h4>带回</h4><div>${loot}</div>
    <h4>委托</h4>${contracts || '<div class="row"><span class="k">—</span><span>一块牌都没摘。</span></div>'}
    <h4>诚实兑现（拒绝式选项）</h4>${refusals}
  </div>`;

  if (r.register === null) {
    $('end-register').classList.remove('hidden');
    $('end-actions').classList.add('hidden');
  } else {
    $('end-body').innerHTML += `<div class="arch"><h4>登记</h4>
      <div class="row"><span class="k">写法</span><span class="${r.register === 'honest' ? 'good' : 'bad'}">${
      r.register === 'honest' ? '照实写。纸上的和发生过的一样。' : '照四十填。省事的那一种。'
    }</span></div>
      <div class="row"><span class="k">核酸</span><span class="${r.recorded ? 'bad' : 'good'}">${
      r.recorded ? '当日作废，放逐计数 +1' : '正常。你还在名单上。'
    }</span></div></div>`;
  }
}

// ---------------------------------------------------------------- 事件消费

function consume(): void {
  for (const e of drainEvents(st)) {
    switch (e.k) {
      case 'toast': toast(e.text, e.tone ?? ''); break;
      case 'noise':
        if (e.level >= 3) { flashNoise(e.level); noiseBurst(0.28, 300 - e.level * 30, 0.1 + e.level * 0.03); }
        break;
      case 'swing': if (e.hit) { scene?.triggerSwing(); noiseBurst(0.12, 420, 0.12); } else scene?.triggerSwing(); break;
      case 'shot': flashNoise(5); noiseBurst(0.5, 160, 0.4); beep(150, 0.3, 0.3, 'square'); break;
      case 'loot':
      case 'pickup': beep(660, 0.09, 0.1, 'triangle'); toast(`拿到 ${e.name}`); break;
      case 'bagfull': toast(`塞不下了：${e.name}留在原地`, 'warn'); break;
      case 'door': beep(320, 0.16, 0.16, 'sawtooth'); break;
      case 'bite': beep(120, 0.22, 0.28, 'sawtooth'); if (e.deep) flashNoise(4); break;
      case 'warn': beep(880, 0.14, 0.18, 'square'); break;
      case 'ko':
      case 'wake': beep(90, 0.5, 0.3, 'sine'); break;
      case 'dawn': toast('05:30。天亮了。', 'warn'); beep(300, 0.8, 0.14, 'sine'); break;
      case 'home': beep(520, 0.3, 0.18, 'triangle'); break;
      case 'contract': toast('摘下一块挂牌。', 'good'); break;
      case 'deliver': toast(`交货：${e.title}`, 'good'); break;
      case 'result': showEnd(); break;
      case 'trade': toast(e.text, 'good'); break;
      case 'read': toast(e.text); break;
      case 'use': beep(560, 0.12, 0.12, 'sine'); break;
      default: break;
    }
    dirty = true;
  }
}

let flashT = 0;
function flashNoise(level: number): void {
  const el = $('noiseflash');
  el.classList.remove('hidden');
  el.style.boxShadow = `inset 0 0 ${60 + level * 20}px 8px rgba(201, 115, 99, ${0.25 + level * 0.06})`;
  flashT = 0.35;
  const last = document.createElement('div');
  last.textContent = `${NOISE_LABEL[level]} · ${Math.round(NOISE_RADIUS[level] * 40)}px`;
  last.style.cssText = 'position:absolute;left:50%;top:60%;transform:translateX(-50%);font-size:12px;color:#e9a99c;opacity:.9';
  el.appendChild(last);
  window.setTimeout(() => last.remove(), 700);
}

// ---------------------------------------------------------------- 输入

function buildInput(): ZoneInput {
  let mx = joy.active ? joy.x : 0;
  let mz = joy.active ? joy.z : 0;
  if (!joy.active) {
    if (keys.has('w') || keys.has('arrowup')) mz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) mz += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
  }
  const stance = keys.has('shift') ? 'run' : keys.has('control') ? 'sneak' : 'walk';
  const aim = scene ? scene.screenToWorld(mouse.nx, mouse.ny) : { x: st.player.x, z: st.player.z + 1 };
  return {
    mx, mz, stance,
    aimX: aim.x, aimZ: aim.z,
    interact: interactHeld,
    swing: edge.swing, shoot: edge.shoot, throwCan: edge.throwCan, toggleLight: edge.light
  };
}

function clearEdges(): void {
  edge.swing = false; edge.shoot = false; edge.throwCan = false; edge.light = false; edge.interactPress = false;
}

function initInput(): void {
  window.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    unlockAudio();
    if (k === 'escape') { if (panelOpen) closePanels(); else setPanel('panel-menu'); return; }
    if (!keys.has(k)) {
      if (k === 'q') edge.throwCan = true;
      if (k === 'f') edge.light = true;
      if (k === 'e') { edge.interactPress = true; onInteractPress(); }
      if (k === 'b') { panelOpen === 'panel-bag' ? closePanels() : setPanel('panel-bag'); }
      if (k === 'l') { panelOpen === 'panel-log' ? closePanels() : setPanel('panel-log'); }
      if (k === 'm') { panelOpen === 'panel-map' ? closePanels() : setPanel('panel-map'); }
      if (k === '1') { useItem(st, 'bandage'); refreshHud(); }
      if (k === '2') { useItem(st, 'antibiotics'); refreshHud(); }
      if (k === '3') { useItem(st, 'battery'); refreshHud(); }
      if (k === '4') { useItem(st, 'food'); refreshHud(); }
    }
    if (k === 'e') interactHeld = true;
    keys.add(k);
    if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) ev.preventDefault();
  });
  window.addEventListener('keyup', (ev) => {
    const k = ev.key.toLowerCase();
    keys.delete(k);
    if (k === 'e') interactHeld = false;
  });
  window.addEventListener('blur', () => { keys.clear(); interactHeld = false; });

  const game = $('game');
  game.addEventListener('mousemove', (ev) => {
    mouse.nx = (ev.clientX / window.innerWidth) * 2 - 1;
    mouse.ny = -(ev.clientY / window.innerHeight) * 2 + 1;
  });
  game.addEventListener('mousedown', (ev) => {
    unlockAudio();
    if (ev.button === 0) edge.swing = true;
    if (ev.button === 2) edge.shoot = true;
  });
  game.addEventListener('contextmenu', (ev) => ev.preventDefault());
  game.addEventListener('wheel', (ev) => {
    if (!scene) return;
    scene.setZoom(scene.getZoom() * (ev.deltaY > 0 ? 0.92 : 1.08));
  }, { passive: true });

  for (const b of document.querySelectorAll('[data-close]')) {
    (b as HTMLElement).onclick = () => closePanels();
  }
  $('btn-bag').onclick = () => panelOpen === 'panel-bag' ? closePanels() : setPanel('panel-bag');
  $('btn-log').onclick = () => panelOpen === 'panel-log' ? closePanels() : setPanel('panel-log');
  $('btn-map').onclick = () => panelOpen === 'panel-map' ? closePanels() : setPanel('panel-map');
  $('btn-menu').onclick = () => panelOpen === 'panel-menu' ? closePanels() : setPanel('panel-menu');
  $('btn-sound').onclick = () => {
    soundOn = !soundOn;
    $('btn-sound').textContent = soundOn ? '音' : '静';
    $('btn-sound').style.color = soundOn ? '' : 'var(--ink-dim)';
  };
  ($('z-zoom') as HTMLInputElement).oninput = (ev) => {
    scene?.setZoom(Number((ev.target as HTMLInputElement).value) / 100);
  };
  ($('z-vol') as HTMLInputElement).oninput = (ev) => {
    volume = Number((ev.target as HTMLInputElement).value) / 100;
    if (masterGain) masterGain.gain.value = volume;
  };
  $('btn-restart').onclick = () => { localStorage.removeItem(ZONE_SAVE_KEY); startNight(true); };
  $('btn-webgl-retry').onclick = () => location.reload();

  // 触屏
  if (isTouch) {
    $('touch').classList.remove('hidden');
    initJoystick();
    const hold = (id: string, on: () => void, off?: () => void) => {
      const el = $(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); unlockAudio(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off?.(); }, { passive: false });
    };
    hold('t-swing', () => { edge.swing = true; });
    hold('t-e', () => { interactHeld = true; onInteractPress(); }, () => { interactHeld = false; });
    hold('t-throw', () => { edge.throwCan = true; });
    hold('t-light', () => { edge.light = true; });
  }
}

function initJoystick(): void {
  const base = $('joystick');
  const knob = $('joystick-knob');
  let id: number | null = null;
  const R = 46;
  const set = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    joy.x = dx / R; joy.z = dy / R;
    if (Math.hypot(joy.x, joy.z) > 1) { const n = Math.hypot(joy.x, joy.z); joy.x /= n; joy.z /= n; }
  };
  base.addEventListener('touchstart', (e) => {
    e.preventDefault(); unlockAudio();
    const t = e.changedTouches[0];
    id = t.identifier;
    joy.active = true;
    const r = base.getBoundingClientRect();
    set(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
  }, { passive: false });
  base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const r = base.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== id) continue;
      set(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }
  }, { passive: false });
  const end = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== id) continue;
      id = null; joy.active = false; joy.x = 0; joy.z = 0;
      knob.style.transform = 'translate(0,0)';
    }
  };
  base.addEventListener('touchend', end);
  base.addEventListener('touchcancel', end);
}

/** E 按下的那一瞬间：地点打开面板；地上的东西/包直接捡 */
function onInteractPress(): void {
  if (paused || !running) return;
  const t = interactTarget(st);
  if (t?.kind === 'spot') {
    if (t.id === 's-home') { /* 回家靠走进圈里，不靠按 E */ return; }
    openSpot(t.id);
  }
}

// ---------------------------------------------------------------- 主循环

let last = 0;
let hudTick = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0));
  last = now;

  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) $('noiseflash').classList.add('hidden');
  }

  // 面板打开时世界停住——两根钟也停，这是明确的、不会骗人的规则
  const held = paused || panelOpen !== '';
  if (running && !held && st.result === null) {
    stepZone(st, dt, buildInput());
    clearEdges();
    consume();
    saveTimer += dt;
    if (dirty && saveTimer > 2.5) {
      saveTimer = 0; dirty = false;
      localStorage.setItem(ZONE_SAVE_KEY, saveZone(st));
    }
    if (st.result) { localStorage.removeItem(ZONE_SAVE_KEY); }
  } else {
    clearEdges();
    consume();
  }

  if (scene) {
    scene.ensureDynamicContainers();
    scene.sync(st, held ? 0.0001 : dt);
    updateInteract();
    hudTick += dt;
    if (hudTick > 0.12) { hudTick = 0; refreshHud(); }
  }
  if (st.result && $('end-screen').classList.contains('hidden')) showEnd();
}

function updateInteract(): void {
  if (!running || paused || st.result) { $('interact').classList.add('hidden'); return; }
  const t = interactTarget(st);
  if (!t) { $('interact').classList.add('hidden'); return; }
  const el = $('interact');
  el.classList.remove('hidden');
  $('i-label').textContent = t.label;
  $('i-hint').textContent = t.hint;
  let pct = 0;
  if (t.kind === 'container') {
    const def = CONTAINERS.find((c) => c.id === t.id);
    if (def) pct = t.progress / def.time;
  }
  if (t.kind === 'door') pct = t.progress / 2.7;
  $('i-fill').style.width = `${Math.min(100, pct * 100)}%`;
}

// ---------------------------------------------------------------- 启动

function startNight(fresh: boolean): void {
  if (fresh) {
    st = createZone(20261004 + Math.floor(Math.random() * 100000), 1);
  }
  $('title-screen').classList.add('hidden');
  $('end-screen').classList.add('hidden');
  closePanels();
  running = true;
  paused = false;
  dirty = true;
  refreshHud();
  toast('20:00。门在身后带上，门廊灯还亮着。');
}

function boot(): void {
  try {
    // __ZONE_TEST_RENDERER__ 是无头冒烟测试的注入口：交付环境没有 Chromium，
    // 用它把"不画东西的 renderer"塞进来，好把建景与 UI 接线真跑一遍。
    const override = (window as unknown as { __ZONE_TEST_RENDERER__?: THREE.WebGLRenderer }).__ZONE_TEST_RENDERER__;
    scene = new ZoneScene($('game'), override);
  } catch {
    $('webgl-error').classList.remove('hidden');
    return;
  }
  scene.build(st);
  initInput();
  window.addEventListener('resize', () => scene?.resize());

  const saved = localStorage.getItem(ZONE_SAVE_KEY);
  if (saved) {
    $('btn-continue').classList.remove('hidden');
    $('btn-continue').onclick = () => {
      const loaded = loadZone(saved);
      if (loaded) {
        st = loaded; // 静态建景与地图无关，不重建
        startNight(false);
      } else {
        localStorage.removeItem(ZONE_SAVE_KEY);
        startNight(true);
      }
    };
  }
  $('btn-start').onclick = () => { unlockAudio(); startNight(true); };
  $('btn-end-log').onclick = () => { setPanel('panel-log'); renderLog(); };
  $('btn-end-again').onclick = () => startNight(true);
  $('btn-end-back').onclick = () => { window.location.href = './index.html'; };
  $('btn-reg-honest').onclick = () => { finishRegister(st, true); consume(); toast('照实写了。', 'good'); };
  $('btn-reg-fake').onclick = () => { finishRegister(st, false); consume(); toast('照四十填。省事的那一种。', 'warn'); };

  refreshHud();

  // 调试 / 无头冒烟用的把手：与正传 window.__yoz 同一套约定，只在 ?e2e=1 时挂载
  if (new URLSearchParams(location.search).get('e2e') === '1') {
    (window as unknown as { __zone: unknown }).__zone = {
      state: () => st,
      scene: () => scene,
      start: (fresh = true) => startNight(fresh)
    };
  }

  requestAnimationFrame((t) => { last = t; frame(t); });
}

boot();
