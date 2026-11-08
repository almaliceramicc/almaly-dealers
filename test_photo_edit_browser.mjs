/* Браузер: кисть по координатам мыши и пальца, масштаб, PNG, смена кадра, отмена, CORS. */
import { createServer } from 'http';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { deflateSync, crc32 } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(root, 'docs');
const artDir = '/opt/cursor/artifacts';
mkdirSync(artDir, { recursive: true });

const pngChunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
};
const makePng = (w, h, rgb) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      const i = row + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
const redPng = makePng(48, 32, () => [200, 20, 20]);
const greenPng = makePng(48, 32, () => [20, 170, 40]);

const harness = `<!doctype html>
<html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Кисть</title>
<link rel="stylesheet" href="/style.css">
<body>
<img id="sentinel" alt="" src="/fallback.png" width="48" height="32">
<script src="/photo-edit.js"></script>
<script>
window.__confirmYes = true;
window.__lastConfirm = '';
window.confirm = (m) => { window.__lastConfirm = String(m); return window.__confirmYes !== false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitCanvas() {
  for (let i = 0; i < 80; i++) {
    const c = document.getElementById('pe-canvas');
    if (c && c.dataset.peReady === '1' && c.width > 0 && c.getBoundingClientRect().width > 8) return c;
    await sleep(40);
  }
  throw new Error('холст не появился');
}
function fire(type, x, y, pid, pointerType) {
  document.getElementById('pe-stage').dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: pid, pointerType, bubbles: true, cancelable: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true,
  }));
}
function clientAt(canvas, rect, ix, iy) {
  return {
    x: rect.left + ix * rect.width / canvas.width,
    y: rect.top + iy * rect.height / canvas.height,
  };
}
async function openBlob(blob, extra) {
  const url = URL.createObjectURL(blob);
  openPhotoEditor(Object.assign({src: url, title: 'Проверка', art: 'TEST'}, extra));
  const canvas = await waitCanvas();
  return {url, canvas};
}
function pattern(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, on = (x + y) & 1;
    img.data[i] = on ? 220 : 30;
    img.data[i + 1] = 50;
    img.data[i + 2] = on ? 40 : 210;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new Promise(res => c.toBlob(b => res({blob: b, pixels: new Uint8ClampedArray(img.data), w, h}), 'image/png'));
}
function tile() {
  const w = 900, h = 1200;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#e7d7c0'); grd.addColorStop(1, '#cbb89a');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8d7358'; g.lineWidth = 3;
  for (let y = 0; y <= h; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let x = 0; x <= w; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.fillStyle = '#143056'; g.fillRect(36, 36, 460, 132);
  g.fillStyle = '#fff'; g.font = 'bold 46px sans-serif'; g.fillText('NORTHWIND', 56, 98);
  g.font = '28px sans-serif'; g.fillText('EXAMPLE TILE CO', 56, 142);
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
window.openDemo = async () => {
  const blob = await tile();
  await openBlob(blob, {title: 'Пример, вымышленный логотип', art: 'EXAMPLE', onDraft() {}});
  return document.getElementById('pe-title').textContent;
};
window.paintLogo = () => {
  const canvas = document.getElementById('pe-canvas');
  const ctx = canvas.getContext('2d');
  const far = ctx.getImageData(canvas.width - 8, canvas.height - 8, 1, 1).data.slice();
  const mid = ctx.getImageData(200, 100, 1, 1).data.slice();
  document.getElementById('pe-size').value = '72';
  document.getElementById('pe-size').dispatchEvent(new Event('input'));
  document.getElementById('pe-strength').value = '16';
  document.getElementById('pe-strength').dispatchEvent(new Event('input'));
  const rect = canvas.getBoundingClientRect();
  const path = [];
  for (let x = 70; x <= 430; x += 36) path.push(clientAt(canvas, rect, x, 100));
  fire('pointerdown', path[0].x, path[0].y, 1, 'mouse');
  for (let i = 1; i < path.length; i++) fire('pointermove', path[i].x, path[i].y, 1, 'mouse');
  fire('pointerup', path[path.length - 1].x, path[path.length - 1].y, 1, 'mouse');
  const far2 = ctx.getImageData(canvas.width - 8, canvas.height - 8, 1, 1).data;
  const mid2 = ctx.getImageData(200, 100, 1, 1).data;
  const grid = ctx.getImageData(8, 400, 1, 1).data;
  const grid0 = [0, 0, 0, 0];
  return {
    farIdentical: [...far].every((v, i) => v === far2[i]),
    logoChanged: [...mid].some((v, i) => i < 3 && v !== mid2[i]),
    blurTool: document.getElementById('pe-tool-blur').getAttribute('aria-pressed') === 'true',
    midBefore: [...mid], midAfter: [...mid2], far: [...far2], grid: [...grid],
  };
};
window.showCors = async () => {
  openPhotoEditor({src: 'http://127.0.0.1:' + window.__imgPort + '/nocors.png', title: 'Чужой адрес'});
  for (let i = 0; i < 40; i++) {
    const box = document.getElementById('pe-cors');
    if (box && !box.hidden && box.textContent.includes('CORS')) return box.textContent;
    await sleep(40);
  }
  throw new Error('нет сообщения CORS');
};
window.runTests = async () => {
  const fail = [];
  const check = (name, ok, extra) => { if (!ok) fail.push(name + (extra ? ' ' + extra : '')); };
  const sentinelSrc = document.getElementById('sentinel').src;
  try {
    const pat = await pattern(240, 180);
    let drafts = 0;
    await openBlob(pat.blob, {onDraft(file) { drafts++; window.__draft = file; }});
    const canvas = document.getElementById('pe-canvas');
    check('размер', canvas.width === 240 && canvas.height === 180, canvas.width + 'x' + canvas.height);
    check('размытие включено', document.getElementById('pe-tool-blur').getAttribute('aria-pressed') === 'true');
    check('сила', document.getElementById('pe-strength').value === '14');
    document.getElementById('pe-size').value = '22';
    document.getElementById('pe-size').dispatchEvent(new Event('input'));
    document.getElementById('pe-strength').value = '5';
    document.getElementById('pe-strength').dispatchEvent(new Event('input'));

    async function stroke(ix, iy, pointerType, pid) {
      const c = document.getElementById('pe-canvas');
      const rect = c.getBoundingClientRect();
      const pt = clientAt(c, rect, ix, iy);
      const mapped = PE.peViewToImage(pt.x, pt.y, rect, c.width, c.height);
      fire('pointerdown', pt.x, pt.y, pid, pointerType);
      fire('pointerup', pt.x, pt.y, pid, pointerType);
      return mapped;
    }
    const mapped = await stroke(60, 40, 'mouse', 1);
    const expect = PE.createPhotoSession(pat.w, pat.h, pat.pixels);
    expect.paint([mapped], 22, 'blur', 5);
    const got = canvas.getContext('2d').getImageData(0, 0, pat.w, pat.h).data;
    let mismatch = 0;
    for (let i = 0; i < got.length; i++) if (got[i] !== expect.pixels()[i]) mismatch++;
    check('мышь = расчёт', mismatch === 0, 'разница байт ' + mismatch);
    const far = (x, y) => {
      const i = (y * pat.w + x) * 4;
      return got[i] === pat.pixels[i] && got[i + 1] === pat.pixels[i + 1] && got[i + 2] === pat.pixels[i + 2];
    };
    check('угол цел', far(0, 0) && far(239, 179));
    const center = (x, y) => (y * pat.w + x) * 4;
    const ci = center(60, 40);
    check('центр размыт', got[ci] !== pat.pixels[ci]);
    check('не краска', got[ci] !== 255 || got[ci + 2] !== 0);

    const origClick = HTMLAnchorElement.prototype.click;
    let href = '';
    HTMLAnchorElement.prototype.click = function () { if (this.download) href = this.href; return origClick.apply(this, arguments); };
    document.getElementById('pe-png').click();
    for (let i = 0; i < 30 && !href; i++) await sleep(30);
    HTMLAnchorElement.prototype.click = origClick;
    const blob = await fetch(href).then(r => r.blob());
    check('png тип', blob.type === 'image/png', blob.type);
    const bmp = await createImageBitmap(blob);
    const oc = document.createElement('canvas');
    oc.width = bmp.width; oc.height = bmp.height;
    oc.getContext('2d').drawImage(bmp, 0, 0);
    const exp = oc.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data;
    let expDiff = 0;
    for (let i = 0; i < exp.length; i++) if (exp[i] !== got[i]) expDiff++;
    check('png = холст', bmp.width === 240 && expDiff === 0, 'diff ' + expDiff + ' ' + bmp.width);

    const painted = new Uint8ClampedArray(got);
    document.getElementById('pe-undo').click();
    const undone = canvas.getContext('2d').getImageData(0, 0, 240, 180).data;
    let undoDiff = 0;
    for (let i = 0; i < undone.length; i++) if (undone[i] !== pat.pixels[i]) undoDiff++;
    check('назад', undoDiff === 0, String(undoDiff));
    document.getElementById('pe-redo').click();
    const redone = canvas.getContext('2d').getImageData(0, 0, 240, 180).data;
    let redoDiff = 0;
    for (let i = 0; i < redone.length; i++) if (redone[i] !== painted[i]) redoDiff++;
    check('вперёд', redoDiff === 0, String(redoDiff));

    document.getElementById('pe-zoom-in').click();
    document.getElementById('pe-zoom-in').click();
    const zrect = canvas.getBoundingClientRect();
    check('масштаб вырос', zrect.width > canvas.width * 0.2);
    const mappedT = await stroke(120, 90, 'touch', 4);
    const base = PE.createPhotoSession(pat.w, pat.h, painted);
    base.paint([mappedT], 22, 'blur', 5);
    const gotT = canvas.getContext('2d').getImageData(0, 0, 240, 180).data;
    let touchDiff = 0;
    for (let i = 0; i < gotT.length; i++) if (gotT[i] !== base.pixels()[i]) touchDiff++;
    check('палец после масштаба', touchDiff === 0, 'diff ' + touchDiff + ' zoom ' + Math.round(zrect.width));
    check('дальний угол после пальца', gotT[(179 * 240 + 239) * 4] === pat.pixels[(179 * 240 + 239) * 4]);

    document.getElementById('pe-tool-pick').click();
    const sample = clientAt(canvas, canvas.getBoundingClientRect(), 5, 5);
    fire('pointerdown', sample.x, sample.y, 3, 'mouse');
    fire('pointerup', sample.x, sample.y, 3, 'mouse');
    const pix = canvas.getContext('2d').getImageData(5, 5, 1, 1).data;
    const hex = PE.rgbToHex(pix[0], pix[1], pix[2]);
    check('пипетка', document.getElementById('pe-color').value.toLowerCase() === hex, document.getElementById('pe-color').value + ' vs ' + hex);
    check('после пипетки закраска', document.getElementById('pe-tool-color').getAttribute('aria-pressed') === 'true');
    document.getElementById('pe-color').value = '#ff0000';
    const beforeColor = canvas.getContext('2d').getImageData(0, 0, 1, 1).data.slice();
    const mappedC = await stroke(30, 30, 'mouse', 5);
    const colorPx = canvas.getContext('2d').getImageData(Math.round(mappedC.x), Math.round(mappedC.y), 1, 1).data;
    check('закраска красная', colorPx[0] === 255 && colorPx[1] === 0 && colorPx[2] === 0, [...colorPx].join(','));
    const corner = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
    check('закраска не весь кадр', [...corner].every((v, i) => v === beforeColor[i]));

    const solid = document.createElement('canvas');
    solid.width = 70; solid.height = 50;
    const sg = solid.getContext('2d');
    sg.fillStyle = '#00b428'; sg.fillRect(0, 0, 70, 50);
    const solidBlob = await new Promise(res => solid.toBlob(res, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([solidBlob], 'other.png', {type: 'image/png'}));
    const input = document.getElementById('pe-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await waitCanvas();
    check('смена кадра', canvas.width === 70 && canvas.height === 50, canvas.width + 'x' + canvas.height);
    const gpx = canvas.getContext('2d').getImageData(10, 10, 1, 1).data;
    check('новый кадр зелёный', gpx[1] > 140 && gpx[0] < 40, [...gpx].join(','));
    document.getElementById('pe-undo').click();
    const gpx2 = canvas.getContext('2d').getImageData(10, 10, 1, 1).data;
    check('назад не возвращает прошлый кадр', gpx2[1] > 140 && canvas.width === 70);

    const big = await pattern(1600, 1100);
    const t0 = performance.now();
    await openBlob(big.blob, {});
    document.getElementById('pe-size').value = '40';
    document.getElementById('pe-strength').value = '8';
    await stroke(80, 70, 'mouse', 8);
    const dtMs = Math.round(performance.now() - t0);
    const bc = document.getElementById('pe-canvas');
    const bctx = bc.getContext('2d');
    const bFar = bctx.getImageData(1500, 1000, 1, 1).data;
    const bHit = bctx.getImageData(80, 70, 1, 1).data;
    const origFarI = (1000 * 1600 + 1500) * 4;
    check('большой угол', bFar[0] === big.pixels[origFarI] && bFar[2] === big.pixels[origFarI + 2], [...bFar].join(','));
    const origHitI = (70 * 1600 + 80) * 4;
    check('большой мазок', bHit[0] !== big.pixels[origHitI], dtMs + 'ms');
    check('большой не весь', bctx.getImageData(1500, 80, 1, 1).data[0] === big.pixels[(80 * 1600 + 1500) * 4]);

    let drafted = 0;
    const again = await pattern(80, 60);
    await openBlob(again.blob, {onDraft() { drafted++; }});
    document.getElementById('pe-size').value = '16';
    await stroke(20, 20, 'mouse', 9);
    window.__confirmYes = false;
    document.getElementById('pe-cancel').click();
    check('отмена с отказом', !!document.getElementById('pe-dialog') && window.__lastConfirm.includes('каталоге'));
    window.__confirmYes = true;
    document.getElementById('pe-cancel').click();
    check('отмена закрыла', !document.getElementById('pe-dialog'));
    check('отмена не кладёт в черновик', drafted === 0);
    check('сторож', document.getElementById('sentinel').src === sentinelSrc);

    openPhotoEditor({src: 'http://127.0.0.1:' + window.__imgPort + '/nocors.png'});
    let cors = '';
    for (let i = 0; i < 40; i++) {
      const box = document.getElementById('pe-cors');
      if (box && !box.hidden && /CORS/.test(box.textContent)) { cors = box.textContent; break; }
      await sleep(40);
    }
    check('cors текст', /Свой файл/.test(cors) && /не измен/.test(cors), cors.slice(0, 180));
    check('cors без холста', document.getElementById('pe-canvas').width === 0);

    openPhotoEditor({src: 'http://127.0.0.1:' + window.__imgPort + '/cors.png'});
    await waitCanvas();
    const red = document.getElementById('pe-canvas').getContext('2d').getImageData(4, 4, 1, 1).data;
    check('cors разрешён', red[0] > 180 && red[1] < 40, [...red].join(','));

    openPhotoEditor({
      src: 'http://127.0.0.1:' + window.__imgPort + '/nocors.png',
      fallbackSrc: '/fallback.png',
    });
    await waitCanvas();
    const note = document.getElementById('pe-fallback-note');
    const gp = document.getElementById('pe-canvas').getContext('2d').getImageData(4, 4, 1, 1).data;
    check('запасной адрес', note && !note.hidden && /CORS/.test(note.textContent) && gp[1] > 140, (note && note.textContent || '') + [...gp].join(','));
  } catch (e) {
    fail.push('исключение ' + (e && e.stack || e));
  }
  return fail;
};
</script>
`;

