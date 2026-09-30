import { describe, expect, it } from 'vitest';
import { HOTSPOTS, SCENE_BOUNDS, SPAWNS } from '../src/mapdata';
import {
  canInteract,
  ITEMS,
  canStart,
  completeNode,
  createNewState,
  currentNode,
  hasFlag,
  hasItem,
  itemsFor,
  INTERACT_RANGE,
  NODES,
  parseSave,
  SAVE_VERSION,
  serialize,
  type GameState
} from '../src/story';

/** 用合法顺序推进到某节点之前 */
function playUntil(nodeId: string, choices: Record<string, string> = {}): GameState {
  const s = createNewState();
  for (const n of NODES) {
    if (n.id === nodeId) break;
    const r = completeNode(s, n.id, choices[n.id] ?? n.choices?.[0]?.id);
    if (!r.ok) throw new Error(`推进失败于 ${n.id}: ${(r as { reason?: string }).reason}`);
  }
  return s;
}

/** 走完整个第一章 */
function playAll(choices: Record<string, string> = {}): GameState {
  const s = createNewState();
  for (const n of NODES) {
    const r = completeNode(s, n.id, choices[n.id] ?? n.choices?.[0]?.id);
    if (!r.ok) throw new Error(`推进失败于 ${n.id}: ${(r as { reason?: string }).reason}`);
  }
  return s;
}

describe('非暴力路线', () => {
  it('全章可完成，全程不存在枪械与击杀，网门节点没有攻击选项', () => {
    const s = playAll();
    expect(s.finished).toBe(true);
    expect(s.completed).toHaveLength(NODES.length);
    // 物品中不存在任何武器
    for (const item of itemsFor(s)) {
      expect(item.name).not.toMatch(/枪|子弹|武器/);
      expect(item.id).not.toMatch(/gun|weapon|ammo/);
    }
    // 节点数据中没有攻击/处决类选择
    for (const n of NODES) {
      for (const c of n.choices ?? []) {
        expect(c.label + c.id).not.toMatch(/攻击|处决|击杀|开枪/);
      }
    }
    // 网门节点：无选择项，只能观察记录
    const mesh = NODES.find((n) => n.id === 'C01-07')!;
    expect(mesh.choices ?? []).toHaveLength(0);
    expect(hasFlag(s, 'mesh-reported')).toBe(true);
  });
});

describe('借用撬棍守恒', () => {
  it('C01-00 领取、C01-09 归还，账实一致且不成为装备', () => {
    const s = playAll();
    // 流水：领取恰一次、归还恰一次
    const adds = s.itemJournal.flatMap((d) => d.add).filter((id) => id === 'crowbar');
    const removes = s.itemJournal.flatMap((d) => d.remove).filter((id) => id === 'crowbar');
    expect(adds).toHaveLength(1);
    expect(removes).toHaveLength(1);
    expect(hasItem(s, 'crowbar')).toBe(false);
    // 借还事实入日志
    expect(s.log.some((l) => l.text.includes('借用撬棍') && l.text.includes('登记'))).toBe(true);
    expect(s.log.some((l) => l.text.includes('归还勾销'))).toBe(true);
  });
});

describe('存档闸门（任务不可乱序）', () => {
  it('不能跳过当前节点启动后续节点，也不能重复完成', () => {
    const s = createNewState();
    // 直接启动 C01-01 被拒绝
    const skip = canStart(s, 'C01-01');
    expect(skip.ok).toBe(false);
    if (!skip.ok) expect(skip.reason).toContain('C01-00');
    const r = completeNode(s, 'C01-03', 'self');
    expect(r.ok).toBe(false);
    // 状态未变
    expect(s.completed).toHaveLength(0);
    expect(s.log).toHaveLength(0);
    // 正常完成 C01-00 后，重复完成同样被拒
    expect(completeNode(s, 'C01-00').ok).toBe(true);
    expect(completeNode(s, 'C01-00').ok).toBe(false);
    expect(currentNode(s)?.id).toBe('C01-01');
  });
});

