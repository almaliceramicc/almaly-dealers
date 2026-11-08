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

/* один кадр: новый файл, та же позиция, чужие поля целы */
{
  const raw = JSON.stringify({tiles: [
    {art: 'A', name: 'Эн', photos: ['01', '02', '03'], stock: {msk: 4}},
    {art: 'B', name: 'Би', photos: ['09']},
  ]}, null, 1);
  const out = PE.peApplySlot(raw, {art: 'A', from: '02', stem: '02eabc'});
  const data = JSON.parse(out.text);
  assert.deepStrictEqual(data.tiles[0].photos, ['01', '02eabc', '03']);
  assert.strictEqual(data.tiles[0].stock.msk, 4);
  assert.strictEqual(data.tiles[0].name, 'Эн');
  assert.deepStrictEqual(data.tiles[1].photos, ['09']);
  assert.strictEqual(data.tiles[1].name, 'Би');
  const again = PE.peApplySlot(out.text, {art: 'A', from: '02', stem: '02eabc'});
  assert.strictEqual(again.changed, false);
  assert.throws(() => PE.peApplySlot(out.text, {art: 'A', from: 'нет', stem: 'zz'}), e => e.code === 'conflict');
  assert.throws(() => PE.peApplySlot(out.text, {art: 'NO', from: '01', stem: 'z'}), e => e.code === 'gone');
}

{
  const shas = PE.peIndexImageTree([
    {type: 'blob', path: 'docs/img/A/02.jpg', sha: 's2'},
    {type: 'blob', path: 'docs/img/A/01.jpg', sha: 's1'},
    {type: 'blob', path: 'docs/img/A/02eabc.jpg', sha: 'se'},
    {type: 'blob', path: 'docs/img/A/02eabc_t.jpg', sha: 'set'},
    {type: 'blob', path: 'docs/img/A/note.txt', sha: 'no'},
  ]);
  const files = PE.peGalleryFiles([{art: 'A', photos: ['02eabc', '02']}], shas);
  assert.deepStrictEqual(files.A.map(f => f.f), ['02eabc.jpg', '02.jpg']);
  assert.strictEqual(files.A[0].sha, 'se');
  assert.strictEqual(files.A[0].thumbSha, 'set');
  assert.ok(!files.A.some(f => f.f === '01.jpg'));
}

(async () => {
{
  const base = JSON.stringify({tiles: [
    {art: 'A', photos: ['01', '02'], keep: true},
    {art: 'B', photos: ['09'], name: 'stay'},
  ]}, null, 1);
  const server = {data: base, shas: null, commits: 0, ops: []};
  const io = {
    async blob(b) { return {sha: 'sha:' + b}; },
    async readData() { return server.data; },
    async fileShas() { return server.shas; },
    async commit(message, ops, edits) {
      server.commits++;
      server.ops.push(ops);
      server.data = edits[0].apply(server.data);
      server.shas = {full: ops[0].sha, thumb: ops[1].sha};
      if (server.commits === 1) throw new TypeError('обрыв');
      return {'docs/data.json': server.data};
    },
  };
  const job = {art: 'A', from: '01', stem: '01eabc', fullB64: 'FULL', thumbB64: 'THUMB'};
  await assert.rejects(() => PE.peRunSlotSave(io, job), e => e instanceof TypeError);
  const photos = JSON.parse(server.data).tiles.find(t => t.art === 'A').photos;
  assert.deepStrictEqual(photos, ['01eabc', '02']);
  assert.ok(server.ops[0].every(o => o.sha && !String(o.path).endsWith('/01.jpg')));
  assert.deepStrictEqual(server.ops[0].map(o => o.path), [
    'docs/img/A/01eabc.jpg', 'docs/img/A/01eabc_t.jpg',
  ]);
  const second = await PE.peRunSlotSave(io, job);
  assert.strictEqual(second.status, 'saved');
  assert.strictEqual(second.commit, false);
  assert.strictEqual(server.commits, 1);
  assert.strictEqual(JSON.parse(server.data).tiles[1].name, 'stay');
}

{
  let commits = 0;
  const io = {
    async blob() { const e = new Error('код 403'); e.status = 403; throw e; },
    async readData() { commits++; return '{}'; },
    async fileShas() { return null; },
    async commit() { commits++; },
  };
  await assert.rejects(() => PE.peRunSlotSave(io, {art: 'A', from: '01', stem: '01e', fullB64: 'a', thumbB64: 'b'}),
    e => e.status === 403);
  assert.strictEqual(commits, 0);
}

{
  let commits = 0;
  const io = {
    async blob() { return {sha: 's'}; },
    async readData() { throw new TypeError('Failed to fetch'); },
    async fileShas() { return null; },
    async commit() { commits++; },
  };
  await assert.rejects(() => PE.peRunSlotSave(io, {art: 'A', from: '01', stem: '01e', fullB64: 'a', thumbB64: 'b'}),
    e => e instanceof TypeError);
  assert.strictEqual(commits, 0);
}

{
  let commits = 0;
  const io = {
    async blob() { return {sha: 's'}; },
    async readData() { return JSON.stringify({tiles: [{art: 'A', photos: ['zz']}]}); },
    async fileShas() { return null; },
    async commit() { commits++; },
  };
  await assert.rejects(() => PE.peRunSlotSave(io, {art: 'A', from: '01', stem: '01e', fullB64: 'a', thumbB64: 'b'}),
    e => e.code === 'conflict');
  assert.strictEqual(commits, 0);
}

{
  let started = 0;
  let release;
  const hold = new Promise(r => { release = r; });
  const io = {
    async blob() { started++; await hold; return {sha: 's' + started}; },
    async readData() { return JSON.stringify({tiles: [{art: 'A', photos: ['01']}]}); },
    async fileShas() { return null; },
    async commit(m, ops, edits) { return {'docs/data.json': edits[0].apply(await this.readData())}; },
  };
  const job = {art: 'A', from: '01', stem: '01e', fullB64: 'a', thumbB64: 'b'};
  const first = PE.peRunSlotSave(io, job);
  const second = await PE.peRunSlotSave(io, job);
  assert.deepStrictEqual(second, {status: 'busy'});
  release();
  const done = await first;
  assert.strictEqual(done.status, 'saved');
  assert.strictEqual(done.commit, true);
  assert.strictEqual(started, 2);
}

{
  await assert.rejects(() => PE.peRunSlotSave({
    async blob() { return {sha: 's'}; }, async readData() { return '{}'; },
    async fileShas() { return null; }, async commit() {},
  }, {art: 'A', stem: 'x', fullB64: 'a', thumbB64: 'b'}), e => e.code === 'no-slot');
}

console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