function listen(port, handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml'};

const page = await listen(0, (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/harness.html') {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    res.end(harness);
    return;
  }
  if (url.pathname === '/fallback.png') {
    res.writeHead(200, {'content-type': 'image/png', 'cache-control': 'no-store'});
    res.end(greenPng);
    return;
  }
  const file = path.normalize(path.join(docs, decodeURIComponent(url.pathname)));
  if (!file.startsWith(docs) || !exists(file)) { res.writeHead(404); res.end('no'); return; }
  const ext = path.extname(file);
  res.writeHead(200, {'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store'});
  res.end(readFileSync(file));
});
function exists(p) { try { readFileSync(p); return true; } catch { return false; } }

const images = await listen(0, (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const body = url.pathname === '/cors.png' ? redPng : redPng;
  const headers = {'content-type': 'image/png', 'cache-control': 'no-store'};
  if (url.pathname === '/cors.png') headers['access-control-allow-origin'] = '*';
  if (url.pathname === '/nocors.png' || url.pathname === '/cors.png') {
    res.writeHead(200, headers); res.end(body); return;
  }
  res.writeHead(404); res.end('no');
});
const pagePort = page.address().port;
const imgPort = images.address().port;

rmSync('/tmp/pe-chrome', {recursive: true, force: true});
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--window-size=1400,1000',
  '--remote-debugging-port=9222', '--user-data-dir=/tmp/pe-chrome', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});
