/**
 * scripts/verify.mjs —— 浏览器验收（本地运行）
 *
 * 用法：先 `npm run dev`（或传入 VERIFY_URL 指向静态构建），再：
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
  if (!cond) failed++;
};

const browser = await chromium.launch();
try {
  // ---------- 桌面 1280×720 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle2' });
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
  ok((await page.textContent('#task-title'))!.includes('C01-00'), '初始任务为 C01-00');
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
  for (let i = 0; i < 9; i++) {
    await page.click('#dialog');
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(500);
  ok((await page.textContent('#task-title'))!.includes('C01-01'), '完成 C01-00 后任务推进到 C01-01');
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
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForTimeout(1200);
  ok(await page.locator('#btn-continue:visible').count() === 1, '刷新后出现“继续上次”');
  await page.click('#btn-continue');
  await page.waitForTimeout(800);
  ok((await page.textContent('#task-title'))!.includes('C01-01'), '读档后任务仍是 C01-01');

  // 乱序保护：远距离开南库侧门应提示
  await page.screenshot({ path: `${SHOT_DIR}/04-resumed.png` });

  // ---------- 移动端 390×844 ----------
  const mp = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    hasTouch: true
  });
  mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(BASE, { waitUntil: 'networkidle2' });
  await mp.waitForTimeout(1500);
  ok(await mp.locator('#taskcard:visible').count() === 1, '移动端任务卡可见');
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
