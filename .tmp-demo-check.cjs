const { chromium, devices } = require('playwright');
const fs = require('fs');

const OUT_DIR = '/private/tmp/claude-501/-Users-ravi-Documents-GitHub-edsformspoc/d7f73bad-28a6-4df1-9671-672dfd7a3972/scratchpad/shots';
const URL = 'http://localhost:3002/chiefs/signup';
const report = {};

function collectConsole(page, key) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  report[key] = errors;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  // ---- Desktop pass ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    collectConsole(page, 'desktopConsoleErrors');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT_DIR}/final-desktop-top.png` });

    const overflow = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    report.desktopOverflow = overflow.docWidth > overflow.viewportWidth;

    // Fill fields
    await page.fill('input[name="firstname"]', 'Ada');
    await page.fill('input[name="lastname"]', 'Lovelace');
    await page.fill('input[name="email"]', 'ada@example.com');
    await page.selectOption('select[name="favoriteteam"]', { label: 'Kansas City Chiefs' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT_DIR}/final-desktop-team-popup.png` });
    const popupVisible = await page.evaluate(() => {
      const el = document.querySelector('.team-highlight-popup');
      return el ? el.classList.contains('open') : false;
    });
    report.teamHighlightPopupOpened = popupVisible;

    // tooltip
    const tooltipTrigger = await page.$('.field-tooltip-trigger');
    if (tooltipTrigger) {
      await tooltipTrigger.click();
      await page.waitForTimeout(300);
      const bubbleVisible = await page.evaluate(() => {
        const t = document.querySelector('.field-tooltip-trigger[aria-expanded="true"]');
        return !!t;
      });
      report.tooltipOpened = bubbleVisible;
    } else {
      report.tooltipOpened = 'no trigger found';
    }

    // country conditional field
    await page.selectOption('select[name="country"]', { value: 'CAN' });
    await page.waitForTimeout(300);
    const ageconfirmVisible = await page.evaluate(() => {
      const w = document.querySelector('[name="ageconfirm"]')?.closest('.field-wrapper');
      return w ? getComputedStyle(w).display !== 'none' : null;
    });
    report.canadaConditionalFieldVisible = ageconfirmVisible;
    await page.screenshot({ path: `${OUT_DIR}/final-desktop-canada.png` });

    // language switcher
    await page.selectOption('.language-switcher-select', { value: 'es' });
    await page.waitForTimeout(500);
    const switcherLoading = await page.evaluate(() => document.querySelector('.form-language-switcher')?.classList.contains('loading'));
    report.languageSwitcherTriggeredLoading = switcherLoading;
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT_DIR}/final-desktop-lang-switch-attempt.png` });
    const stillLoadingAfterWait = await page.evaluate(() => document.querySelector('.form-language-switcher')?.classList.contains('loading'));
    report.languageSwitcherStillLoadingAfter2s = stillLoadingAfterWait;

    await page.close();
  }

  // ---- Mobile pass ----
  {
    const iphone = devices['iPhone 12 Pro'];
    const context = await browser.newContext({ ...iphone });
    const page = await context.newPage();
    collectConsole(page, 'mobileConsoleErrors');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT_DIR}/final-mobile-top.png` });

    const metrics = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const overflowing = [];
      document.querySelectorAll('body *').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 1 || rect.left < -1) {
          overflowing.push({ tag: el.tagName, class: (el.className || '').toString().slice(0, 60), right: Math.round(rect.right) });
        }
      });
      return {
        docWidth: document.documentElement.scrollWidth,
        viewportWidth,
        overflowingCount: overflowing.length,
        overflowing: overflowing.slice(0, 10),
      };
    });
    report.mobileMetrics = metrics;

    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT_DIR}/final-mobile-scrolled.png` });
    const switcherTopAfterScroll = await page.evaluate(() => {
      const el = document.querySelector('.form-language-switcher');
      return el ? el.getBoundingClientRect().top : null;
    });
    report.mobileSwitcherTopAfterScroll = switcherTopAfterScroll;

    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT_DIR}/final-mobile-scrolled-more.png` });

    await context.close();
  }

  await browser.close();
  fs.writeFileSync(`${OUT_DIR}/final-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((err) => { console.error(err); process.exit(1); });