describe('交互距离', () => {
  it('超出距离不可交互，覆盖边界值', () => {
    expect(canInteract(0)).toBe(true);
    expect(canInteract(INTERACT_RANGE)).toBe(true);
    expect(canInteract(INTERACT_RANGE + 0.01)).toBe(false);
    expect(canInteract(999)).toBe(false);
  });
});

describe('分支事实', () => {
  it('给水：个人水被消耗，日志记录；医疗结果不变', () => {
    const s = playAll({ 'C01-05': 'give-water', 'C01-03': 'self', 'C01-08': 'report-pending' });
    expect(hasItem(s, 'personal-water')).toBe(false);
    expect(hasFlag(s, 'choice:C01-05=give-water')).toBe(true);
    expect(s.log.some((l) => l.type === 'choice' && l.text.includes('个人水留给'))).toBe(true);
    expect(hasFlag(s, 'medical-called')).toBe(true);
  });

  it('先报位置：个人水保留，医疗结果同样不变', () => {
    const s = playAll({ 'C01-05': 'report-first', 'C01-03': 'help', 'C01-08': 'report-pending' });
    expect(hasItem(s, 'personal-water')).toBe(true);
    expect(hasFlag(s, 'choice:C01-05=report-first')).toBe(true);
    expect(hasFlag(s, 'medical-called')).toBe(true);
  });

  it('撬门两变体分别记录噪声与协作，门都会打开', () => {
    const a = playAll({ 'C01-03': 'self' });
    expect(a.choices['C01-03']).toBe('self');
    expect(hasFlag(a, 'door-open')).toBe(true);
    expect(a.log.some((l) => l.text.includes('滑脱'))).toBe(true);
    const b = playAll({ 'C01-03': 'help' });
    expect(b.choices['C01-03']).toBe('help');
    expect(hasFlag(b, 'door-open')).toBe(true);
    expect(b.log.some((l) => l.text.includes('垫木协作'))).toBe(true);
  });

  it('回收单不能勾选“无人”：被拒绝、状态不变，改选后完成', () => {
    const s = playUntil('C01-08');
    const bad = completeNode(s, 'C01-08', 'report-none');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.rejected).toBe(true);
      expect(bad.pages && bad.pages.length).toBeGreaterThan(0);
    }
    expect(s.completed).not.toContain('C01-08');
    expect(s.flags).not.toContain('dog-shed');
    const good = completeNode(s, 'C01-08', 'report-pending');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.toScene).toBe('depot');
  });

  it('灰灰投喂为必经且只保留一份状态，饼被消耗一次', () => {
    const s = playAll();
    expect(hasFlag(s, 'dog-follow')).toBe(true);
    // 已完成节点不可重复触发（不能第二次消耗饼）
    expect(completeNode(s, 'C01-01').ok).toBe(false);
    expect(hasItem(s, 'biscuit')).toBe(false);
    const biscuitDeltas = s.itemJournal.flatMap((d) => d.remove).filter((id) => id === 'biscuit');
    expect(biscuitDeltas).toHaveLength(1);
  });
});

