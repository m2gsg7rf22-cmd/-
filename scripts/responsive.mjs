// Responsive QA: screenshots + automated layout checks across desktop/tablet/phone viewports.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/responsive';
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  { name: 'desktop-1920x1080', w: 1920, h: 1080, mobile: false },
  { name: 'laptop-1366x768', w: 1366, h: 768, mobile: false },
  { name: 'laptop-1440x900', w: 1440, h: 900, mobile: false },
  { name: 'desktop-21x9-2560x1080', w: 2560, h: 1080, mobile: false },
  { name: 'tablet-1024x768', w: 1024, h: 768, mobile: true },
  { name: 'phone-portrait-360x800', w: 360, h: 800, mobile: true },
  { name: 'phone-portrait-390x844', w: 390, h: 844, mobile: true },
  { name: 'phone-portrait-430x932', w: 430, h: 932, mobile: true },
  { name: 'phone-landscape-800x360', w: 800, h: 360, mobile: true },
  { name: 'phone-landscape-844x390', w: 844, h: 390, mobile: true },
  { name: 'phone-landscape-932x430', w: 932, h: 430, mobile: true },
];
const only = process.env.ONLY;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];
for (const vp of VIEWPORTS) {
  if (only && !vp.name.includes(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const issues = [];
  const check = async (label) => {
    const r = await page.evaluate(() => {
      const out = [];
      const W = innerWidth, H = innerHeight;
      if (document.documentElement.scrollWidth > W + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth}>${W}`);
      const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[hidden]'); };
      // Interactive controls must be inside the viewport and big enough to hit.
      for (const el of document.querySelectorAll('button, .tbtn, .hotbar .slot, input')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const scroller = el.closest('.scroll, .recipes, .library, .screen');
        const inScroll = scroller && scroller.scrollHeight > scroller.clientHeight + 2;
        if (!inScroll && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) out.push(`offscreen ${el.className || el.tagName} ${el.textContent.trim().slice(0, 20)} [${r.left|0},${r.top|0},${r.right|0},${r.bottom|0}]`);
        if (Math.min(r.width, r.height) < 30) out.push(`tiny ${el.className || el.tagName} ${r.width|0}x${r.height|0}`);
      }
      // Crosshair centered.
      const ch = document.querySelector('.crosshair');
      if (ch && vis(ch)) {
        const r = ch.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (Math.abs(cx - W / 2) > 1.5 || Math.abs(cy - H / 2) > 1.5) out.push(`crosshair off-center (${cx},${cy})`);
      }
      // Touch buttons must not overlap the hotbar or each other.
      const hb = document.querySelector('.hotbar');
      const tbs = [...document.querySelectorAll('#touch .tbtn')].filter(vis);
      const ov = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      if (hb && vis(hb)) {
        const hr = hb.getBoundingClientRect();
        for (const t of tbs) if (ov(t.getBoundingClientRect(), hr)) out.push(`touch button ${t.dataset.touch} overlaps hotbar`);
        const bars = document.querySelector('.bars');
        if (bars && vis(bars)) for (const t of tbs) if (ov(t.getBoundingClientRect(), bars.getBoundingClientRect())) out.push(`touch button ${t.dataset.touch} overlaps health bars`);
      }
      for (let i = 0; i < tbs.length; i++) for (let j = i + 1; j < tbs.length; j++) if (ov(tbs[i].getBoundingClientRect(), tbs[j].getBoundingClientRect())) out.push(`touch buttons overlap ${tbs[i].dataset.touch}/${tbs[j].dataset.touch}`);
      // Canvas must match viewport (no stretching).
      const c = document.getElementById('game');
      const cr = c.getBoundingClientRect();
      if (Math.abs(cr.width - W) > 1 || Math.abs(cr.height - H) > 1) out.push(`canvas ${cr.width}x${cr.height} != viewport`);
      const app = window.__bf?.app;
      if (app?.r) {
        const cam = app.r.camera;
        if (Math.abs(cam.aspect - W / H) > 0.01) out.push(`camera aspect ${cam.aspect.toFixed(3)} != ${(W / H).toFixed(3)}`);
        const db = app.r.renderer.domElement;
        const ratio = db.width / db.height;
        if (Math.abs(ratio - W / H) > 0.02) out.push(`drawing buffer aspect ${ratio.toFixed(3)} != ${(W / H).toFixed(3)}`);
      }
      return out;
    });
    for (const i of r) issues.push(`${label}: ${i}`);
    await page.screenshot({ path: `${OUT}/${vp.name}-${label}.png` });
  };
  try {
    await page.goto(URL_);
    await page.waitForSelector('[data-screen=menu]');
    await page.waitForTimeout(300);
    await check('menu');
    await page.click('[data-act=new]');
    await check('newworld');
    await page.click('[data-act=back]');
    await page.click('[data-act=settings]');
    await check('settings');
    await page.click('[data-screen=settings] [data-act=back]');
    await page.click('[data-act=new]');
    await page.fill('[name=seed]', 'responsive');
    await page.click('[data-act=create]');
    await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
    // Portrait phones show the rotate overlay first.
    if (await page.$('[data-screen=rotate]')) {
      await check('rotate');
      await page.click('[data-screen=rotate] [data-act=continue]');
    }
    await page.evaluate(() => { const g = window.__bf.app.game; g.inventory.add(11, 5); g.inventory.add(3, 20); g.inventory.add(302, 1); });
    await page.waitForTimeout(1200);
    await check('game');
    await page.evaluate(() => window.__bf.app.openInventory());
    await page.waitForTimeout(300);
    await check('inventory');
    await page.evaluate(() => window.__bf.app.closeInventory());
    await page.evaluate(() => window.__bf.app.pause());
    await page.waitForTimeout(200);
    await check('pause');
    await page.evaluate(() => window.__bf.app.resume());
    await page.evaluate(() => window.__bf.app.game.player.hurt(100, 'fall'));
    await page.waitForTimeout(400);
    await check('death');
  } catch (e) {
    issues.push(`flow error: ${e.message}`);
  }
  if (errors.length) issues.push(...errors.map((e) => `console: ${e}`));
  report.push({ viewport: vp.name, issues });
  console.log(`${issues.length ? 'ISSUES' : 'OK    '} ${vp.name}${issues.length ? '\n   ' + issues.join('\n   ') : ''}`);
  await ctx.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
