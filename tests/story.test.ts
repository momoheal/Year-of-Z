import { describe, expect, it } from 'vitest';
import {
  canInteract,
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
