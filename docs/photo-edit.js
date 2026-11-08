/* Кисть по снимку: размытие только под мазком и закраска цветом.
   «Сохранить» пишет новый файл и меняет ссылку только этого кадра.
   Прежний файл не удаляется. «Скачать» — копия на компьютер.
   «Копия в черновик» — отдельный снимок, не замена. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PE = api;
  root.openPhotoEditor = api.openPhotoEditor;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ponytail: длинная сторона режется на 4096, в истории не больше 8 кадров.
  // Полный RAW и длинная история — если понадобится править исходники крупнее.
  const MAX_EDGE = 4096;
  const HIST = 8;

  function boxH(src, dst, w, h, r) {
    const win = r * 2 + 1, inv = 1 / win;
    for (let y = 0; y < h; y++) {
      let s0 = 0, s1 = 0, s2 = 0;
      const row = y * w;
      for (let k = -r; k <= r; k++) {
        const x = k < 0 ? 0 : (k >= w ? w - 1 : k);
        const i = (row + x) * 3;
        s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2];
      }
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 3;
        dst[o] = s0 * inv; dst[o + 1] = s1 * inv; dst[o + 2] = s2 * inv;
        const xr = x - r < 0 ? 0 : x - r;
        const xa = x + r + 1 >= w ? w - 1 : x + r + 1;
        const ir = (row + xr) * 3, ia = (row + xa) * 3;
        s0 += src[ia] - src[ir];
        s1 += src[ia + 1] - src[ir + 1];
        s2 += src[ia + 2] - src[ir + 2];
      }
    }
  }

  function boxV(src, dst, w, h, r) {
    const win = r * 2 + 1, inv = 1 / win;
    for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let k = -r; k <= r; k++) {
        const y = k < 0 ? 0 : (k >= h ? h - 1 : k);
        const i = (y * w + x) * 3;
        s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2];
      }
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 3;
        dst[o] = s0 * inv; dst[o + 1] = s1 * inv; dst[o + 2] = s2 * inv;
        const yr = y - r < 0 ? 0 : y - r;
        const ya = y + r + 1 >= h ? h - 1 : y + r + 1;
        const ir = (yr * w + x) * 3, ia = (ya * w + x) * 3;
        s0 += src[ia] - src[ir];
        s1 += src[ia + 1] - src[ir + 1];
        s2 += src[ia + 2] - src[ir + 2];
      }
    }
  }

  /** Три прохода прямоугольного размытия. Альфа исходника сохраняется. */
  function peBlur(src, w, h, radius) {
    const r = Math.max(1, radius | 0);
    const n = w * h;
    let a = new Float32Array(n * 3), b = new Float32Array(n * 3);
    for (let p = 0, i = 0; p < src.length; p += 4, i += 3) {
      a[i] = src[p]; a[i + 1] = src[p + 1]; a[i + 2] = src[p + 2];
    }
    for (let pass = 0; pass < 3; pass++) {
      boxH(a, b, w, h, r);
      boxV(b, a, w, h, r);
    }
    const out = new Uint8ClampedArray(src.length);
    for (let p = 0, i = 0; p < out.length; p += 4, i += 3) {
      out[p] = Math.round(a[i]);
      out[p + 1] = Math.round(a[i + 1]);
      out[p + 2] = Math.round(a[i + 2]);
      out[p + 3] = src[p + 3];
    }
    return out;
  }

  function peStampDisc(mask, w, h, x, y, rad) {
    const r2 = rad * rad;
    const x0 = Math.max(0, Math.floor(x - rad));
    const y0 = Math.max(0, Math.floor(y - rad));
    const x1 = Math.min(w - 1, Math.ceil(x + rad));
    const y1 = Math.min(h - 1, Math.ceil(y + rad));
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - y;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        if (dx * dx + dy * dy <= r2) mask[yy * w + xx] = 255;
      }
    }
    return {x0, y0, x1, y1};
  }

  function peApply(base, effect, mask) {
    const out = new Uint8ClampedArray(base);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      out[i] = effect[i]; out[i + 1] = effect[i + 1]; out[i + 2] = effect[i + 2]; out[i + 3] = effect[i + 3];
    }
    return out;
  }

  function peApplyColor(base, mask, r, g, b) {
    const out = new Uint8ClampedArray(base);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = base[i + 3];
    }
    return out;
  }

  function peViewToImage(clientX, clientY, rect, imgW, imgH) {
    return {
      x: (clientX - rect.left) * (imgW / rect.width),
      y: (clientY - rect.top) * (imgH / rect.height),
    };
  }

  function peInterpolate(x0, y0, x1, y1, step) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / Math.max(step, 0.5)));
    const pts = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push({x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t});
    }
    return pts;
  }

  function maskAny(mask) {
    for (let i = 0; i < mask.length; i++) if (mask[i]) return true;
    return false;
  }

  function createPhotoSession(w, h, pixels) {
    if (pixels.length !== w * h * 4) throw new Error('size');
    let W = w, H = h;
    let cur = new Uint8ClampedArray(pixels);
    let original = new Uint8ClampedArray(pixels);
    const undo = [], redo = [];

    function pushUndo() {
      redo.length = 0;
      undo.push(new Uint8ClampedArray(cur));
      while (undo.length > HIST) undo.shift();
    }

    return {
      get w() { return W; },
      get h() { return H; },
      pixels() { return new Uint8ClampedArray(cur); },
      canUndo() { return undo.length > 0; },
      canRedo() { return redo.length > 0; },
      undo() {
        if (!undo.length) return false;
        redo.push(cur);
        cur = undo.pop();
        return true;
      },
      redo() {
        if (!redo.length) return false;
        undo.push(cur);
        cur = redo.pop();
        return true;
      },
      reset() {
        cur = new Uint8ClampedArray(original);
        undo.length = 0;
        redo.length = 0;
      },
      commitEffect(mask, effect) {
        if (!maskAny(mask)) return false;
        pushUndo();
        cur = peApply(cur, effect, mask);
        return true;
      },
      commitColor(mask, r, g, b) {
        if (!maskAny(mask)) return false;
        pushUndo();
        cur = peApplyColor(cur, mask, r, g, b);
        return true;
      },
      paint(points, diameter, mode, strength, color) {
        const mask = new Uint8Array(W * H);
        const rad = diameter / 2;
        for (const p of points) peStampDisc(mask, W, H, p.x, p.y, rad);
        if (mode === 'color') return this.commitColor(mask, color[0], color[1], color[2]);
        return this.commitEffect(mask, peBlur(cur, W, H, strength));
      },
      load(w2, h2, px) {
        if (px.length !== w2 * h2 * 4) throw new Error('size');
        W = w2; H = h2;
        cur = new Uint8ClampedArray(px);
        original = new Uint8ClampedArray(px);
        undo.length = 0;
        redo.length = 0;
      },
      baseline() { return new Uint8ClampedArray(original); },
      markSaved() {
        original = new Uint8ClampedArray(cur);
        undo.length = 0;
        redo.length = 0;
      },
    };
  }

  function peEditStem(from, nonce) {
    const base = String(from || 'p').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'p';
    const id = nonce || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    return (base + 'e' + String(id).replace(/[^A-Za-z0-9]/g, '')).slice(0, 40);
  }

  function peSafePart(value) {
    return typeof value === 'string' && !!value && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..';
  }

  function peLocateSlot(photos, from, stem) {
    if (!Array.isArray(photos)) return null;
    const atFrom = photos.indexOf(from);
    const atStem = photos.indexOf(stem);
    if (atFrom >= 0 && atStem >= 0) return {conflict: true};
    if (atStem >= 0) return {index: atStem, cur: stem};
    if (atFrom >= 0) return {index: atFrom, cur: from};
    return null;
  }

  /** Меняет только ссылку одного кадра. Чужие карточки, порядок и прочие поля не трогает. */
  function peApplySlot(text, job) {
    if (!peSafePart(job.art) || !peSafePart(job.from) || !peSafePart(job.stem)) {
      const e = new Error('Некорректное имя снимка'); e.code = 'conflict'; throw e;
    }
    const data = JSON.parse(text);
    const tile = (data.tiles || []).find(t => t.art === job.art);
    if (!tile) { const e = new Error('Карточку уже убрали из каталога'); e.code = 'gone'; throw e; }
    const found = peLocateSlot(tile.photos, job.from, job.stem);
    if (!found || found.conflict) {
      const e = new Error('Этот кадр в каталоге уже заменили другим файлом. Откройте его заново. Запись не сделана.');
      e.code = 'conflict'; throw e;
    }
    if (found.cur === job.stem) return {changed: false, text, index: found.index, photos: tile.photos.slice()};
    tile.photos[found.index] = job.stem;
    return {changed: true, text: JSON.stringify(data, null, 1), index: found.index, photos: tile.photos.slice()};
  }

  /**
   * Запись одного кадра: новый файл и миниатюра, в каталоге меняется только ссылка.
   * Успех — только после commit или если на сервере уже лежит тот же файл.
   * Повтор использует тот же stem и не добавляет второй кадр.
   */
  async function peRunSlotSave(io, job) {
    if (!job || !job.from) { const e = new Error('Этот файл не привязан к снимку в каталоге'); e.code = 'no-slot'; throw e; }
    if (job.busy) return {status: 'busy'};
    job.busy = true;
    try {
      const full = await io.blob(job.fullB64);
      const thumb = await io.blob(job.thumbB64);
      const raw = await io.readData();
      const looked = peApplySlot(raw, job);
      if (!looked.changed) {
        const remote = await io.fileShas(job.art, job.stem);
        if (remote && remote.full === full.sha && remote.thumb === thumb.sha) {
          return {status: 'saved', commit: false, photos: looked.photos, stem: job.stem, fullSha: full.sha, thumbSha: thumb.sha};
        }
      }
      const ops = [
        {path: `docs/img/${job.art}/${job.stem}.jpg`, sha: full.sha},
        {path: `docs/img/${job.art}/${job.stem}_t.jpg`, sha: thumb.sha},
      ];
      const texts = await io.commit(`Фото ${job.art}: кадр ${job.from} → ${job.stem}`, ops, [{
        path: 'docs/data.json',
        apply: s => peApplySlot(s, job).text,
      }]);
      const after = JSON.parse(texts['docs/data.json']);
      const tile = (after.tiles || []).find(t => t.art === job.art);
      if (!tile || !tile.photos.includes(job.stem)) throw new Error('каталог не подтвердил этот кадр');
      if (tile.photos.includes(job.from)) throw new Error('старая ссылка осталась в карточке');
      return {status: 'saved', commit: true, photos: tile.photos.slice(), stem: job.stem, fullSha: full.sha, thumbSha: thumb.sha, ops};
    } finally { job.busy = false; }
  }

  function peIndexImageTree(entries) {
    const shas = {};
    for (const x of entries || []) {
      if (x.type && x.type !== 'blob') continue;
      const m = String(x.path || '').match(/^docs\/img\/([^/]+)\/([^/]+?)(_t)?\.jpg$/);
      if (!m || !/^[A-Za-z0-9_-]{1,40}$/.test(m[2])) continue;
      const item = ((shas[m[1]] ||= {})[m[2]] ||= {});
      if (m[3]) item.thumbSha = x.sha; else item.sha = x.sha;
    }
    return shas;
  }

  function peGalleryFiles(tiles, shas) {
    const out = {};
    for (const t of tiles || []) {
      const bag = (shas && shas[t.art]) || {};
      out[t.art] = (t.photos || []).map(stem => {
        const hit = bag[stem] || {};
        const item = {f: stem + '.jpg'};
        if (hit.sha) item.sha = hit.sha;
        if (hit.thumbSha) item.thumbSha = hit.thumbSha;
        return item;
      });
    }
    return out;
  }

  function hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function openPhotoEditor(opts) {
    opts = opts || {};
    if (typeof globalThis.__peClose === 'function') globalThis.__peClose(true);
    document.body.classList.add('pe-open');

    const back = document.createElement('div');
    back.className = 'pe-back';
    back.id = 'pe-back';
    back.innerHTML = `
      <div class="pe" id="pe-dialog" role="dialog" aria-modal="true" aria-labelledby="pe-title">
        <div class="pe-hd">
          <h2 id="pe-title">Редактор фото</h2>
          <p class="pe-note" id="pe-note"></p>
        </div>
        <div class="pe-tools">
          <div class="chips" role="group" aria-label="Инструмент">
            <button type="button" class="chip" id="pe-tool-blur" aria-pressed="true">Размытие</button>
            <button type="button" class="chip" id="pe-tool-color" aria-pressed="false">Закраска</button>
            <button type="button" class="chip" id="pe-tool-pick" aria-pressed="false">Пипетка</button>
          </div>
          <label>Диаметр <input type="range" id="pe-size" min="4" max="400" value="48"> <b id="pe-size-val">48 px</b></label>
          <label>Сила размытия <input type="range" id="pe-strength" min="1" max="40" value="14"> <b id="pe-strength-val">14</b></label>
          <label>Цвет <input type="color" id="pe-color" value="#d7cfc3"></label>
          <button type="button" class="btn sm" id="pe-undo" disabled>Назад</button>
          <button type="button" class="btn sm" id="pe-redo" disabled>Вперёд</button>
          <button type="button" class="btn sm" id="pe-reset" disabled>Сброс</button>
          <button type="button" class="btn sm" id="pe-zoom-out" aria-label="Уменьшить">−</button>
          <b id="pe-zoom-label">100%</b>
          <button type="button" class="btn sm" id="pe-zoom-in" aria-label="Увеличить">+</button>
          <button type="button" class="btn sm" id="pe-fit">Вписать</button>
          <label class="btn sm">Свой файл<input type="file" id="pe-file" accept="image/*" hidden></label>
        </div>
        <p class="pe-warn" id="pe-scale-note" hidden></p>
        <p class="pe-warn" id="pe-fallback-note" hidden></p>
        <div class="pe-cors" id="pe-cors" hidden></div>
        <p class="pe-status" id="pe-status" role="status"></p>
        <div class="pe-stage" id="pe-stage"><canvas id="pe-canvas"></canvas></div>
        <div class="pe-actions">
          <button type="button" class="btn" id="pe-cancel">Отмена</button>
          <span class="right">
            <button type="button" class="btn primary" id="pe-save" hidden>Сохранить</button>
            <button type="button" class="btn" id="pe-jpg" disabled>Скачать JPEG</button>
            <button type="button" class="btn" id="pe-png" disabled>Скачать PNG</button>
            <button type="button" class="btn" id="pe-draft" hidden>Копия в черновик</button>
          </span>
        </div>
        <p class="pe-save-note" id="pe-save-note" hidden>Этот файл не привязан к снимку в каталоге. «Сохранить» его некуда — скачайте копию. Каталог сам не выбирается.</p>
      </div>`;
    document.body.appendChild(back);
    const ring = document.createElement('div');
    ring.id = 'pe-ring';
    ring.hidden = true;
    document.body.appendChild(ring);

    const $ = id => document.getElementById(id);
    const canvas = $('pe-canvas');
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const stage = $('pe-stage');
    const title = opts.title ? 'Редактор фото — ' + opts.title : 'Редактор фото';
    $('pe-title').textContent = title;
    const slotOk = !!(opts.slot && opts.slot.from);
    $('pe-note').textContent = slotOk
      ? 'Размытие действует только на мазок. «Сохранить» записывает этот кадр в ту же позицию карточки новым файлом и не удаляет прежний. Страница на сайте обновится через 1–2 минуты — это ещё не открытие у всех. «Скачать» кладёт копию только на компьютер.'
      : 'Размытие действует только на мазок. Этот файл не из карточки: «Сохранить» его некуда, каталог сам не выбирается. Можно скачать копию.';
    $('pe-draft').hidden = !opts.onDraft;

    let session = null;
    let tool = 'blur';
    let zoom = 1;
    let stroke = null;
    let dirty = false;
    let saving = false;
    const pointers = new Map();
    let pinch = null;
    const onKey = e => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) {
        if (e.key === 'Escape') { e.preventDefault(); closeAsk(); }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    };
    document.addEventListener('keydown', onKey);

    function setTool(next) {
      tool = next;
      for (const name of ['blur', 'color', 'pick']) {
        $('pe-tool-' + name).setAttribute('aria-pressed', name === tool ? 'true' : 'false');
      }
      $('pe-strength').disabled = tool !== 'blur';
      canvas.style.cursor = tool === 'pick' ? 'crosshair' : 'none';
      if (tool === 'pick') ring.hidden = true;
    }

    function sameBytes(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    function refreshDirty() {
      dirty = !!(session && !sameBytes(session.pixels(), session.baseline()));
    }
    function syncHist() {
      const on = !!session;
      const slotOk = !!(opts.slot && opts.slot.from);
      $('pe-undo').disabled = !on || !session.canUndo();
      $('pe-redo').disabled = !on || !session.canRedo();
      $('pe-reset').disabled = !on || !dirty;
      $('pe-jpg').disabled = !on;
      $('pe-png').disabled = !on;
      $('pe-draft').disabled = !on;
      $('pe-save').hidden = !(dirty && slotOk);
      $('pe-save').disabled = saving || !dirty;
      $('pe-save-note').hidden = !(dirty && !slotOk);
    }

    function paintCanvas(px, w, h) {
      canvas.width = w;
      canvas.height = h;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    }

    function redraw() {
      if (!session) return;
      paintCanvas(session.pixels(), session.w, session.h);
      applyZoomStyle();
    }

    function applyZoomStyle() {
      if (!session) return;
      canvas.style.width = Math.round(session.w * zoom) + 'px';
      canvas.style.height = Math.round(session.h * zoom) + 'px';
      $('pe-zoom-label').textContent = Math.round(zoom * 100) + '%';
    }

    function fit() {
      if (!session) return;
      const sw = Math.max(40, stage.clientWidth - 2);
      const sh = Math.max(40, stage.clientHeight - 2);
      zoom = Math.min(sw / session.w, sh / session.h);
      zoom = Math.min(4, Math.max(0.05, zoom));
      applyZoomStyle();
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }

    function setZoom(next, anchorX, anchorY) {
      if (!session) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) { zoom = next; applyZoomStyle(); return; }
      const ix = (anchorX - rect.left) * (session.w / rect.width);
      const iy = (anchorY - rect.top) * (session.h / rect.height);
      zoom = Math.min(6, Math.max(0.15, next));
      applyZoomStyle();
      const rect2 = canvas.getBoundingClientRect();
      stage.scrollLeft += (rect2.left + ix * rect2.width / session.w) - anchorX;
      stage.scrollTop += (rect2.top + iy * rect2.height / session.h) - anchorY;
    }

    function pointFrom(e) {
      const rect = canvas.getBoundingClientRect();
      return peViewToImage(e.clientX, e.clientY, rect, session.w, session.h);
    }

    function moveRing(e) {
      if (!session || tool === 'pick' || pinch) { ring.hidden = true; return; }
      const rect = canvas.getBoundingClientRect();
      const d = +$('pe-size').value * rect.width / session.w;
      ring.style.width = d + 'px';
      ring.style.height = d + 'px';
      ring.style.left = (e.clientX - d / 2) + 'px';
      ring.style.top = (e.clientY - d / 2) + 'px';
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      ring.hidden = !inside && !stroke;
    }

    function blit(base, effect, mask, color, bounds) {
      let x0 = bounds.x0, y0 = bounds.y0, x1 = bounds.x1, y1 = bounds.y1;
      const w = session.w, h = session.h;
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 >= w) x1 = w - 1;
      if (y1 >= h) y1 = h - 1;
      if (x1 < x0 || y1 < y0) return;
      const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
      const img = ctx.createImageData(rw, rh);
      const d = img.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const mi = y * w + x;
          const si = mi * 4;
          const di = ((y - y0) * rw + (x - x0)) * 4;
          if (mask[mi]) {
            if (effect) {
              d[di] = effect[si]; d[di + 1] = effect[si + 1]; d[di + 2] = effect[si + 2]; d[di + 3] = effect[si + 3];
            } else {
              d[di] = color[0]; d[di + 1] = color[1]; d[di + 2] = color[2]; d[di + 3] = base[si + 3];
            }
          } else {
            d[di] = base[si]; d[di + 1] = base[si + 1]; d[di + 2] = base[si + 2]; d[di + 3] = base[si + 3];
          }
        }
      }
      ctx.putImageData(img, x0, y0);
    }

    function stampAt(pt, bounds) {
      const rad = +$('pe-size').value / 2;
      const b = peStampDisc(stroke.mask, session.w, session.h, pt.x, pt.y, rad);
      if (!bounds) return b;
      bounds.x0 = Math.min(bounds.x0, b.x0);
      bounds.y0 = Math.min(bounds.y0, b.y0);
      bounds.x1 = Math.max(bounds.x1, b.x1);
      bounds.y1 = Math.max(bounds.y1, b.y1);
      return bounds;
    }

    function beginStroke(e) {
      const pt = pointFrom(e);
      const base = session.pixels();
      stroke = {
        pid: e.pointerId,
        base,
        mask: new Uint8Array(session.w * session.h),
        effect: null,
        color: hexToRgb($('pe-color').value),
        tool,
        last: pt,
        strength: +$('pe-strength').value,
      };
      if (tool === 'blur') {
        $('pe-status').textContent = 'Считаю размытие…';
        stroke.effect = peBlur(base, session.w, session.h, stroke.strength);
        $('pe-status').textContent = '';
      }
      const b = stampAt(pt);
      blit(stroke.base, stroke.effect, stroke.mask, stroke.color, b);
    }

    function extendStroke(e) {
      const pt = pointFrom(e);
      const step = Math.max(1, +$('pe-size').value / 4);
      const pts = peInterpolate(stroke.last.x, stroke.last.y, pt.x, pt.y, step);
      let bounds = null;
      for (const p of pts) bounds = stampAt(p, bounds || {x0: Infinity, y0: Infinity, x1: -1, y1: -1});
      if (bounds) blit(stroke.base, stroke.effect, stroke.mask, stroke.color, bounds);
      stroke.last = pt;
    }

    function finishStroke() {
      if (!stroke) return;
      const s = stroke;
      stroke = null;
      let changed = false;
      if (s.tool === 'blur') changed = session.commitEffect(s.mask, s.effect);
      else changed = session.commitColor(s.mask, s.color[0], s.color[1], s.color[2]);
      if (changed) refreshDirty();
      redraw();
      syncHist();
    }

    function abortStroke() {
      if (!stroke) return;
      stroke = null;
      redraw();
    }

    function pickAt(e) {
      const pt = pointFrom(e);
      const x = Math.floor(pt.x), y = Math.floor(pt.y);
      if (x < 0 || y < 0 || x >= session.w || y >= session.h) return;
      const px = session.pixels();
      const i = (y * session.w + x) * 4;
      $('pe-color').value = rgbToHex(px[i], px[i + 1], px[i + 2]);
      setTool('color');
      $('pe-status').textContent = 'Цвет взят с фото. Дальше кисть закраски.';
    }

    function doUndo() {
      if (!session || stroke || saving) return;
      if (!session.undo()) return;
      refreshDirty();
      redraw();
      syncHist();
    }
    function doRedo() {
      if (!session || stroke || saving) return;
      if (!session.redo()) return;
      refreshDirty();
      redraw();
      syncHist();
    }

    function sameOrigin(url) {
      try { return new URL(url, location.href).origin === location.origin; }
      catch { return false; }
    }

    function loadImage(url, cors) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        if (cors) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('load'));
        img.src = url;
      });
    }

    function raster(img) {
      const edge = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
      const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
      const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return {c, w, h, scaled: scale < 1};
    }

    function readablePixels(c, w, h) {
      return c.getContext('2d').getImageData(0, 0, w, h).data;
    }

    function showCors(msg) {
      session = null;
      dirty = false;
      canvas.width = 0;
      canvas.height = 0;
      $('pe-cors').hidden = false;
      $('pe-cors').textContent = msg;
      $('pe-stage').hidden = true;
      syncHist();
    }

    function hideCors() {
      $('pe-cors').hidden = true;
      $('pe-stage').hidden = false;
    }

    async function decodeUrl(url) {
      const cors = !url.startsWith('data:') && !url.startsWith('blob:') && !sameOrigin(url);
      const img = await loadImage(url, cors);
      const drawn = raster(img);
      let px;
      try { px = readablePixels(drawn.c, drawn.w, drawn.h); }
      catch { const err = new Error('cors'); err.cors = true; throw err; }
      return {px: new Uint8ClampedArray(px), w: drawn.w, h: drawn.h, scaled: drawn.scaled};
    }

    async function useDecoded(decoded, viaFallback) {
      hideCors();
      if (!session) session = createPhotoSession(decoded.w, decoded.h, decoded.px);
      else session.load(decoded.w, decoded.h, decoded.px);
      dirty = false;
      stroke = null;
      $('pe-scale-note').hidden = !decoded.scaled;
      $('pe-scale-note').textContent = decoded.scaled
        ? 'Длинная сторона больше ' + MAX_EDGE + ' px — для редактора снимок уменьшен. Скачанная копия будет этого размера, файл в каталоге не изменён.'
        : '';
      $('pe-fallback-note').hidden = !viaFallback;
      $('pe-fallback-note').textContent = viaFallback
        ? 'Чужой адрес не отдал пиксели (CORS). Открыт файл с этого сайта — он может быть старше только что сохранённого. Оригинал не изменён.'
        : '';
      redraw();
      requestAnimationFrame(fit);
      syncHist();
      $('pe-status').textContent = '';
      canvas.dataset.peReady = '1';
    }

    async function loadSrc(url, fallback) {
      canvas.dataset.peReady = '';
      $('pe-status').textContent = 'Загружаю снимок…';
      try {
        await useDecoded(await decodeUrl(url), false);
        return;
      } catch (e) {
        if (fallback && fallback !== url) {
          try { await useDecoded(await decodeUrl(fallback), true); return; }
          catch { /* оба адреса недоступны */ }
        }
      }
      showCors('Браузер не смог прочитать пиксели этого адреса (CORS или запрет сервера). Скачайте снимок и откройте его кнопкой «Свой файл». Каталог не изменён — оригинал на месте.');
      $('pe-status').textContent = '';
    }

    async function loadFile(file) {
      if (!file) return;
      const url = URL.createObjectURL(file);
      try { await loadSrc(url); }
      catch {
        showCors('Этот файл не открылся. Нужен JPG, PNG или WEBP. Каталог не изменён.');
      }
      finally { URL.revokeObjectURL(url); }
    }

    function jpegB64(source, maxEdge, quality) {
      const edge = Math.max(source.width, source.height);
      const scale = maxEdge ? Math.min(1, maxEdge / edge) : 1;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(source.width * scale));
      c.height = Math.max(1, Math.round(source.height * scale));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality).split(',')[1];
    }

    function download(type, quality, ext) {
      if (!session) return;
      const c = document.createElement('canvas');
      c.width = session.w; c.height = session.h;
      c.getContext('2d').putImageData(new ImageData(session.pixels(), session.w, session.h), 0, 0);
      c.toBlob(blob => {
        if (!blob) { $('pe-status').textContent = 'Не удалось собрать файл.'; return; }
        const a = document.createElement('a');
        const art = String(opts.art || 'фото').replace(/[^\wа-яА-ЯёЁ.-]+/gi, '_');
        a.href = URL.createObjectURL(blob);
        a.download = art + '-копия.' + ext;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        $('pe-status').textContent = 'Скачана копия. Файл в каталоге не изменён.';
      }, type, quality);
    }

    function close(force) {
      if (!force && dirty && !confirm('Закрыть редактор? Нескачанная правка пропадёт. Снимок в каталоге не изменится.')) return;
      document.removeEventListener('keydown', onKey);
      back.remove();
      ring.remove();
      if (globalThis.__peClose === close) globalThis.__peClose = null;
      if (!document.getElementById('pe-back')) document.body.classList.remove('pe-open');
    }
    globalThis.__peClose = close;
    function closeAsk() { close(false); }

    $('pe-tool-blur').onclick = () => { setTool('blur'); $('pe-status').textContent = ''; };
    $('pe-tool-color').onclick = () => { setTool('color'); $('pe-status').textContent = ''; };
    $('pe-tool-pick').onclick = () => { setTool('pick'); $('pe-status').textContent = 'Нажмите на фото — цвет возьмётся из пикселя снимка.'; };
    $('pe-size').oninput = () => { $('pe-size-val').textContent = $('pe-size').value + ' px'; };
    $('pe-strength').oninput = () => { $('pe-strength-val').textContent = $('pe-strength').value; };
    $('pe-undo').onclick = doUndo;
    $('pe-redo').onclick = doRedo;
    $('pe-reset').onclick = () => {
      if (!session || !dirty) return;
      if (!confirm('Вернуть снимок к виду на момент открытия? Мазки этой сессии пропадут.')) return;
      session.reset();
      refreshDirty();
      redraw();
      syncHist();
      $('pe-status').textContent = 'Сброс. Оригинал в каталоге и не менялся.';
    };
    $('pe-zoom-in').onclick = () => {
      const r = canvas.getBoundingClientRect();
      setZoom(zoom * 1.25, r.left + r.width / 2, r.top + r.height / 2);
    };
    $('pe-zoom-out').onclick = () => {
      const r = canvas.getBoundingClientRect();
      setZoom(zoom / 1.25, r.left + r.width / 2, r.top + r.height / 2);
    };
    $('pe-fit').onclick = fit;
    $('pe-cancel').onclick = closeAsk;
    $('pe-save').onclick = async () => {
      if (!session || saving || !dirty) return;
      if (!(opts.slot && opts.slot.from) || typeof opts.onSave !== 'function') {
        $('pe-status').textContent = 'Этот файл не привязан к снимку в каталоге. Сохранить его некуда — скачайте копию.';
        return;
      }
      saving = true;
      $('pe-save').disabled = true;
      $('pe-save').textContent = 'Сохраняю…';
      $('pe-status').textContent = 'Записываю снимок в каталог…';
      try {
        const fullB64 = jpegB64(canvas, null, 0.92);
        const thumbB64 = jpegB64(canvas, 700, 0.85);
        const result = await opts.onSave({fullB64, thumbB64, preview: 'data:image/jpeg;base64,' + thumbB64});
        if (!result || result.status !== 'saved') throw new Error('сервер не подтвердил запись');
        session.markSaved();
        refreshDirty();
        $('pe-status').textContent = 'Сохранено в каталоге, в том же кадре. Прежний файл не удалён. Страница на сайте обновится через 1–2 минуты — сохранение ещё не значит, что она уже открылась у всех.';
      } catch (e) {
        $('pe-status').textContent = 'Не сохранилось: ' + (e && e.message ? e.message : 'ошибка сети') + '. Правка на месте, нажмите «Сохранить» ещё раз.';
      } finally {
        saving = false;
        $('pe-save').textContent = 'Сохранить';
        syncHist();
      }
    };
    $('pe-jpg').onclick = () => download('image/jpeg', 0.92, 'jpg');
    $('pe-png').onclick = () => download('image/png', undefined, 'png');
    $('pe-draft').onclick = async () => {
      if (!session || !opts.onDraft) return;
      $('pe-draft').disabled = true;
      try {
        const blob = await new Promise((res, rej) => {
          const c = document.createElement('canvas');
          c.width = session.w; c.height = session.h;
          c.getContext('2d').putImageData(new ImageData(session.pixels(), session.w, session.h), 0, 0);
          c.toBlob(b => b ? res(b) : rej(new Error('пустой файл')), 'image/jpeg', 0.92);
        });
        const art = String(opts.art || 'фото').replace(/[^\wа-яА-ЯёЁ.-]+/gi, '_');
        const file = new File([blob], art + '-копия.jpg', {type: 'image/jpeg'});
        await opts.onDraft(file);
        $('pe-status').textContent = 'Копия добавлена в черновик отдельным снимком. Прежний файл на месте.';
      } catch (e) {
        $('pe-status').textContent = 'Копия в черновик не легла: ' + (e && e.message ? e.message : 'ошибка');
      } finally { $('pe-draft').disabled = !session; }
    };
    $('pe-file').onchange = () => loadFile($('pe-file').files && $('pe-file').files[0]);

    stage.addEventListener('wheel', e => {
      if (!session) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
    }, {passive: false});

    stage.addEventListener('pointerdown', e => {
      if (!session || e.button > 0) return;
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      try { stage.setPointerCapture(e.pointerId); } catch { /* старый браузер */ }
      e.preventDefault();
      if (pointers.size >= 2) {
        abortStroke();
        const pts = [...pointers.values()];
        pinch = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
          zoom,
        };
        ring.hidden = true;
        return;
      }
      if (tool === 'pick') { pickAt(e); return; }
      beginStroke(e);
      moveRing(e);
    });

    stage.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (pinch && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        stage.scrollLeft -= cx - pinch.cx;
        stage.scrollTop -= cy - pinch.cy;
        setZoom(pinch.zoom * (dist / pinch.dist), cx, cy);
        pinch.cx = cx; pinch.cy = cy;
        return;
      }
      moveRing(e);
      if (stroke && e.pointerId === stroke.pid) {
        e.preventDefault();
        extendStroke(e);
      }
    });

    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (stroke && e.pointerId === stroke.pid) finishStroke();
      ring.hidden = true;
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (stroke && e.pointerId === stroke.pid) abortStroke();
      ring.hidden = true;
    });
    stage.addEventListener('pointerleave', () => { if (!stroke) ring.hidden = true; });

    setTool('blur');
    syncHist();
    if (opts.src) loadSrc(opts.src, opts.fallbackSrc);
    else {
      showCors('Откройте снимок кнопкой «Свой файл» или выберите фото в карточке. Каталог сам не меняется.');
      $('pe-cors').classList.add('pe-cors-idle');
    }
    if (opts.pick) $('pe-file').click();
  }

  return {
    MAX_EDGE, peBlur, peStampDisc, peApply, peApplyColor, peViewToImage, peInterpolate,
    createPhotoSession, openPhotoEditor, hexToRgb, rgbToHex,
    peEditStem, peApplySlot, peRunSlotSave, peIndexImageTree, peGalleryFiles,
  };
});