describe('存档持久化与恢复', () => {
  it('往返序列化保持进度、选择、物品与日志', () => {
    const s = playUntil('C01-05', { 'C01-03': 'self' });
    completeNode(s, 'C01-05', 'give-water');
    const restored = parseSave(serialize(s));
    expect(restored.recovered).toBe(false);
    expect(restored.state.completed).toEqual(s.completed);
    expect(restored.state.choices['C01-05']).toBe('give-water');
    expect(hasItem(restored.state, 'personal-water')).toBe(false);
    expect(restored.state.log).toHaveLength(s.log.length);
  });

  it('v1 存档迁移到 v2：字段补齐，第一章已完成的进度原样保留，可继续进入第二章（YZ-05）', () => {
    const ch1Ids = NODES.filter((n) => n.id.startsWith('C01-')).map((n) => n.id);
    const legacyV1 = JSON.stringify({
      version: 1,
      completed: ch1Ids,
      choices: { 'C01-03': 'self' },
      log: [{ type: 'fact', text: '旧档占位事实', node: ch1Ids[ch1Ids.length - 1] }],
      flags: ['chapter-done'],
      itemJournal: [{ node: 'init', add: ['gloves', 'biscuit', 'vest'], remove: [] }],
      player: { x: -12, z: 37 },
      scene: 'park',
      finished: false
    });
    const restored = parseSave(legacyV1);
    // 迁移成功等同于正常读档，不应提示"已恢复为新局"
    expect(restored.recovered).toBe(false);
    expect(restored.state.version).toBe(SAVE_VERSION);
    expect(restored.state.completed).toEqual(ch1Ids);
    expect(restored.state.choices['C01-03']).toBe('self');
    expect(restored.state.flags).toContain('chapter-done');
    // 第二章数据接入后，旧档紧接着第一章末尾，从 C02-00 起可玩
    expect(currentNode(restored.state)?.id).toBe('C02-00');
  });

  it('损坏 / 旧版 / 非法进度存档均恢复为新局而非白屏', () => {
    expect(parseSave('not-json{{{').recovered).toBe(true);
    expect(parseSave('{"version":99}').recovered).toBe(true);
    expect(parseSave('null').state.completed).toHaveLength(0);
    // 跳序进度不被信任
    const skip = JSON.stringify({ version: 1, completed: ['C01-00', 'C01-02'], itemJournal: [], log: [], flags: [], choices: {}, player: { x: 0, z: 0 }, scene: 'park' });
    const bad = parseSave(skip);
    expect(bad.recovered).toBe(true);
    expect(bad.state.completed).toHaveLength(0);
    // 空存档视为新局，不算损坏
    expect(parseSave(null).recovered).toBe(false);
  });
});