let chromeLog = '';
chrome.stderr.on('data', d => { chromeLog += d; });

async function waitJson(url) {
  for (let i = 0; i < 50; i++) {
    try { return await fetch(url).then(r => r.json()); }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('chrome не поднялся\n' + chromeLog);
}
const ver = await waitJson('http://127.0.0.1:9222/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  } else if (msg.method) events.push(msg);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, {resolve, reject});
  ws.send(JSON.stringify({id, method, params}));
});
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, {resolve, reject});
  ws.send(JSON.stringify({id, method, params, sessionId}));
});
await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', {width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false});

async function go(url) {
  await call('Page.navigate', {url});
  for (let i = 0; i < 50; i++) {
    const state = await call('Runtime.evaluate', {expression: 'document.readyState', returnByValue: true});
    if (state.result.value === 'complete') return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('страница не загрузилась ' + url);
}
async function ev(expression, awaitPromise = false) {
  const result = await call('Runtime.evaluate', {expression, awaitPromise, returnByValue: true});
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 2000));
  return result.result.value;
}
async function shot(name) {
  const {data} = await call('Page.captureScreenshot', {format: 'png'});
  const file = path.join(artDir, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('shot', file);
}

const failures = [];
try {
  await go(`http://127.0.0.1:${pagePort}/harness.html`);
  await ev(`window.__imgPort = ${imgPort}`);
  console.log('demo', await ev('window.openDemo()', true));
  await shot('photo-editor-before.png');
  const paint = await ev('window.paintLogo()', true);
  console.log('paint', JSON.stringify(paint));
  if (!paint.farIdentical || !paint.logoChanged || !paint.blurTool) failures.push('демо-мазок ' + JSON.stringify(paint));
  await shot('photo-editor-after.png');

  await call('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
  await ev('window.openDemo()', true);
  await shot('photo-editor-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', {width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false});

  console.log('cors', await ev('window.showCors()', true));
  await shot('photo-editor-cors.png');

  const found = await ev('window.runTests()', true);
  if (found && found.length) failures.push(...found);

  await go(`http://127.0.0.1:${pagePort}/admin.html`);
  const gate = await ev(`({
    pe: !!document.getElementById('pe-dialog'),
    appHidden: document.getElementById('app').hidden,
    editorHidden: document.getElementById('ed-app').hidden
  })`);
  console.log('gate', JSON.stringify(gate));
  if (gate.pe || !gate.appHidden || !gate.editorHidden) failures.push('кисть видна до входа ' + JSON.stringify(gate));
  await shot('photo-editor-login.png');
  await ev('showPanel()');
  const orders = await ev(`({
    pe: !!document.getElementById('pe-dialog'),
    orders: !document.getElementById('tab-orders').hidden,
    editBtn: !!document.querySelector('[data-eact=edit]')
  })`);
  console.log('orders', JSON.stringify(orders));
  if (orders.pe || !orders.orders || orders.editBtn) failures.push('кисть на заявках ' + JSON.stringify(orders));
  await shot('photo-editor-orders.png');
  await ev(`document.querySelector('.tab[data-tab=editor]').click()`);
  const ed = await ev(`({
    token: !!document.getElementById('ed-token'),
    appHidden: document.getElementById('ed-app').hidden,
    pe: !!document.getElementById('pe-dialog'),
    editBtn: !!document.querySelector('[data-eact=edit]')
  })`);
  console.log('editor-gate', JSON.stringify(ed));
  if (!ed.token || !ed.appHidden || ed.pe || ed.editBtn) failures.push('кисть без токена ' + JSON.stringify(ed));
  await shot('photo-editor-token-gate.png');
} catch (e) {
  failures.push(String(e.stack || e));
  try { await shot('photo-editor-error.png'); } catch {}
} finally {
  chrome.kill();
  page.close();
  images.close();
  ws.close();
}

if (failures.length) {
  console.error('FAIL');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log('browser ok');
