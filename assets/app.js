import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

/* ==========================================================================
   知智 · PDF 工具
   - 合并 / 删页 / 调序 / 旋转：pdf.js 预览 + pdf-lib 导出
   - 拆分：pdf-lib + JSZip
   - OCR：tesseract.js（按需加载）
   全部在浏览器完成，不上传任何文件。
   ========================================================================== */

const BASE = new URL('./', location.href).href;
const VENDOR = new URL('../vendor/', BASE).href;

pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';

const LIMITS = { fileMB: 10, files: 20, pages: 200, ocrPages: 20 };
const THUMB_WIDTH = 240;

/* --- 状态 ---------------------------------------------------------------- */

const docs = new Map();      // docId -> { name, bytes, pdfDoc, libDoc }
const pages = [];            // { id, docId, index, rotation }
const selected = new Set();
let seq = 0;
let busy = false;
let currentLabel = '';

/* --- DOM ----------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const dropEl = $('drop');
const fileInput = $('fileInput');
const toolbar = $('toolbar');
const toolbarInfo = $('toolbarInfo');
const pagesEl = $('pages');
const actionsEl = $('actions');
const toastEl = $('toast');

/* --- 工具函数 ------------------------------------------------------------ */

function toast(msg, isError) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('is-error', !!isError);
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, isError ? 5200 : 2600);
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function baseName() {
  const first = pages.length ? docs.get(pages[0].docId) : null;
  if (!first) return 'document';
  return (first.name || 'document').replace(/\.pdf$/i, '');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (loadScript._cache && loadScript._cache[src]) return resolve(loadScript._cache[src]);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { (loadScript._cache ||= {})[src] = true; resolve(); };
    s.onerror = () => reject(new Error('资源加载失败：' + src));
    document.head.appendChild(s);
  });
}

async function ensurePdfLib() {
  await loadScript(VENDOR + 'pdf-lib.min.js');
  if (!window.PDFLib) throw new Error('pdf-lib 未就绪');
  return window.PDFLib;
}

async function ensureJsZip() {
  await loadScript(VENDOR + 'jszip.min.js');
  if (!window.JSZip) throw new Error('JSZip 未就绪');
  return window.JSZip;
}

/* --- 载入文件 ------------------------------------------------------------ */

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!incoming.length) return;

  if (docs.size + incoming.length > LIMITS.files) {
    toast(`最多 ${LIMITS.files} 个文件`, true);
    return;
  }

  let added = 0;
  for (const file of incoming) {
    if (file.size > LIMITS.fileMB * 1024 * 1024) {
      toast(`${file.name} 超过 ${LIMITS.fileMB} MB，已跳过`, true);
      continue;
    }
    if (pages.length >= LIMITS.pages) {
      toast(`总页数已达上限 ${LIMITS.pages}`, true);
      break;
    }

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdfDoc = await pdfjsLib.getDocument({
        data: buf.slice(0),
        cMapUrl: VENDOR + 'pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/'
      }).promise;

      const docId = 'd' + (++seq);
      const room = LIMITS.pages - pages.length;
      const count = Math.min(pdfDoc.numPages, room);

      docs.set(docId, { name: file.name, bytes: buf, pdfDoc, libDoc: null });

      for (let i = 0; i < count; i++) {
        pages.push({ id: 'p' + (++seq), docId, index: i, rotation: 0 });
      }
      added++;
      if (count < pdfDoc.numPages) toast(`只载入前 ${count} 页（总页数上限 ${LIMITS.pages}）`, true);
    } catch (err) {
      const msg = String(err && err.name === 'PasswordException' ? '有密码，暂不支持加密 PDF' : '文件读取失败');
      toast(`${file.name}：${msg}`, true);
    }
  }

  if (added) renderAll();
}

/* --- 渲染 ---------------------------------------------------------------- */