describe('第三章 · 今天不煮了（遭遇战章）', () => {
  it('铺垫压到最短：厨房遭遇战前只有三个节点，且战斗节点进场即打', () => {
    const ch3 = NODES.filter((n) => n.id.startsWith('C03-'));
    expect(ch3).toHaveLength(6);
    const fight = ch3.findIndex((n) => n.encounter === 'kitchen');
    expect(fight).toBe(3);              // C03-00/01/02 之后立刻开打
    expect(ch3[fight].id).toBe('C03-03');
    expect(ch3[fight].auto).toBe(true); // 打完自动进善后叙述，不用再跑一趟
    expect(ch3[fight].choices ?? []).toHaveLength(0); // 战斗不做选择题
    // 战斗前的三个节点都在"出车—门口—值班室门"这条直线上，没有支线跑腿
    expect(ch3.slice(0, 3).map((n) => n.scene)).toEqual(['yard', 'dongjie', 'kitchen']);
  });

  it('首次致死：记为一次、留下后果，且刀始终不属于许晨也不进背包', () => {
    const s = playAll();
    expect(s.finished).toBe(true);
    expect(hasFlag(s, 'first-lethal')).toBe(true);
    expect(hasFlag(s, 'knife-not-mine')).toBe(true);
    expect(hasFlag(s, 'chapter3-done')).toBe(true);
    // 背包里从来没有过刀（现场留作调查记录）
    for (const d of s.itemJournal) {
      for (const id of [...d.add, ...d.remove]) {
        expect(ITEMS[id]?.name ?? id).not.toMatch(/刀/);
      }
    }
    expect(itemsFor(s).some((i) => /刀/.test(i.name))).toBe(false);
    const all = s.log.map((l) => l.text).join('\n');
    expect(all).toContain('不属于许晨');
    expect(all).toContain('未归还');
    // 致死事实只记一次，且不写成战果
    expect(s.log.filter((l) => l.text.includes('确认死亡'))).toHaveLength(1);
    expect(all).not.toMatch(/击杀|干掉|反杀|连杀|处决|战果/);
  });

  it('陈述不能照原样签：未亲见的"咬伤"必须更正，拒绝提交不改变状态', () => {
    const s = playUntil('C03-04');
    const bad = completeNode(s, 'C03-04', 'sign-as-is');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.rejected).toBe(true);
      expect(bad.pages && bad.pages.length).toBeGreaterThan(0);
    }
    expect(s.completed).not.toContain('C03-04');
    expect(s.flags).not.toContain('statement-signed');
    const good = completeNode(s, 'C03-04', 'correct-record');
    expect(good.ok).toBe(true);
    expect(hasFlag(s, 'statement-signed')).toBe(true);
    expect(s.log.some((l) => l.type === 'uncertain' && l.text.includes('记不全'))).toBe(true);
  });

  it('YZ-15 找回的三处情绪锚点：外套翻袖口、"弄死了"、写在背面', () => {
    const text = (id: string) => {
      const n = NODES.find((x) => x.id === id)!;
      return [...n.pages, ...(n.choices ?? []).flatMap((c) => c.pages)].map((p) => p.text).join('\n');
    };
    // ① doc/08「不再叫他」：冯师傅唯一一次"收衣服"的动作
    const c3 = text('C03-03');
    expect(c3).toContain('是小远的');
    expect(c3).toContain('袖子翻了过来');
    // ② doc/08 收束句：全章情绪最低点，落在母亲电话里
    expect(text('C03-04')).toContain('我今天把一个人弄死了');
    // ③ doc/09 末章：章名《写在背面》的出处，也是第四章《回执》的钩子
    const c5 = text('C03-05');
    expect(c5).toContain('翻到背面');
    expect(c5).toContain('冯志远的名字');
    expect(c5).toContain('我拿了厨房的刀');
    expect(c5).not.toContain('我没有别的办法。'); // 这句他最后没有写
  });

  it('写在背面这一页只进日志、不进背包，也不改变对外口径', () => {
    const s = playAll();
    const back = s.log.find((l) => l.node === 'C03-05' && l.text.includes('背面'));
    expect(back).toBeTruthy();
    expect(back!.type).toBe('fact');
    expect(back!.text).toContain('不交给任何人');
    // 私下写的一页不是对外陈述：不出现在任何道具里
    const items = s.itemJournal.flatMap((d) => d.add).join(',');
    expect(items).not.toContain('notebook-back');
  });

  it('东街口径：十九人是到场、二十二人是核实后需配送，数字不相减', () => {
    const s = playAll();
    const ch3 = s.log.filter((l) => l.node.startsWith('C03-')).map((l) => l.text).join('\n');
    expect(ch3).toContain('本次到场十九人');
    expect(ch3).toContain('二十二名');
    expect(ch3).toContain('临时接三天');
    // 本章不揭示自愈，也不给冯师傅的暴露结果下结论
    expect(ch3).not.toMatch(/自愈|痊愈|不会感染|已排除感染/);
    expect(s.log.some((l) => l.node.startsWith('C03-') && l.type === 'uncertain')).toBe(true);
  });
});

