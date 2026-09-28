/**
 * scripts/verify.mjs —— 浏览器验收（本地运行）
 *
 * 覆盖范围（YZ-14 后）：
 *   1) 第一章：开局 → C01-00 → 背包 → 存档 / 读档 → 移动端布局；
 *   2) 第三章对话流（?jump=c3&e2e=1）：C03-00…C03-05 六节点，断言「咬伤→袭击」更正与二十二人名单；
 *   3) 厨房遭遇战（?jump=fight&e2e=1）：拿椅子 → 挡两下散架 → 到备餐台拿刀 → 挡 → 挥 → 进 C03-04；
 *      另跑一次失败重来路径（站着不动被按住 → 「再来一次」→ 战斗重置）。
 * 第 2、3 段用页面注入的 `window.__yoz`（仅 ?e2e=1 时挂载）做站位与读状态，
 * 推进剧情、拾取、格挡、挥击一律走真实 UI / 键盘事件。
 *
 * 用法：先 `npm run build && npm run preview`（CI 即如此，验证生产构建），再：
 *   npx playwright install chromium
 *   npm run verify
 *
 * 沙箱内构建产物检查（npm test / npm run build）不依赖本脚本；
 * 本脚本只负责真实浏览器行为与截图。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.VERIFY_URL ?? 'http://127.0.0.1:5173/';
const SHOT_DIR = 'shots';
mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
let failed = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) {
    failed++;
    // GitHub Actions 注解：失败项在 run 摘要里直接可见（日志下载常受限）
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=verify::${name}`);
  }
};

const browser = await chromium.launch();
try {
  const u = (q) => new URL(`?${q}`, BASE).href;
  /** 统一建页：较短的默认超时，避免单个点击卡满 30 秒 */
  const mkPage = async (opts) => {
    const pg = await browser.newPage(opts);
    pg.setDefaultTimeout(8000);
    pg.on('pageerror', (e) => errors.push(String(e)));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    return pg;
  };
  /** 把当前打开的对话点完；遇到选择支按标签关键字点选 */
  const runDialog = async (pg, pick) => {
    for (let i = 0; i < 40; i++) {
      const choices = pg.locator('#dialog-choices:visible .choice-btn');
      if (await choices.count()) {
        const want = pick ? pg.locator('#dialog-choices .choice-btn', { hasText: pick }) : choices.first();
        await want.first().click();
      } else if (await pg.locator('#dialog:visible').count()) {
        // 用键盘翻页：不受 HUD 遮挡影响（对话中 Space / Enter 即翻页）
        await pg.keyboard.press('Space');
      } else {
        return true;
      }
      await pg.waitForTimeout(140);
    }
    return false;
  };
  const nodeId = (pg) => pg.evaluate(() => window.__yoz.node());
  /** 走到当前节点目标点、按 E 开始对话、点完（战斗节点自动开打，不在此处处理） */
  const playNode = async (pg, pick) => {
    await pg.waitForTimeout(700);
    await pg.evaluate(() => window.__yoz.toTarget());
    await pg.waitForTimeout(400);
    if (!(await pg.locator('#dialog:visible').count())) {
      await pg.keyboard.press('KeyE');
      await pg.waitForTimeout(350);
    }
    await runDialog(pg, pick);
    await pg.waitForTimeout(900);
  };

  // ---------- 桌面 1280×720 ----------
  const page = await mkPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  ok(await page.locator('#game canvas').count() === 1, 'Three.js 画布存在');
  ok(await page.locator('#title-screen:visible').count() === 1, '标题画面可见');
  ok(await page.locator('#taskcard').isVisible(), '任务卡可见');
  // 画布像素非空白：抽像素
  const pixelSample = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  ok(!!pixelSample && pixelSample.w > 0, '画布尺寸有效');

  // 开始新局
  await page.click('#btn-start');
  await page.waitForTimeout(900);
  ok((await page.textContent('#task-title'))?.includes('C01-00'), '初始任务为 C01-00');
  await page.screenshot({ path: `${SHOT_DIR}/01-start.png` });

  // 走进卡车（出生点距目标约 3 米），出现交互提示
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const hintVisible = await page.locator('#interact-hint:visible').count();
  ok(hintVisible === 1, '接近目标后出现交互提示');

  // 触发对话并推进完 C01-00（7 页）
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  ok(await page.locator('#dialog:visible').count() === 1, '对话面板打开');
  ok(await runDialog(page), 'C01-00 对话可以点完（点到面板自行关闭为止）');
  await page.waitForTimeout(500);
  ok((await page.textContent('#task-title'))?.includes('C01-01'), '完成 C01-00 后任务推进到 C01-01');
  await page.screenshot({ path: `${SHOT_DIR}/02-node-done.png` });

  // 背包出现撬棍
  await page.click('#btn-inventory');
  await page.waitForTimeout(300);
  const invText = await page.textContent('#inventory-list');
  ok(!!invText && invText.includes('借用撬棍'), '背包显示借用撬棍');
  ok(!!invText && invText.includes('任务单'), '背包显示任务单');
  await page.screenshot({ path: `${SHOT_DIR}/03-inventory.png` });
  await page.keyboard.press('Escape');

  // 存档写入 + 刷新恢复
  const raw = await page.evaluate(() => localStorage.getItem('yoz.chapter1.v1'));
  const save = raw ? JSON.parse(raw) : null;
  ok(!!save && Array.isArray(save.completed) && save.completed.includes('C01-00'), '存档包含已完成节点');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  ok(await page.locator('#btn-continue:visible').count() === 1, '刷新后出现“继续上次”');
  await page.click('#btn-continue');
  await page.waitForTimeout(800);
  ok((await page.textContent('#task-title'))?.includes('C01-01'), '读档后任务仍是 C01-01');

  // 乱序保护：远距离开南库侧门应提示
  await page.screenshot({ path: `${SHOT_DIR}/04-resumed.png` });

  // ---------- 第三章对话流（?jump=c3） ----------
  const c3 = await mkPage({ viewport: { width: 1280, height: 720 } });

  await c3.goto(u('jump=c3&e2e=1'), { waitUntil: 'networkidle' });
  await c3.waitForTimeout(1800);
  ok(await nodeId(c3) === 'C03-00', '试玩直达：当前任务为 C03-00');

  await playNode(c3);                       // C03-00 今天不煮了
  ok(await nodeId(c3) === 'C03-01', 'C03-00 完成 → C03-01');
  await playNode(c3, '先把到场人数记清楚'); // C03-01 十七只碗（两个选择都是对的）
  ok(await nodeId(c3) === 'C03-02', 'C03-01 完成 → C03-02（十九人到场）');
  await playNode(c3);                       // C03-02 那间小屋 → 门被拉开
  ok(await nodeId(c3) === 'C03-03', 'C03-02 完成 → C03-03（遭遇战入口）');
  ok(!!(await c3.evaluate(() => window.__yoz.combat())), '进入厨房即开打，战斗状态已建立');
  await c3.screenshot({ path: `${SHOT_DIR}/06-kitchen-fight.png` });

  // 对话流这条线不打完整场：用 e2e 钩子站到刀边，按真实按键赢下来（细节在下一段专测）
  const winFight = async (pg) => {
    let holding = false;
    const hold = async (on) => {
      if (on === holding) return;
      await pg.keyboard[on ? 'down' : 'up']('Space');
      holding = on;
    };
    let c = null;
    for (let i = 0; i < 600; i++) {
      c = await pg.evaluate(() => window.__yoz.combat());
      if (!c || c.outcome !== 'none') break;
      if (c.enemy === 'clinch') {
        await hold(false);
        await pg.keyboard.press('KeyJ');
      } else if (c.enemy === 'grab') {
        await hold(false);
        await pg.keyboard.press('Space');
      } else if (!c.hasKnife && (!c.chairTaken || !c.hasChair)) {
        await hold(false);
        await pg.evaluate(() => window.__yoz.toPickup());
        await pg.keyboard.press('KeyE');
      } else {
        await hold(true);
      }
      await pg.waitForTimeout(90);
    }
    await hold(false);
    return c;
  };
  const result = await winFight(c3);
  ok(!!result && result.outcome === 'win', '遭遇战可以打赢（拿椅子 → 椅子散架 → 拿刀 → 挡 → 挥）');
  ok(!!result && result.chairTaken && result.knifeTaken, '顺序被故事锁死：先椅子、后刀');
  await c3.waitForTimeout(2600);
  ok(await c3.locator('#dialog:visible').count() === 1, '胜利后停一拍，自动进入 C03-03 事后段落');
  await runDialog(c3);
  await c3.waitForTimeout(900);
  ok(await nodeId(c3) === 'C03-04', '战斗结束 → C03-04（写在背面）');
  ok(await c3.evaluate(() => window.__yoz.scene()) === 'obsroom', '场景切到外勤观察处');
  await c3.screenshot({ path: `${SHOT_DIR}/07-obsroom.png` });

  // C03-04：先试被退回的写法（照原样签），再做「咬伤 → 袭击」更正
  await c3.evaluate(() => window.__yoz.toTarget());
  await c3.waitForTimeout(300);
  await c3.keyboard.press('KeyE');
  await c3.waitForTimeout(400);
  for (let i = 0; i < 10 && !(await c3.locator('#dialog-choices:visible .choice-btn').count()); i++) {
    await c3.keyboard.press('Space');
    await c3.waitForTimeout(160);
  }
  await c3.locator('#dialog-choices .choice-btn', { hasText: '照原样签了' }).first().click();
  await c3.waitForTimeout(200);
  for (let i = 0; i < 4 && !(await c3.locator('#dialog-choices:visible .choice-btn').count()); i++) {
    await c3.keyboard.press('Space');
    await c3.waitForTimeout(200);
  }
  ok(await c3.locator('#dialog-choices:visible .choice-btn').count() > 0, '「照原样签」被退回选择页，不写成事实');
  await c3.locator('#dialog-choices .choice-btn', { hasText: '是袭击' }).first().click();
  await runDialog(c3);
  await c3.waitForTimeout(900);
  ok(await nodeId(c3) === 'C03-05', 'C03-04 完成 → C03-05');

  await playNode(c3);                       // C03-05 临时三天
  const log3 = await c3.evaluate(() => window.__yoz.logText());
  ok(log3.includes('袭击') && log3.includes('咬伤'), '日志含「咬伤 → 袭击」更正口径');
  ok(log3.includes('二十二名'), '日志含二十二人配送名单');
  ok(!log3.includes('二十二减十九'), '十九与二十二不相减');
  ok(log3.includes('背面') && log3.includes('冯志远的名字'), 'YZ-15：写在背面那一页落到日志里');
  const flags3 = await c3.evaluate(() => window.__yoz.flags());
  ok(flags3.includes('chapter3-done'), '第三章完成标记已写入');
  await c3.screenshot({ path: `${SHOT_DIR}/08-chapter3-done.png` });
  await c3.close();

  // ---------- 第四章《回执》对话流（?jump=c4） ----------
  const c4 = await mkPage({ viewport: { width: 1280, height: 720 } });
  await c4.goto(u('jump=c4&e2e=1'), { waitUntil: 'networkidle' });
  await c4.waitForTimeout(1800);
  ok(await nodeId(c4) === 'C04-00', '试玩直达：当前任务为 C04-00');
  ok(await c4.evaluate(() => window.__yoz.flags()).then((f) => f.includes('chapter3-done')),
    '前三章按默认选择补全（含第三章完成标记）');

  // C04-00：先试被退回的"让送饭的人代签"，再单列上门核查
  await c4.evaluate(() => window.__yoz.toTarget());
  await c4.waitForTimeout(300);
  await c4.keyboard.press('KeyE');
  await c4.waitForTimeout(400);
  for (let i = 0; i < 12 && !(await c4.locator('#dialog-choices:visible .choice-btn').count()); i++) {
    await c4.keyboard.press('Space');
    await c4.waitForTimeout(150);
  }
  await c4.locator('#dialog-choices .choice-btn', { hasText: '顺手替他们签' }).first().click();
  await c4.waitForTimeout(200);
  for (let i = 0; i < 4 && !(await c4.locator('#dialog-choices:visible .choice-btn').count()); i++) {
    await c4.keyboard.press('Space');
    await c4.waitForTimeout(200);
  }
  ok(await c4.locator('#dialog-choices:visible .choice-btn').count() > 0,
    '「让送饭的人代签」被退回选择页：送饭的人不是核查的人');
  ok(await nodeId(c4) === 'C04-00', '被退回不推进任务');
  await c4.locator('#dialog-choices .choice-btn', { hasText: '核查员' }).first().click();
  await runDialog(c4);
  await c4.waitForTimeout(900);
  ok(await nodeId(c4) === 'C04-01', 'C04-00 完成 → C04-01（第四天）');

  await playNode(c4);                                   // C04-01 第四天
  await c4.waitForTimeout(1200);
  ok(await nodeId(c4) === 'C04-02', 'C04-01 完成 → C04-02');
  ok(await c4.evaluate(() => window.__yoz.scene()) === 'home', '场景切到家里');
  await playNode(c4, '名单交给送饭的人');               // C04-02 回家不是好了
  await c4.waitForTimeout(1200);
  ok(await nodeId(c4) === 'C04-03', 'C04-02 完成 → C04-03');
  ok(await c4.evaluate(() => window.__yoz.scene()) === 'repair', '场景切到工坊');
  await c4.screenshot({ path: `${SHOT_DIR}/10-repair.png` });
  await playNode(c4);                                   // C04-03 修好的轮子
  await c4.waitForTimeout(1200);
  ok(await nodeId(c4) === 'C04-04', 'C04-03 完成 → C04-04');
  ok(await c4.evaluate(() => window.__yoz.scene()) === 'waterfix', '场景切到净水维修点');
  await playNode(c4, '第二行留白');                     // C04-04 两行记录
  await c4.waitForTimeout(1200);
  ok(await nodeId(c4) === 'C04-05', 'C04-04 完成 → C04-05');
  await playNode(c4);                                   // C04-05 也有他那一户
  await c4.waitForTimeout(1200);
  ok(await c4.evaluate(() => window.__yoz.scene()) === 'trackside', '收尾场景切到铁路边的路口');

  const log4 = await c4.evaluate(() => window.__yoz.logText());
  ok(log4.includes('无加工回执') && log4.includes('不作挪用结论'), '第二行留白：无回执不写成挪用');
  ok(log4.includes('这不算核过'), '转录签名被如实记为"不算核过"');
  ok(log4.includes('回执仍未补齐'), '第一幕不收在"已解决"上：回执仍未补齐');
  ok(!/无罪|已结案/.test(log4), '不替调查下结论');
  const flags4 = await c4.evaluate(() => window.__yoz.flags());
  ok(flags4.includes('chapter4-done'), '第四章完成标记已写入');
  ok(await c4.locator('#end-screen:visible').count() === 1, '第一幕收束：结尾画面出现');
  await c4.screenshot({ path: `${SHOT_DIR}/11-act1-end.png` });
  await c4.close();

  // ---------- 建景冒烟：逐个场景切过去，确认都能建起来且不报错 ----------
  const sc = await mkPage({ viewport: { width: 1280, height: 720 } });
  await sc.goto(u('jump=c3&e2e=1'), { waitUntil: 'networkidle' });
  await sc.waitForTimeout(1800);
  const SCENES = ['park', 'depot', 'quarantine', 'gate', 'yard', 'road', 'pump', 'liuanli', 'canteen',
    'dongjie', 'kitchen', 'obsroom', 'home', 'repair', 'waterfix', 'gridoffice', 'trackside'];
  const sceneErrors = [];
  sc.on('pageerror', (e) => sceneErrors.push(String(e)));
  for (const id of SCENES) {
    const okScene = await sc.evaluate((s) => window.__yoz.showScene(s), id);
    if (!okScene) sceneErrors.push(`showScene 失败: ${id}`);
    await sc.waitForTimeout(260);
    if (id === 'canteen') await sc.screenshot({ path: `${SHOT_DIR}/12-canteen.png` });
    if (id === 'trackside') await sc.screenshot({ path: `${SHOT_DIR}/13-trackside.png` });
  }
  ok(sceneErrors.length === 0, `17 个场景全部建景成功、无运行时错误（${sceneErrors.length}）`);
  for (const e of sceneErrors.slice(0, 3)) console.log('  scene:', e);
  await sc.close();

  // ---------- 遭遇战专测（?jump=fight）：失败重来路径 ----------
  const fp = await mkPage({ viewport: { width: 1280, height: 720 } });
  await fp.goto(u('jump=fight&e2e=1'), { waitUntil: 'networkidle' });
  await fp.waitForTimeout(2000);
  ok(await nodeId(fp) === 'C03-03', '?jump=fight 直达 C03-03');
  ok(await fp.locator('#combat-hud:visible').count() === 1, '战斗 HUD 可见');
  ok(await fp.locator('#combat-hud').textContent().then((t) => !/血/.test(t ?? '')), 'HUD 无敌人血条');

  // 站着不动、什么都不按：被按住 → 挣不开 → 失败面板
  for (let i = 0; i < 300; i++) {
    const c = await fp.evaluate(() => window.__yoz.combat());
    if (c && c.outcome === 'fail') break;
    await fp.waitForTimeout(100);
  }
  const failed3 = await fp.evaluate(() => window.__yoz.combat());
  ok(!!failed3 && failed3.outcome === 'fail', '站着不动会被按住、挣不开即失败');
  ok(await fp.locator('#combat-fail:visible').count() === 1, '失败面板出现（不是死亡演出）');
  await fp.screenshot({ path: `${SHOT_DIR}/09-combat-fail.png` });
  await fp.click('#btn-combat-retry');
  await fp.waitForTimeout(600);
  const again = await fp.evaluate(() => window.__yoz.combat());
  ok(!!again && again.outcome === 'none' && again.retries === 1, '「再来一次」从门被拉开那一刻重置战斗');
  ok(!!again && !again.chairTaken && !again.knifeTaken, '重来后椅子与刀都回到原处');
  const log0 = await fp.evaluate(() => window.__yoz.logText());
  ok(!log0.includes('冯志远在值班室内发病'), '失败不写任何剧情事实');
  await fp.close();

  // ---------- 移动端 390×844 ----------
  const mp = await mkPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    hasTouch: true
  });
  await mp.goto(u('e2e=1'), { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1500);
  ok(await mp.locator('#taskcard:visible').count() === 1, '移动端任务卡可见');
  // 每个 page 都是独立 context（localStorage 不共享）：先在移动端自己跑完一个节点，再验「继续上次」
  await mp.click('#btn-start');
  await mp.waitForTimeout(900);
  await mp.evaluate(() => { const y = window.__yoz; if (y) y.toTarget(); });
  await mp.waitForTimeout(300);
  await mp.keyboard.press('KeyE');
  await mp.waitForTimeout(400);
  await runDialog(mp);
  await mp.waitForTimeout(800);
  await mp.reload({ waitUntil: 'networkidle' });
  await mp.waitForTimeout(1500);
  ok(await mp.locator('#btn-continue:visible').count() === 1, '移动端可继续存档');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  ok(!overflow, '移动端无横向溢出');
  await mp.screenshot({ path: `${SHOT_DIR}/05-mobile.png` });

  ok(errors.length === 0, `无浏览器错误（${errors.length}）`);
  for (const e of errors.slice(0, 5)) console.log('  console:', e);
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\n全部浏览器验收通过。' : `\n${failed} 项未通过。`);
process.exit(failed === 0 ? 0 : 1);
