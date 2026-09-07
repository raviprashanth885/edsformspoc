const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failed = [];
  page.on('response', (res) => {
    if (res.status() === 404) failed.push(res.url());
  });
  await page.goto('http://localhost:3002/chiefs/signup', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.selectOption('select[name="favoriteteam"]', { label: 'Kansas City Chiefs' }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.selectOption('select[name="country"]', { value: 'CAN' }).catch(() => {});
  await page.waitForTimeout(500);
  console.log(JSON.stringify(failed, null, 2));
  await browser.close();
})();
