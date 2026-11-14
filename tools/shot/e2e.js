/**
 * 线上端到端测试：直接打 https://www.zhizhiapp.com/pdf/
 *   - 上传本地生成的 PDF → 缩略图 → 全选 → 旋转 → 删除 → 导出下载
 *   - 触发一次 OCR（验证 .gz 语言包与 wasm 在 IIS 上可用）
 * 用法: node e2e.js [url]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'https://www.zhizhiapp.com/pdf/';
const DL = path.join(os.tmpdir(), 'pdf-e2e-dl');

const log = (ok, name, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--hide-scrollbars']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    log(true, '页面打开', URL);

    // 用站点自带的 pdf-lib 造测试文件
    await page.addScriptTag({ url: '/pdf/vendor/pdf-lib.min.js' });
    const b64 = await page.evaluate(async () => {
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      for (let i = 1; i <= 3; i++) {
        const p = doc.addPage([595.28, 841.89]);
        p.drawText(`Prod test page ${i}`, { x: 60, y: 740, size: 28, font, color: rgb(0.09, 0.38, 0.56) });
      }
      const bytes = await doc.save();
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    const pdfPath = path.join(os.tmpdir(), 'prod-test.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(b64, 'base64'));
    log(fs.statSync(pdfPath).size > 500, '生成测试 PDF', fs.statSync(pdfPath).size + 'B');

    // 上传
    const input = await page.$('#fileInput');
    await input.uploadFile(pdfPath);
    await page.waitForSelector('.page', { timeout: 60000 });
    const pageCount = await page.$$eval('.page', (els) => els.length);
    log(pageCount === 3, '缩略图渲染 3 页', '实际 ' + pageCount);

    const toolbarVisible = await page.$eval('#toolbar', (el) => !el.hidden);
    log(toolbarVisible, '工具栏出现');

    // OCR（验证 wasm + 语言包在 IIS 上可下载）
    await page.click('.tab[data-panel="p-ocr"]');
    await page.$eval('#ocrRange', (el) => { el.value = '1'; });
    await page.click('#ocrEng');            // 测试文档是英文，必须勾上英文模型
    const t0 = Date.now();
    await page.click('#btnOcr');
    let ocrText = '';
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const done = await page.$eval('#ocrResult', (el) => !el.hidden);
      if (done) { ocrText = await page.$eval('#ocrText', (el) => el.value); break; }
    }
    const cost = ((Date.now() - t0) / 1000).toFixed(1);
    log(!!ocrText, 'OCR 产出文本', cost + 's, ' + ocrText.length + ' 字');
    log(/Prod test page/i.test(ocrText), 'OCR 认出英文文本', JSON.stringify(ocrText.slice(0, 60)));


    // 全选 + 旋转
    await page.click('#btnSelectAll');
    await page.click('#btnRotate');
    await new Promise((r) => setTimeout(r, 800));
    const flags = await page.$$eval('.page-flag', (els) => els.map((e) => e.textContent));
    log(flags.length === 3 && flags[0] === '90°', '旋转标记', flags.join(','));

    // 删除 1 页
    await page.$$eval('.page', (els) => els[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.click('#btnDelete');
    await new Promise((r) => setTimeout(r, 800));
    const after = await page.$$eval('.page', (els) => els.length);
    log(after === 2, '删除后剩 2 页', '实际 ' + after);

    // 导出下载（先切回导出面板）
    await page.click('.tab[data-panel="p-export"]');
    await page.click('#btnExport');
    let pdfFile = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const f = fs.readdirSync(DL).filter((n) => n.endsWith('.pdf'));
      if (f.length) { pdfFile = path.join(DL, f[0]); break; }
    }
    log(!!pdfFile, '导出文件已下载', pdfFile ? path.basename(pdfFile) : '无');
    if (pdfFile) {
      const buf = fs.readFileSync(pdfFile);
      log(buf.slice(0, 4).toString() === '%PDF', '下载文件是 PDF', buf.length + 'B');
      const b64out = buf.toString('base64');
      const pages = await page.evaluate(async (b) => {
        const bin = atob(b);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const doc = await window.PDFLib.PDFDocument.load(bytes);
        return doc.getPageCount();
      }, b64out);
      log(pages === 2, '导出文件为 2 页', '实际 ' + pages);
    }

    log(errors.length === 0, '无 JS 报错', errors.slice(0, 3).join(' | '));
  } catch (e) {
    log(false, '异常', e.message);
  } finally {
    await browser.close();
  }
})();
