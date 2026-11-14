/**
 * 截图脚本（本地 QA 用）
 *   node shot.js <url> <输出png> [宽] [高] [fullPage]
 * 环境变量 CHROME 可指定浏览器路径。
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const [url, out, w = '1440', h = '1000', full = '1'] = process.argv.slice(2);
  if (!url || !out) {
    console.error('用法: node shot.js <url> <out.png> [width] [height] [fullPage=1|0]');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: parseInt(w, 10), height: parseInt(h, 10), deviceScaleFactor: 1 });
    // 让 .reveal 这类滚动动画在截图时直接以最终状态呈现
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('[console.error]', m.text());
    });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 演示页会自己把标题改成 DEMO READY
    await page.waitForFunction(() => document.title.includes('READY') || !document.querySelector('iframe'), { timeout: 45000 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    await page.screenshot({
      path: path.resolve(out),
      fullPage: full === '1'
    });

    console.log('OK', out, await page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
