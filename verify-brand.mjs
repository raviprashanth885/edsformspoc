import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
await page.goto('http://localhost:3002/chiefs/signup', { waitUntil: 'networkidle' });

const firstNameBox = await page.locator('.field-wrapper:has(#firstname)').boundingBox().catch(() => null);
const lastNameBox = await page.locator('.field-wrapper:has(#lastname)').boundingBox().catch(() => null);
const h1Style = await page.evaluate(() => {
  const h1 = document.querySelector('.brand-banner h1');
  if (!h1) return null;
  const s = getComputedStyle(h1);
  return { text: h1.textContent, transform: s.textTransform, weight: s.fontWeight, font: s.fontFamily };
});
const tooltip = await page.locator('.field-description').count();
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

console.log('firstName box:', firstNameBox);
console.log('lastName box:', lastNameBox);
console.log('side-by-side?', firstNameBox && lastNameBox ? Math.abs(firstNameBox.y - lastNameBox.y) < 5 : 'n/a');
console.log('h1 style:', h1Style);
console.log('field-description (tooltip) count:', tooltip);
console.log('body bg:', bg);

await page.screenshot({ path: 'chiefs-signup.png', fullPage: true });
await browser.close();