function renderAll() {
  const hasPages = pages.length > 0;
  toolbar.hidden = !hasPages;
  actionsEl.hidden = !hasPages;
  document.body.classList.toggle('has-pages', hasPages);

  toolbarInfo.innerHTML = hasPages
    ? `已载入 <b>${docs.size}</b> 个文件 · 共 <b>${pages.length}</b> 页${selected.size ? ` · 选中 <b>${selected.size}</b> 页` : ''}`
    : '';

  pagesEl.innerHTML = '';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      renderThumb(e.target);
    }
  }, { rootMargin: '200px 0px' });

  pages.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'page';
    card.dataset.id = item.id;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', selected.has(item.id) ? 'true' : 'false');
    card.title = `${docs.get(item.docId).name} · 第 ${item.index + 1} 页`;
    if (selected.has(item.id)) card.classList.add('is-selected');

    const thumb = document.createElement('div');
    thumb.className = 'page-thumb is-loading';

    const num = document.createElement('div');
    num.className = 'page-num';
    num.innerHTML = `<b>${i + 1}</b>`;

    card.append(thumb, num);

    if (item.rotation % 360 !== 0) {
      const flag = document.createElement('span');
      flag.className = 'page-flag';
      flag.textContent = item.rotation + '°';
      card.appendChild(flag);
    }

    pagesEl.appendChild(card);
    io.observe(card);
  });
}

