/**
 * 渲染诊断：把线上页面里的第 1 页用 pdf.js 渲染成 PNG 存到本地，肉眼确认渲染是否正常
 * 用法: node render-check.js [url] [out.png]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'https://www.zhizhiapp.com/pdf/';
const OUT = process.argv[3] || path.join(os.tmpdir(), 'render-check.png');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  page.on('requestfailed', (r) => console.error('[reqfail]', r.url(), r.failure() && r.failure().errorText));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // 造一个 3 页、标准字体、带中英文的 PDF
  await page.addScriptTag({ url: '/pdf/vendor/pdf-lib.min.js' });
  const b64 = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const p = doc.addPage([595.28, 841.89]);
    p.drawText('Prod test page 1', { x: 60, y: 740, size: 36, font, color: rgb(0, 0, 0) });
    p.drawRectangle({ x: 60, y: 600, width: 300, height: 60, color: rgb(0.09, 0.38, 0.56) });
    const bytes = await doc.save();
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  const file = path.join(os.tmpdir(), 'render-test.pdf');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));

  const input = await page.$('#fileInput');
  await input.uploadFile(file);
  await page.waitForSelector('.page canvas', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));

  // 用页面内的 pdf.js 把第 1 页高分辨率渲染出来
  const dataUrl = await page.evaluate(async (b64arg) => {
    const mod = await import('/pdf/vendor/pdfjs/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = '/pdf/vendor/pdfjs/pdf.worker.min.mjs';
    const bin = atob(b64arg);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = await mod.getDocument({
      data: bytes,
      cMapUrl: '/pdf/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdf/vendor/pdfjs/standard_fonts/'
    }).promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: 3 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c.toDataURL('image/png');
  }, b64).catch((e) => { console.error('render fail:', e.message); return null; });

  if (dataUrl) {
    fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('saved', OUT);
  } else {
    console.log('render failed');
  }

  await browser.close();
})();
