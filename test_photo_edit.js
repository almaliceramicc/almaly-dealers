/* Кисть: размытие только под мазком, не закраска, не пикселизация, не весь кадр. */
const assert = require('assert');
const fs = require('fs');
const PE = require('./docs/photo-edit.js');

const px = (buf, w, x, y) => {
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};
const fill = (w, h, fn) => {
  const b = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, bl, a] = fn(x, y);
    const i = (y * w + x) * 4;
    b[i] = r; b[i + 1] = g; b[i + 2] = bl; b[i + 3] = a;
  }
  return b;
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* белый кадр остаётся белым — край не темнеет */
{
  const w = 32, h = 24;
  const src = fill(w, h, () => [255, 255, 255, 255]);
  const out = PE.peBlur(src, w, h, 5);
  assert.deepStrictEqual([...out], [...src]);
}

/* чёрный остаётся чёрным */
{
  const w = 17, h = 19;
  const src = fill(w, h, () => [0, 0, 0, 255]);
  const out = PE.peBlur(src, w, h, 4);
  assert.deepStrictEqual([...out], [...src]);
}

/* импульс: спад, а не плоская закраска и не весь кадр */
{
  const w = 41, h = 41, r = 2;
  const src = fill(w, h, (x, y) => (x === 20 && y === 20 ? [255, 0, 0, 255] : [0, 0, 40, 255]));
  const out = PE.peBlur(src, w, h, r);
  const at = (d) => px(out, w, 20 + d, 20)[0];
  const profile = [0, 1, 2, 3, 4, 6, 8].map(at);
  assert.ok(at(0) >= at(1) && at(1) > at(3) && at(3) > at(6) && at(6) === 0 && at(8) === 0, 'профиль ' + profile.join(','));
  assert.ok(at(0) > at(4) && at(0) < 40, 'не штамп краски ' + at(0));
  let sum = 0;
  for (let i = 0; i < out.length; i += 4) sum += out[i];
  assert.ok(sum > 220 && sum < 280, 'энергия ' + sum);
  assert.deepStrictEqual(px(out, w, 0, 0), [0, 0, 40, 255]);
  assert.ok(px(out, w, 21, 20)[2] > 0 && px(out, w, 21, 20)[0] > 0);
}

/* маска: снаружи байт в байт, внутри — размытие этого кадра, не чужая краска */
{
  const w = 80, h = 60, strength = 3, rad = 8;
  const src = fill(w, h, (x, y) => ((x + y) & 1) ? [220, 30, 30, 255] : [20, 40, 200, 255]);
  const blurred = PE.peBlur(src, w, h, strength);
  const mask = new Uint8Array(w * h);
  PE.peStampDisc(mask, w, h, 28.5, 24.5, rad);
  const out = PE.peApply(src, blurred, mask);
  let masked = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const o = px(out, w, x, y), s = px(src, w, x, y), b = px(blurred, w, x, y);
    if (!mask[i]) {
      assert.deepStrictEqual(o, s, 'снаружи ' + x + ',' + y);
    } else {
      masked++;
      assert.deepStrictEqual(o, b);
    }
  }
  assert.ok(masked > 20 && masked < w * h * 0.4, 'мазок ' + masked);
  const center = px(out, w, 28, 24);
  assert.ok(center[0] > 40 && center[0] < 200 && center[2] > 40 && center[2] < 220, 'смешение ' + center);

  const other = fill(w, h, (x, y) => ((x + y) & 1) ? [0, 180, 0, 255] : [0, 0, 0, 255]);
  const out2 = PE.peApply(other, PE.peBlur(other, w, h, strength), mask);
  assert.notDeepStrictEqual(px(out2, w, 28, 24), center);
  assert.ok(Math.abs(px(out, w, 29, 24)[0] - px(out, w, 28, 24)[0]) < 30);
}

