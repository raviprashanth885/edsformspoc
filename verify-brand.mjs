import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:3002/chiefs/signup', { waitUntil: 'networkidle' });

const bannerCount = await page.locator('.brand-banner').count();
const heading = await page.locator('.brand-banner h1').textContent().catch(() => null);
const description = await page.locator('.brand-banner p').textContent().catch(() => null);
const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const linkColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--link-color').trim());
const fields = await page.locator('.form input, .form select').count();
const cardBg = await page.evaluate(() => {
  const el = document.querySelector('.section:has(.form)') || document.querySelector('main > .section');
  return el ? getComputedStyle(el).backgroundColor : null;
});

console.log('URL: /chiefs/signup');
console.log('brand-banner present:', bannerCount);
console.log('heading:', heading);
console.log('description:', description);
console.log('body background-color:', bgColor, '(expect chiefs red, e.g. rgb(227, 24, 55))');
console.log('--link-color var:', linkColor);
console.log('card background:', cardBg, '(expect white)');
console.log('form fields rendered:', fields);
console.log('page errors:', errors);

await browser.close();