describe('文本节奏与环境热点（对话面板可读性）', () => {
  const allPages = NODES.flatMap((n) => [
    ...n.pages.map((p) => ({ node: n.id, ...p })),
    ...(n.choices ?? []).flatMap((c) => c.pages.map((p) => ({ node: n.id, ...p })))
  ]);

  it('单页不超过一屏：全书叙述 ≤ 85 字、对白 ≤ 45 字（四章统一口径）', () => {
    for (const p of allPages) {
      const limit = p.speaker ? 45 : 85;
      expect(`${p.node}:${p.text.length}<=${limit}`).toBe(`${p.node}:${Math.min(p.text.length, limit)}<=${limit}`);
    }
  });

  it('对白占比：每一章都有足够的人声，不是整章旁白', () => {
    for (const ch of ['C01-', 'C02-', 'C03-', 'C04-']) {
      const pages = allPages.filter((p) => p.node.startsWith(ch));
      const spoken = pages.filter((p) => p.speaker).length;
      expect(`${ch}${spoken > pages.length * 0.15}`).toBe(`${ch}true`);
    }
  });

  it('每个节点都有对白或明确动作，不是整段旁白堆着', () => {
    for (const n of NODES) {
      expect(n.pages.length).toBeGreaterThan(0);
      expect(n.objective.length).toBeLessThanOrEqual(40);
      expect(n.interactLabel.length).toBeLessThanOrEqual(10);
    }
    // 第四章每个节点至少有一句带说话人的台词（全章无战斗，节奏靠对话带）
    for (const n of NODES.filter((x) => x.id.startsWith('C04-'))) {
      const lines = [...n.pages, ...(n.choices ?? []).flatMap((c) => c.pages)].filter((p) => p.speaker);
      expect(`${n.id}:${lines.length > 0}`).toBe(`${n.id}:true`);
    }
  });

  it('环境热点：坐标落在所属场景内，且是只读回声（无物品/日志字段）', () => {
    for (const h of HOTSPOTS) {
      const b = SCENE_BOUNDS[h.scene];
      expect(b).toBeTruthy();
      expect(h.x).toBeGreaterThanOrEqual(b.minX);
      expect(h.x).toBeLessThanOrEqual(b.maxX);
      expect(h.z).toBeGreaterThanOrEqual(b.minZ);
      expect(h.z).toBeLessThanOrEqual(b.maxZ);
      expect(h.pages.length).toBeGreaterThan(0);
      expect(Object.keys(h)).not.toContain('effects');
      for (const p of h.pages) expect(p.text.length).toBeLessThanOrEqual(120);
    }
    // 每个有剧情的场景都至少有一处可注视的东西
    const scenes = new Set(NODES.map((n) => n.scene));
    const withHot = new Set(HOTSPOTS.map((h) => h.scene));
    for (const sc of scenes) {
      if (sc === 'quarantine' || sc === 'kitchen') continue; // 这两处由节点本身的密度撑住
      expect(`${sc}:${withHot.has(sc)}`).toBe(`${sc}:true`);
    }
  });
});

describe('场景可达性（全章不变量）', () => {
  it('相邻节点换场景时，前一个节点必须把 toScene 指到下一个节点所在场景', () => {
    for (let i = 0; i < NODES.length - 1; i++) {
      const cur = NODES[i];
      const next = NODES[i + 1];
      if (next.scene === cur.scene) continue;
      // 否则玩家会停在上一个场景里，永远走不到下一个目标点
      expect(`${cur.id}→${next.id}:${cur.effects.toScene ?? '无'}`)
        .toBe(`${cur.id}→${next.id}:${next.scene}`);
    }
  });
});