/* сессия: мазок, отмена, повтор, сброс, смена кадра без хвоста */
{
  const w = 48, h = 36;
  const src = fill(w, h, (x, y) => ((x + y) & 1) ? [240, 20, 20, 255] : [20, 20, 240, 255]);
  const s = PE.createPhotoSession(w, h, src);
  const before = s.pixels();
  assert.ok(s.paint([{x: 20, y: 16}], 14, 'blur', 4));
  const painted = s.pixels();
  assert.ok(!same(painted, before));
  assert.deepStrictEqual(px(painted, w, 0, 0), px(before, w, 0, 0));
  assert.deepStrictEqual(px(painted, w, 47, 35), px(before, w, 47, 35));
  assert.ok(s.undo());
  assert.deepStrictEqual([...s.pixels()], [...before]);
  assert.ok(!s.undo());
  assert.ok(s.redo());
  assert.deepStrictEqual([...s.pixels()], [...painted]);
  s.reset();
  assert.deepStrictEqual([...s.pixels()], [...before]);
  assert.ok(!s.canUndo() && !s.canRedo());

  const next = fill(10, 8, () => [0, 255, 0, 255]);
  s.load(10, 8, next);
  assert.strictEqual(s.w, 10);
  assert.deepStrictEqual([...s.pixels()], [...next]);
  assert.ok(!s.canUndo());
  s.paint([{x: 2, y: 2}], 6, 'blur', 2);
  s.undo();
  assert.deepStrictEqual([...s.pixels()], [...next]);
}

/* закраска — плоский цвет только в диске, размытие так не делает */
{
  const w = 30, h = 30;
  const src = fill(w, h, (x, y) => ((x ^ y) & 2) ? [240, 10, 10, 255] : [10, 10, 240, 255]);
  const s = PE.createPhotoSession(w, h, src);
  s.paint([{x: 15, y: 15}], 10, 'color', 8, [255, 0, 0]);
  const out = s.pixels();
  assert.deepStrictEqual(px(out, w, 15, 15), [255, 0, 0, 255]);
  assert.deepStrictEqual(px(out, w, 0, 0), px(src, w, 0, 0));
  const blur = PE.createPhotoSession(w, h, src);
  blur.paint([{x: 15, y: 15}], 10, 'blur', 3);
  assert.notDeepStrictEqual(px(blur.pixels(), w, 15, 15), [255, 0, 0, 255]);
  assert.notStrictEqual(px(blur.pixels(), w, 15, 15)[0], px(src, w, 15, 15)[0]);
}

/* координаты: масштаб и сдвиг, мышь и палец — одни и те же clientX/clientY */
{
  const rect = {left: 50, top: 20, width: 200, height: 100};
  const p = PE.peViewToImage(150, 80, rect, 400, 200);
  assert.strictEqual(p.x, 200);
  assert.strictEqual(p.y, 120);
  const zoomed = {left: 10, top: 30, width: 800, height: 400};
  const t = PE.peViewToImage(10 + 100, 30 + 50, zoomed, 400, 200);
  assert.strictEqual(t.x, 50);
  assert.strictEqual(t.y, 25);
}

/* крупный кадр: угол вне мазка не меняется */
{
  const w = 900, h = 600;
  const src = fill(w, h, (x, y) => ((x + y) & 1) ? [230, 40, 40, 255] : [40, 40, 230, 255]);
  const t0 = Date.now();
  const s = PE.createPhotoSession(w, h, src);
  assert.ok(s.paint([{x: 40, y: 40}], 30, 'blur', 6));
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, 'медленно ' + ms);
  const out = s.pixels();
  assert.deepStrictEqual(px(out, w, 880, 580), px(src, w, 880, 580));
  assert.notDeepStrictEqual(px(out, w, 40, 40), px(src, w, 40, 40));
  console.log('large', w + 'x' + h, ms + 'ms');
}

/* кисть не в каталоге и не публикует сама */
{
  const pe = fs.readFileSync('docs/photo-edit.js', 'utf8');
  const ed = fs.readFileSync('docs/editor.js', 'utf8');
  const admin = fs.readFileSync('docs/admin.html', 'utf8');
  assert.ok(admin.includes('photo-edit.js'));
  for (const page of ['docs/index.html', 'docs/tile.html', 'docs/order.html']) {
    assert.ok(!fs.readFileSync(page, 'utf8').includes('photo-edit'));
  }
  assert.ok(ed.includes('data-eact="edit"'));
  assert.ok(ed.includes('openPhotoEditor'));
  assert.ok(!pe.includes('api.github.com') && !pe.includes('commit2') && !pe.includes('edSave'));
  assert.ok(!pe.includes('almaly-tiles'));
}

console.log('ok');
