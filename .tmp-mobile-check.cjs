const { chromium, devices } = require('playwright');
const fs = require('fs');

const OUT_DIR = '/private/tmp/claude-501/-Users-ravi-Documents-GitHub-edsformspoc/d7f73bad-28a6-4df1-9671-672dfd7a3972/scratchpad/shots';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const iphone = devices['iPhone 12 Pro'];
  const context = await browser.newContext({ ...iphone });
  const page = await context.newPage();

  await page.goto('http://localhost:3002/chiefs/signup', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT_DIR}/iphone12pro-top.png` });

  const metrics = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    const overflowing = [];
    document.querySelectorAll('body *').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewportWidth + 1 || rect.left < -1) {
        overflowing.push({
          tag: el.tagName,
          class: el.className && el.className.toString ? el.className.toString().slice(0, 80) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
      }
    });
    const switcher = document.querySelector('.form-language-switcher');
    const switcherInfo = switcher ? (() => {
      const r = switcher.getBoundingClientRect();
      const cs = getComputedStyle(switcher);
      return {
        position: cs.position, top: r.top, right: viewportWidth - r.right, width: r.width, height: r.height,
      };
    })() : null;
    return {
      docWidth, viewportWidth, horizontalOverflow: docWidth > viewportWidth,
      overflowingCount: overflowing.length,
      overflowing: overflowing.slice(0, 15),
      switcherInfo,
    };
  });

  fs.writeFileSync(`${OUT_DIR}/iphone12pro-metrics.json`, JSON.stringify(metrics, null, 2));

  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/iphone12pro-scrolled.png` });
  const switcherAfterScroll = await page.evaluate(() => {
    const el = document.querySelector('.form-language-switcher');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, scrollY: window.scrollY };
  });
  fs.writeFileSync(`${OUT_DIR}/iphone12pro-switcher-after-scroll.json`, JSON.stringify(switcherAfterScroll, null, 2));

  await browser.close();
  console.log('done');
})().catch((err) => { console.error(err); process.exit(1); });