describe('第四章 · 回执（第一幕收束）', () => {
  it('六个节点、无战斗、无武器；场景与出生点/外框数据齐备', () => {
    const ch4 = NODES.filter((n) => n.id.startsWith('C04-'));
    expect(ch4).toHaveLength(6);
    expect(ch4.some((n) => n.encounter)).toBe(false);
    for (const n of ch4) {
      expect(SPAWNS[n.scene]).toBeTruthy();
      const b = SCENE_BOUNDS[n.scene];
      expect(b).toBeTruthy();
      expect(n.target[0]).toBeGreaterThanOrEqual(b.minX);
      expect(n.target[0]).toBeLessThanOrEqual(b.maxX);
      expect(n.target[1]).toBeGreaterThanOrEqual(b.minZ);
      expect(n.target[1]).toBeLessThanOrEqual(b.maxZ);
      expect(n.interactLabel).not.toBe('—');
    }
    // 第一幕在这里收束（其后是第二幕的 C05-00）
    expect(ch4[ch4.length - 1].id).toBe('C04-05');
    expect(NODES[NODES.indexOf(ch4[ch4.length - 1]) + 1].id).toBe('C05-00');
  });

  it('核查口径：代签与"两行一起打勾"都被拒绝，且不改变任何状态', () => {
    const s = playUntil('C04-00');
    const bad = completeNode(s, 'C04-00', 'sign-by-courier');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.rejected).toBe(true);
    expect(s.completed).not.toContain('C04-00');
    expect(completeNode(s, 'C04-00', 'split-two').ok).toBe(true);

    const t = playUntil('C04-04');
    const bad2 = completeNode(t, 'C04-04', 'both-tick');
    expect(bad2.ok).toBe(false);
    expect(t.flags).not.toContain('trace-two-lines');
    expect(completeNode(t, 'C04-04', 'one-tick').ok).toBe(true);
    // 第二行只能留白：不写挪用，也不写已使用
    const trace = t.log.filter((l) => l.node === 'C04-04').map((l) => l.text).join('\n');
    expect(trace).toContain('无加工回执');
    expect(trace).toContain('不作挪用结论');
    expect(trace).not.toMatch(/确系挪用|贪污|已全部使用/);
  });

  it('第一幕收束但不写"解决了"：回执未齐、手续在补、调查未结', () => {
    const s = playAll();
    expect(s.finished).toBe(true);
    expect(hasFlag(s, 'chapter4-done')).toBe(true);
    expect(hasFlag(s, 'receipt-pending')).toBe(true);
    const ch4 = s.log.filter((l) => l.node.startsWith('C04-')).map((l) => l.text).join('\n');
    expect(ch4).toContain('固定配给手续仍在办理中');
    expect(ch4).toContain('回执仍未补齐');
    // 不给调查下结论、不替冯师傅表态、不给灰灰升格
    expect(ch4).not.toMatch(/无罪|已结案|不再追究/);
    expect(ch4).toMatch(/最终文书仍需完成程序/);
    expect(ch4).toMatch(/未找到主人|轮班照料|物资站轮班/);
    expect(s.log.some((l) => l.node.startsWith('C04-') && l.type === 'uncertain')).toBe(true);
  });

  it('"收到通知不是收到东西"：转录签名被如实记为不算核过', () => {
    const s = playAll();
    const grid = s.log.filter((l) => l.node === 'C04-05').map((l) => l.text).join('\n');
    expect(grid).toContain('这不算核过');
    expect(grid).toContain('复印件交留守同事');
    const pages = NODES.find((n) => n.id === 'C04-05')!.pages.map((p) => p.text).join('\n');
    expect(pages).toContain('收到通知，不是收到东西');
    expect(pages).toContain('又排上了一串等着登记的人'); // 第一幕不收在一个句号上
  });

  it('v3 存档迁移到 v4：第三章打完的老档接着进第四章', () => {
    const upTo = NODES.slice(0, NODES.findIndex((n) => n.id === 'C04-00')).map((n) => n.id);
    const legacyV3 = JSON.stringify({
      version: 3,
      completed: upTo,
      choices: {},
      log: [],
      flags: ['chapter3-done'],
      itemJournal: [{ node: 'init', add: ['gloves', 'biscuit', 'vest'], remove: [] }],
      player: { x: -0.5, z: 3.2 },
      scene: 'obsroom',
      finished: true
    });
    const restored = parseSave(legacyV3);
    expect(restored.recovered).toBe(false);
    expect(restored.state.version).toBe(SAVE_VERSION);
    expect(restored.state.finished).toBe(false); // 新增章节后不再算"通关"
    expect(currentNode(restored.state)?.id).toBe('C04-00');
  });
});