async function renderThumb(card) {
  const item = pages.find((p) => p.id === card.dataset.id);
  const holder = card.querySelector('.page-thumb');
  if (!item || !holder) return;

  const doc = docs.get(item.docId);
  try {
    const page = await doc.pdfDoc.getPage(item.index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_WIDTH / base.width;
    const vp = page.getViewport({ scale, rotation: (page.rotate + item.rotation) % 360 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    holder.classList.remove('is-loading');
    holder.innerHTML = '';
    holder.appendChild(canvas);
  } catch {
    holder.classList.remove('is-loading');
    holder.textContent = '预览失败';
  }
}

/* --- 选择 ---------------------------------------------------------------- */

function toggleSelect(card, additive) {
  const id = card.dataset.id;
  if (!additive) selected.clear();

  if (selected.has(id)) {
    if (additive) selected.delete(id);
    else selected.add(id);
  } else {
    selected.add(id);
  }
  syncSelection();
}

function syncSelection() {
  pagesEl.querySelectorAll('.page').forEach((el) => {
    const on = selected.has(el.dataset.id);
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (!toolbar.hidden) {
    toolbarInfo.innerHTML = `已载入 <b>${docs.size}</b> 个文件 · 共 <b>${pages.length}</b> 页${selected.size ? ` · 选中 <b>${selected.size}</b> 页` : ''}`;
  }
}

function targetSelection() {
  if (selected.size) return pages.filter((p) => selected.has(p.id));
  return [];
}

/* --- 页操作 -------------------------------------------------------------- */

function moveSelection(dir) {
  const picked = targetSelection();
  if (!picked.length) { toast('先选中要移动的页'); return; }
  const ids = new Set(picked.map((p) => p.id));

  if (dir > 0) {
    for (let i = pages.length - 2; i >= 0; i--) {
      if (ids.has(pages[i].id) && !ids.has(pages[i + 1].id)) {
        [pages[i], pages[i + 1]] = [pages[i + 1], pages[i]];
      }
    }
  } else {
    for (let i = 1; i < pages.length; i++) {
      if (ids.has(pages[i].id) && !ids.has(pages[i - 1].id)) {
        [pages[i], pages[i - 1]] = [pages[i - 1], pages[i]];
      }
    }
  }
  renderAll();
}

function rotateSelection() {
  const picked = targetSelection();
  if (!picked.length) { toast('先选中要旋转的页'); return; }
  picked.forEach((p) => { p.rotation = (p.rotation + 90) % 360; });
  renderAll();
}

function deleteSelection() {
  const picked = targetSelection();
  if (!picked.length) { toast('先选中要删除的页'); return; }
  const ids = new Set(picked.map((p) => p.id));
  for (let i = pages.length - 1; i >= 0; i--) {
    if (ids.has(pages[i].id)) pages.splice(i, 1);
  }
  selected.clear();
  if (!pages.length) clearAll();
  else renderAll();
}

function clearAll() {
  pages.length = 0;
  selected.clear();
  docs.forEach((d) => { try { d.pdfDoc.destroy(); } catch {} });
  docs.clear();
  pagesEl.innerHTML = '';
  toolbar.hidden = true;
  actionsEl.hidden = true;
  document.body.classList.remove('has-pages');
  fileInput.value = '';
  $('ocrResult').hidden = true;
  $('ocrProgress').hidden = true;
}

/* --- 拖拽排序 ------------------------------------------------------------ */

let dragId = null;

pagesEl.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.page');
  if (!card) return;
  dragId = card.dataset.id;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch {}
});

pagesEl.addEventListener('dragend', () => {
  dragId = null;
  pagesEl.querySelectorAll('.page').forEach((el) => el.classList.remove('is-dragging', 'is-drop-target'));
});

pagesEl.addEventListener('dragover', (e) => {
  const card = e.target.closest('.page');
  if (!card || !dragId || card.dataset.id === dragId) return;
  e.preventDefault();
  pagesEl.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  card.classList.add('is-drop-target');
});

pagesEl.addEventListener('drop', (e) => {
  const card = e.target.closest('.page');
  if (!card || !dragId) return;
  e.preventDefault();

  const from = pages.findIndex((p) => p.id === dragId);
  const to = pages.findIndex((p) => p.id === card.dataset.id);
  if (from < 0 || to < 0 || from === to) return;

  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  dragId = null;
  renderAll();
});

/* --- 导出 ---------------------------------------------------------------- */

async function buildPdf(items) {
  const { PDFDocument, degrees } = await ensurePdfLib();
  const out = await PDFDocument.create();

  for (const item of items) {
    const doc = docs.get(item.docId);
    if (!doc.libDoc) {
      doc.libDoc = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
    }
    const [copied] = await out.copyPages(doc.libDoc, [item.index]);
    const baseAngle = copied.getRotation().angle || 0;
    copied.setRotation(degrees(((baseAngle + item.rotation) % 360 + 360) % 360));
    out.addPage(copied);
  }
  return out.save();
}

async function exportPdf() {
  if (busy) return;
  if (!pages.length) return;
  busy = true;
  $('btnExport').disabled = true;
  $('btnExport').textContent = '正在生成…';
  try {
    const bytes = await buildPdf(pages);
    download(new Blob([bytes], { type: 'application/pdf' }), `${baseName()}-合并.pdf`);
    toast(`已生成 ${pages.length} 页`);
  } catch (err) {
    toast('生成失败：' + (err.message || err), true);
  } finally {
    busy = false;
    $('btnExport').disabled = false;
    $('btnExport').textContent = '导出 PDF';
  }
}

/* --- 拆分 ---------------------------------------------------------------- */

function parseRanges(text, max) {
  const groups = [];
  const parts = String(text || '').split(/[,，;；\s]+/).filter(Boolean);
  for (const raw of parts) {
    const m = raw.match(/^(\d+)\s*(?:[-–~]\s*(\d+))?$/);
    if (!m) continue;
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    a = Math.max(1, a);
    b = Math.min(max, b);
    if (a > b) continue;
    const g = [];
    for (let i = a; i <= b; i++) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

async function splitPdf() {
  if (busy || !pages.length) return;

  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  let groups = [];

  if (mode === 'range') {
    groups = parseRanges($('rangeInput').value, pages.length);
    if (!groups.length) { toast('页码范围写得不对，例如 1-3,5,8-10', true); return; }
  } else if (mode === 'every') {
    const n = Math.max(1, parseInt($('everyInput').value, 10) || 10);
    for (let i = 0; i < pages.length; i += n) groups.push(pages.slice(i, i + n).map((_, k) => i + k));
  } else {
    groups = pages.map((_, i) => [i]);
  }

  busy = true;
  const btn = $('btnSplit');
  btn.disabled = true;
  btn.textContent = '正在拆分…';

  try {
    const JSZip = await ensureJsZip();
    const zip = new JSZip();
    const name = baseName();

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const bytes = await buildPdf(g.map((i) => pages[i]));
      const label = g.length && g[0] === g[g.length - 1]
        ? `${g[0] + 1}`
        : `${g[0] + 1}-${g[g.length - 1] + 1}`;
      zip.file(`${name}-${label}.pdf`, bytes);
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    download(blob, `${name}-拆分-${groups.length}份.zip`);
    toast(`已生成 ${groups.length} 个文件`);
  } catch (err) {
    toast('拆分失败：' + (err.message || err), true);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = '拆分并下载 zip';
  }
}

/* --- OCR ----------------------------------------------------------------- */

let ocrWorker = null;
let ocrCancelled = false;
async function renderPageForOcr(item, maxSide = 2200) {
  const doc = docs.get(item.docId);
  const page = await doc.pdfDoc.getPage(item.index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / base.width, maxSide / base.height, 4.2);
  const vp = page.getViewport({ scale, rotation: (page.rotate + item.rotation) % 360 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas;
}

async function getOcrWorker(includeEng, onLog) {
  if (ocrWorker) {
    const cur = ocrWorker._langs || '';
    const want = includeEng ? 'chi_sim+eng' : 'chi_sim';
    if (cur === want) return ocrWorker;
    await ocrWorker.terminate();
    ocrWorker = null;
  }

  await loadScript(VENDOR + 'tesseract/tesseract.min.js');
  if (!window.Tesseract) throw new Error('识别引擎未就绪');

  const langs = includeEng ? 'chi_sim+eng' : 'chi_sim';
  const worker = await window.Tesseract.createWorker(langs, 1, {
    workerPath: VENDOR + 'tesseract/worker.min.js',
    corePath: VENDOR + 'tesseract/tesseract-core-simd-lstm.wasm.js',
    langPath: VENDOR + 'tessdata',
    logger: (m) => onLog && onLog(m),
    errorHandler: (e) => console.error('[tesseract]', e)
  });
  worker._langs = langs;
  ocrWorker = worker;
  return worker;
}

async function runOcr() {
  if (busy || !pages.length) return;

  const rangeText = $('ocrRange').value.trim();
  const picked = rangeText
    ? parseRanges(rangeText, pages.length).flat().map((i) => pages[i])
    : pages.slice();

  if (!picked.length) { toast('没有要识别的页', true); return; }
  if (picked.length > LIMITS.ocrPages) {
    toast(`一次最多识别 ${LIMITS.ocrPages} 页，当前 ${picked.length} 页`, true);
    return;
  }

  const includeEng = $('ocrEng').checked;
  const progress = $('ocrProgress');
  const bar = $('ocrBar');
  const status = $('ocrStatus');
  const resultBox = $('ocrResult');
  const textArea = $('ocrText');
  const btn = $('btnOcr');
  const cancelBtn = $('btnOcrCancel');

  busy = true;
  ocrCancelled = false;
  btn.disabled = true;
  cancelBtn.hidden = false;
  progress.hidden = false;
  resultBox.hidden = true;
  bar.style.width = '2%';
  textArea.value = '';
  status.textContent = '正在准备识别引擎…';

  const chapters = [];

  try {
    const worker = await getOcrWorker(includeEng, (m) => {
      if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
        status.textContent = '正在加载识别引擎…';
      } else if (m.status === 'loading language traineddata') {
        status.textContent = '正在下载语言模型…';
      } else if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        const pct = Math.round(m.progress * 100);
        status.textContent = `${currentLabel} 识别中 ${pct}%`;
      }
    });

    for (let i = 0; i < picked.length; i++) {
      if (ocrCancelled) break;
      const item = picked[i];
      currentLabel = `第 ${i + 1}/${picked.length} 页`;
      status.textContent = `${currentLabel} 正在渲染…`;
      bar.style.width = Math.round((i / picked.length) * 100) + '%';

      const canvas = await renderPageForOcr(item);
      const { data } = await worker.recognize(canvas);
      const text = (data && data.text ? data.text : '').trim();
      const pageNo = pages.findIndex((p) => p.id === item.id) + 1;
      chapters.push(`--- 第 ${pageNo} 页 ---\n${text || '（未识别到文字）'}`);
      textArea.value = chapters.join('\n\n');
      bar.style.width = Math.round(((i + 1) / picked.length) * 100) + '%';
      canvas.width = canvas.height = 0;
    }

    status.textContent = ocrCancelled ? '已停止' : `完成，共 ${chapters.length} 页`;
    if (chapters.length) resultBox.hidden = false;
  } catch (err) {
    toast('识别失败：' + (err.message || err), true);
    status.textContent = '识别失败';
  } finally {
    busy = false;
    btn.disabled = false;
    cancelBtn.hidden = true;
  }
}

/* --- 事件绑定 ------------------------------------------------------------ */

dropEl.addEventListener('click', () => fileInput.click());
dropEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((t) => {
  dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.add('is-over'); });
});
['dragleave', 'drop'].forEach((t) => {
  dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.remove('is-over'); });
});
dropEl.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// 整页拖入也接受
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  if (e.target.closest('.page')) return;
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

pagesEl.addEventListener('click', (e) => {
  const card = e.target.closest('.page');
  if (!card) return;
  toggleSelect(card, e.ctrlKey || e.metaKey || e.shiftKey);
});

$('btnSelectAll').addEventListener('click', () => {
  pages.forEach((p) => selected.add(p.id));
  syncSelection();
});

$('btnInvert').addEventListener('click', () => {
  pages.forEach((p) => {
    if (selected.has(p.id)) selected.delete(p.id);
    else selected.add(p.id);
  });
  syncSelection();
});

$('btnMoveLeft').addEventListener('click', () => moveSelection(-1));
$('btnMoveRight').addEventListener('click', () => moveSelection(1));
$('btnRotate').addEventListener('click', rotateSelection);
$('btnDelete').addEventListener('click', deleteSelection);
$('btnClear').addEventListener('click', () => {
  if (pages.length && !confirm('清空已载入的所有页？')) return;
  clearAll();
});

$('btnExport').addEventListener('click', exportPdf);
$('btnSplit').addEventListener('click', splitPdf);
$('btnOcr').addEventListener('click', runOcr);
$('btnOcrCancel').addEventListener('click', () => { ocrCancelled = true; });

$('btnCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('ocrText').value);
    toast('已复制');
  } catch {
    $('ocrText').select();
    toast('请按 Ctrl+C 复制');
  }
});

$('btnDownloadTxt').addEventListener('click', () => {
  const text = $('ocrText').value;
  if (!text) return;
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${baseName()}-文字.txt`);
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('is-active', p.id === tab.dataset.panel);
    });
  });
});

document.querySelectorAll('input[name="splitMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    $('rangeField').hidden = mode !== 'range';
    $('everyField').hidden = mode !== 'every';
    $('splitHint').textContent = mode === 'range'
      ? '每个范围生成一个文件，打包成 zip 下载。'
      : mode === 'every'
        ? '按顺序每 N 页切一份，打包成 zip 下载。'
        : '每页单独一个文件，打包成 zip 下载。';
  });
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
    e.preventDefault();
    deleteSelection();
  }
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    pages.forEach((p) => selected.add(p.id));
    syncSelection();
  }
});

/* --- 测试钩子（仅 ?debug=1 时暴露，不影响正常使用）----------------------- */

if (new URLSearchParams(location.search).has('debug')) {
  window.__pfd = {
    get pages() { return pages; },
    get docs() { return docs; },
    addFiles,
    buildPdf,
    parseRanges,
    rotateSelection,
    deleteSelection,
    exportPdf,
    splitPdf,
    runOcr
  };
}