describe('第五章 · 签过的纸（第二幕开篇）', () => {
  it('六个节点、无战斗；场景数据齐备、目标点在界内', () => {
    const ch5 = NODES.filter((n) => n.id.startsWith('C05-'));
    expect(ch5).toHaveLength(6);
    expect(ch5.some((n) => n.encounter)).toBe(false);
    for (const n of ch5) {
      expect(SPAWNS[n.scene]).toBeTruthy();
      const b = SCENE_BOUNDS[n.scene];
      expect(n.target[0]).toBeGreaterThanOrEqual(b.minX);
      expect(n.target[0]).toBeLessThanOrEqual(b.maxX);
      expect(n.target[1]).toBeGreaterThanOrEqual(b.minZ);
      expect(n.target[1]).toBeLessThanOrEqual(b.maxZ);
    }
    expect(NODES[NODES.length - 1].id).toBe('C05-05');
  });

  it('三处"更省事"的写法都被退回，且不改变任何状态', () => {
    const a = playUntil('C05-00');
    expect(completeNode(a, 'C05-00', 'push-window').ok).toBe(false);
    expect(a.flags).not.toContain('drug-returned');
    expect(completeNode(a, 'C05-00', 'return-by-rule').ok).toBe(true);

    const b = playUntil('C05-03');
    expect(completeNode(b, 'C05-03', 'take-tonight').ok).toBe(false);
    expect(b.flags).not.toContain('liang-joined');
    expect(completeNode(b, 'C05-03', 'wait-handover').ok).toBe(true);

    const c = playUntil('C05-05');
    expect(completeNode(c, 'C05-05', 'overwrite').ok).toBe(false);
    expect(c.flags).not.toContain('chapter5-done');
    expect(completeNode(c, 'C05-05', 'keep-original').ok).toBe(true);
  });

  it('梁医生常驻同行，但不入队、不做好感度；安全区那一段不设选择', () => {
    const s = playAll();
    expect(hasFlag(s, 'met-liang')).toBe(true);
    expect(hasFlag(s, 'liang-joined')).toBe(true);
    const join = s.log.filter((l) => l.node === 'C05-03').map((l) => l.text).join('\n');
    expect(join).toContain('不编入任何队列');
    // 好感度/队伍一类的系统字段不存在
    expect(Object.keys(s)).not.toContain('party');
    expect(Object.keys(s)).not.toContain('affinity');
    // C05-04（安全区 → 岗亭）是叙述，不给选择
    expect(NODES.find((n) => n.id === 'C05-04')!.choices ?? []).toHaveLength(0);
  });

  it('不给自愈结论；"山线"作为待核留在日志里', () => {
    const s = playAll();
    const ch5 = s.log.filter((l) => l.node.startsWith('C05-'));
    const text = ch5.map((l) => l.text).join('\n');
    expect(text).toContain('山线');
    expect(s.log.some((l) => l.text.includes('山线') && l.type === 'uncertain')).toBe(true);
    expect(hasFlag(s, 'shanxian-pending')).toBe(true);
    expect(text).not.toMatch(/确认自愈|已痊愈|具有免疫|可以解除隔离/);
    expect(text).toContain('未取得任何痊愈或免疫结论');
    // 系统分类 ≠ 病情，这句口径必须在
    expect(text).toContain('指系统分类，不指病情');
    // 网门那条线只登记查询，不下死亡结论
    expect(text).toContain('无逐人去向');
    expect(text).not.toMatch(/全部死亡|都死了/);
  });

  it('v4 存档迁移到 v5：第一幕打完的老档接着进第五章', () => {
    const upTo = NODES.slice(0, NODES.findIndex((n) => n.id === 'C05-00')).map((n) => n.id);
    const legacy = JSON.stringify({
      version: 4,
      completed: upTo,
      choices: {},
      log: [],
      flags: ['chapter4-done'],
      itemJournal: [{ node: 'init', add: ['gloves', 'biscuit', 'vest'], remove: [] }],
      player: { x: -3, z: 4 },
      scene: 'trackside',
      finished: true
    });
    const restored = parseSave(legacy);
    expect(restored.recovered).toBe(false);
    expect(restored.state.version).toBe(SAVE_VERSION);
    expect(restored.state.finished).toBe(false);
    expect(currentNode(restored.state)?.id).toBe('C05-00');
  });
});

describe('叙事验收事实（对照 doc/24）', () => {
  it('日志包含必须呈现的口径；不出现被禁止的结论', () => {
    const s = playAll();
    const all = s.log.map((l) => l.text).join('\n');
    expect(all).toContain('空罐');
    expect(all).toContain('食品厂');
    expect(all).toContain('已转出');
    expect(all).toContain('单独安置'); // 灰灰不进安置区
    expect(all).toContain('透析');
    expect(all).toContain('归还勾销');
    expect(all).toContain('不能就此认定为特权区');
    // 禁止口径：不宣称治愈保证、不认定网门人员已恢复
    expect(all).not.toMatch(/治愈|痊愈的保证|已确认恢复|确证自愈/);
  });
});
