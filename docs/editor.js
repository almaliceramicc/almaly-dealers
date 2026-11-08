/* Редактор каталога дилерского портала: фотографии, их порядок и состав карточек.
   Пишет в репозиторий портала. Workflow «Зеркало витрины» сам переносит фото
   и список карточек на витрину QR (almaly-tiles). Обратно витрина ничего не шлёт. */
const ED = {
  token: localStorage.getItem('almaly_ed_token') || '',
  files: {},      // {арт: [{f, sha}]} — что сейчас лежит в репозитории
  current: null,
  draft: [],
  saving: false,
};

const HINTS_ED = {
  401: 'токен недействителен или отозван — вставьте новый',
  403: 'у токена нет права записи (Contents: Read and write / scope repo)',
  404: 'токен не видит репозиторий — дайте ему доступ к almaly-dealers',
};

async function gh2(path, opts = {}) {
  const fresh = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
  const r = await fetch(`https://api.github.com/repos/${REPO}${fresh}`, {...opts, cache: 'no-store',
    headers: {Authorization: `Bearer ${ED.token}`, Accept: 'application/vnd.github+json', ...opts.headers}});
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(HINTS_ED[r.status] || d.message || `код ${r.status}`); e.status = r.status; throw e; }
  return d;
}

const sleep2 = ms => new Promise(r => setTimeout(r, ms));

/** Текст файла в коммите ref (GitHub отдаёт base64). */
async function readAt(ref, path) {
  const f = await gh2(`/contents/${path}?ref=${ref}`);
  return decodeURIComponent(escape(atob(f.content.replace(/\n/g, ''))));
}

/** Один коммит из набора операций; повтор, если ветку успел сдвинуть кто-то другой.
 *  edits — правки текстовых файлов: каждая накладывается на версию из свежего коммита,
 *  а не на копию в браузере, чтобы не стереть чужие изменения. Возвращает новые тексты. */
async function commit2(message, ops, edits = []) {
  for (const wait of [0, 900, 2500, 5000]) {
    if (wait) await sleep2(wait);
    try {
      const head = (await gh2('/git/refs/heads/main')).object.sha;
      const baseTree = (await gh2(`/git/commits/${head}`)).tree.sha;
      const texts = {}, extra = [];
      for (const e of edits) {
        texts[e.path] = e.apply(await readAt(head, e.path));
        const b = await gh2('/git/blobs', {method: 'POST',
          body: JSON.stringify({content: texts[e.path], encoding: 'utf-8'})});
        extra.push({path: e.path, sha: b.sha});
      }
      const tree = [...ops, ...extra].map(o => ({path: o.path, mode: '100644', type: 'blob', sha: o.sha ?? null}));
      const t = await gh2('/git/trees', {method: 'POST',
        body: JSON.stringify({base_tree: baseTree, tree})});
      const c = await gh2('/git/commits', {method: 'POST',
        body: JSON.stringify({message, tree: t.sha, parents: [head]})});
      await gh2('/git/refs/heads/main', {method: 'PATCH', body: JSON.stringify({sha: c.sha})});
      return texts;
    } catch (e) {
      const race = [409, 422].includes(e.status) || /fast forward/i.test(e.message);
      if (!race || wait === 5000) throw e;
    }
  }
}

/* ---------- состав каталога (arts.txt) ---------- */
let edArts = [];              // arts.txt построчно, как лежит в репозитории

async function edLoadArts() {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/arts.txt?t=` + Date.now(),
                        {cache: 'no-store'});
  edArts = (await r.text()).replace(/\n$/, '').split('\n');
}

/** Пишет новый arts.txt; состав каталога пересобирает GitHub Action портала. */
async function edSaveArts(message, change) {
  const texts = await commit2(message, [], [{path: 'arts.txt',
    apply: s => change(s.replace(/\n$/, '').split('\n')).join('\n') + '\n'}]);
  edArts = texts['arts.txt'].replace(/\n$/, '').split('\n');
}

const sameArt = (l, art) => l.trim().toUpperCase() === art.toUpperCase();
const edArtIndex = art => edArts.findIndex(l => sameArt(l, art));

async function edAddArt() {
  const art = $('#ed-new-art').value.trim().toUpperCase();
  if (!art) return;
  if (!/^[A-ZА-Я0-9-]{4,20}$/.test(art)) return toast('Это не похоже на артикул', 'err');
  if (edArtIndex(art) >= 0) return toast('Этот артикул уже в каталоге', 'err');
  try {
    await edSaveArts(`Каталог: добавлен ${art}`, lines => lines.some(l => sameArt(l, art)) ? lines : [...lines, art]);
    $('#ed-new-art').value = '';
    toast('Добавлено. Карточка появится через 1–2 минуты, если артикул есть в таблице.');
  } catch (e) { toast('Не получилось: ' + e.message, 'err'); }
}

async function edDropArt() {
  const t = edTiles.find(x => x.art === ED.current);
  if (!t) return;
  if (!confirm(`Убрать карточку «${t.name}»?\n\nОна пропадёт и в каталоге портала, и на витрине QR — обычно через несколько минут. Ночное обновление из таблицы её не вернёт.`)) return;
  if (edArtIndex(t.art) < 0) return toast('Этого артикула нет в arts.txt', 'err');
  try {
    await edSaveArts(`Каталог: убран ${t.art}`, lines => lines.filter(l => !sameArt(l, t.art)));
    edTiles = edTiles.filter(x => x.art !== t.art);
    ED.current = null;
    edDrawList(); edDrawWork();
    toast('Карточка убрана. Портал и витрина обновятся через несколько минут.');
  } catch (e) { toast('Не получилось: ' + e.message, 'err'); }
}

async function edLoadFiles() {
  const tree = await gh2('/git/trees/main?recursive=1');
  ED.files = PE.peGalleryFiles(edTiles, PE.peIndexImageTree(tree.tree));
}

const edRaw = (art, f, sha) =>
  `https://raw.githubusercontent.com/${REPO}/main/docs/img/${art}/${f}?v=${(sha || '').slice(0, 8)}`;

/** Готовит из файла две версии: 1600 px для просмотра и 700 px для карточки. */
const edShrink = file => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => {
    const make = max => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', .85);
    };
    const full = make(1600), thumb = make(700);
    res({full: full.split(',')[1], thumb: thumb.split(',')[1], preview: thumb});
  };
  img.onerror = () => rej(new Error(`не удалось прочитать ${file.name}`));
  img.src = URL.createObjectURL(file);
});

const edDirty = () => {
  const was = (ED.files[ED.current] || []).map(p => p.f).join();
  const now = ED.draft.filter(p => !p.deleted).map(p => p.f || '+').join();
  return was !== now || ED.draft.some(p => p.deleted || !p.f);
};

/* ---------- отрисовка ---------- */
function edDrawList() {
  const q = $('#ed-q').value.trim().toLowerCase();
  const list = edTiles.filter(t => !q || (t.name + ' ' + t.art).toLowerCase().includes(q));
  $('#ed-list').innerHTML = list.map(t => {
    const ph = ED.files[t.art] || [];
    return `<button class="item" data-art="${t.art}" aria-current="${t.art === ED.current}">
      ${ph.length ? `<img src="${edRaw(t.art, ph[0].f, ph[0].sha)}" alt="" loading="lazy">`
                  : '<span class="noimg">◇</span>'}
      <span class="txt"><b>${esc(t.name)}</b><small>${t.format} см · ${esc(t.surface)}</small></span>
      <span class="cnt">${ph.length || '—'}</span>
    </button>`;
  }).join('') || '<p class="lead" style="padding:8px">Ничего не найдено</p>';
}

function edDrawWork() {
  const t = edTiles.find(x => x.art === ED.current);
  const box = $('#ed-work');
  if (!t) {
    box.innerHTML = `<div class="empty"><h3>Выберите модель</h3>
      <p>Слева список каталога: найдите модель по названию или артикулу — справа откроются её фотографии.</p>
      <p><button class="btn sm" id="ed-photo" type="button">Редактировать свой файл</button></p></div>`;
    return;
  }

  const shots = ED.draft.map((p, i) => {
    const src = p.preview || edRaw(t.art, p.f, p.sha);
    const visible = ED.draft.filter(x => !x.deleted).indexOf(p) + 1;
    return `<div class="shot ${p.deleted ? 'gone' : ''} ${visible === 1 && !p.deleted ? 'cover' : ''}"
                 data-f="${p.id}" title="Перетащите, чтобы поменять порядок">
      <div class="img-wrap"><img src="${src}" alt="" loading="lazy" draggable="false"></div>
      <span class="num">${p.deleted ? '—' : (visible === 1 ? 'обложка' : visible)}</span>
      <span class="acts">
        ${p.deleted
          ? `<button class="icon" data-eact="undo" data-i="${i}" title="Вернуть">↺</button>`
          : `<button class="icon" data-eact="edit" data-i="${i}" title="Редактировать копию">✎</button>
             <button class="icon" data-eact="cover" data-i="${i}" title="Сделать обложкой">★</button>
             <button class="icon" data-eact="del" data-i="${i}" title="Удалить">✕</button>`}
      </span>
    </div>`;
  }).join('');

  const kept = ED.draft.filter(p => !p.deleted);
  const cover = kept[0];
  const coverSrc = cover ? (cover.preview || edRaw(t.art, cover.f, cover.sha)) : '';
  const dirty = edDirty();

  box.innerHTML = `
    <div class="work-hd">
      <div>
        <h3>${esc(t.name)}</h3>
        <div class="art">${t.format} см · ${esc(t.surface)}</div>
      </div>
      <div class="right">
        <a class="btn sm" href="tile.html?a=${t.art}" target="_blank" rel="noopener">Открыть в каталоге ↗</a>
        <button class="btn sm" id="ed-photo" type="button">Редактировать файл</button>
        <button class="btn sm" id="ed-drop-art" type="button">Убрать карточку</button>
      </div>
    </div>

    <div class="cover-preview">
      ${coverSrc ? `<img src="${coverSrc}" alt="Обложка модели ${esc(t.name)}">`
                 : '<span class="cp-none">обложки пока нет</span>'}
      <div>
        <b>Обложка карточки</b>
        <p>Первое фото в списке — обложка. Перетащите фото мышью или пальцем,
          чтобы изменить порядок, либо нажмите ★ на нужном. Тот же порядок уходит на витрину QR:
          первое фото становится обложкой и там.</p>
        <p>Загружено фотографий: <b>${kept.length}</b>. Рекомендуем JPG, вертикальные,
          не меньше 1000 px по длинной стороне — портал сам уменьшит их до 1600 px и сделает миниатюру.</p>
        <p>Чужой логотип закрывается кнопкой ✎. «Сохранить» пишет этот кадр в ту же позицию новым файлом
          и не удаляет прежний. «Скачать» — копия на компьютер. «Сохранить и опубликовать» по-прежнему
          отправляет все несохранённые правки карточки разом.</p>
      </div>
    </div>

    <div class="shots" id="ed-shots" data-art="${t.art}">
      ${shots}
      <label class="drop"><b>＋</b>добавить фото<input type="file" accept="image/*" multiple hidden></label>
    </div>

    <div class="bar">
      <span class="ed-state ${dirty ? 'dirty' : ''}" id="ed-status">
        ${dirty ? 'Есть несохранённые изменения' : 'Всё сохранено и опубликовано'}</span>
      <span class="right">
        <button class="btn" id="ed-reset" type="button" ${dirty ? '' : 'disabled'}>Отменить изменения</button>
        <button class="btn primary" id="ed-save" type="button" ${dirty ? '' : 'disabled'}>Сохранить и опубликовать</button>
      </span>
    </div>`;
}

function edSelect(art) {
  if (edDirty() && !confirm('Есть несохранённые изменения. Перейти к другой модели и потерять их?')) return;
  ED.current = art;
  ED.draft = (ED.files[art] || []).map(p => ({...p, id: p.f}));
  edDrawList(); edDrawWork();
  if (innerWidth < 900) $('#ed-work').scrollIntoView({behavior: 'smooth', block: 'start'});
}

/* ---------- сохранение ---------- */
async function edSave() {
  if (ED.saving) return;
  const art = ED.current, keep = ED.draft.filter(p => !p.deleted);
  ED.saving = true; $('#ed-save').disabled = true; $('#ed-reset').disabled = true;
  const st = $('#ed-status');
  st.className = 'ed-state saving';
  st.innerHTML = '<span class="spin" aria-hidden="true"></span>Публикую фотографии…';
  try {
    const ops = (ED.files[art] || []).flatMap(p => [
      {path: `docs/img/${art}/${p.f}`},
      {path: `docs/img/${art}/${p.f.replace('.jpg', '_t.jpg')}`},
    ]);
    const names = [];
    for (const [i, p] of keep.entries()) {
      const base = String(i + 1).padStart(2, '0');
      names.push(base);
      if (p.sha) {                       // уже в репозитории — просто переносим под новым именем
        ops.push({path: `docs/img/${art}/${base}.jpg`, sha: p.sha});
        if (p.thumbSha) ops.push({path: `docs/img/${art}/${base}_t.jpg`, sha: p.thumbSha});
      } else {                           // новое фото — заливаем обе версии
        const full = await gh2('/git/blobs', {method: 'POST',
          body: JSON.stringify({content: p.full, encoding: 'base64'})});
        const thumb = await gh2('/git/blobs', {method: 'POST',
          body: JSON.stringify({content: p.thumb, encoding: 'base64'})});
        ops.push({path: `docs/img/${art}/${base}.jpg`, sha: full.sha});
        ops.push({path: `docs/img/${art}/${base}_t.jpg`, sha: thumb.sha});
      }
    }

    // тот же коммит обновляет карточку каталога — в свежей версии data.json
    const setPhotos = s => {
      const data = JSON.parse(s);
      const tile = data.tiles.find(x => x.art === art);
      if (!tile) throw new Error('карточку уже убрали из каталога');
      tile.photos = names;
      // порядок внутри формата задаёт order.txt (ночная сборка), здесь его не ломаем
      data.tiles.sort((a, b) => (a.photos.length ? 0 : 1) - (b.photos.length ? 0 : 1) ||
        a.format.localeCompare(b.format));
      return JSON.stringify(data, null, 1);
    };
    const texts = await commit2(`Фото ${art}: ${names.length} шт.`, ops, [{path: 'docs/data.json', apply: setPhotos}]);
    edData = JSON.parse(texts['docs/data.json']); edTiles = edData.tiles;
    await edLoadFiles();
    ED.draft = (ED.files[art] || []).map(p => ({...p, id: p.f}));
    edDrawList(); edDrawWork();
    toast('Опубликовано. Портал обновится через 1–2 минуты, витрина QR — следом.', 'ok');
  } catch (e) {
    toast('Не сохранилось: ' + e.message + '. Изменения остались в редакторе — попробуйте ещё раз.', 'err');
    edDrawWork();
  } finally { ED.saving = false; }
}

/* ---------- события ---------- */
let edTiles = [], edData = {tiles: []};

async function edStart() {
  try {
    const repo = await gh2('');
    if (repo.permissions && !repo.permissions.push)
      throw new Error('у токена только чтение — нужен доступ на запись');
    edData = JSON.parse(await readAt('main', 'docs/data.json'));
    edTiles = edData.tiles;
    await edLoadFiles();
    await edLoadArts();
    localStorage.setItem('almaly_ed_token', ED.token);
    $('#ed-gate').hidden = true; $('#ed-app').hidden = false;
    edDrawList(); edDrawWork();
  } catch (e) {
    $('#ed-gate').hidden = false; $('#ed-app').hidden = true;
    toast('Редактор не открылся: ' + e.message, 'err');
  }
}

let edInited = false;

function initEditor() {
  if (edInited) return;
  edInited = true;
  $('#ed-login').addEventListener('click', () => {
    ED.token = $('#ed-token').value.trim();
    if (!ED.token) return toast('Вставьте токен GitHub', 'err');
    edStart();
  });
  $('#ed-eye').addEventListener('click', () => {
    const i = $('#ed-token'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('#ed-eye').setAttribute('aria-pressed', show);
    $('#ed-eye').setAttribute('aria-label', show ? 'Скрыть токен' : 'Показать токен');
  });
  $('#ed-token').addEventListener('keydown', e => e.key === 'Enter' && $('#ed-login').click());
  $('#ed-q').addEventListener('input', edDrawList);
  $('#ed-add-art').addEventListener('click', edAddArt);
  $('#ed-new-art').addEventListener('keydown', e => e.key === 'Enter' && edAddArt());
  $('#ed-list').addEventListener('click', e => {
    const b = e.target.closest('.item'); if (b) edSelect(b.dataset.art);
  });

  $('#ed-work').addEventListener('click', e => {
    const b = e.target.closest('button[data-eact], #ed-save, #ed-reset, #ed-drop-art, #ed-photo'); if (!b) return;
    if (b.id === 'ed-save') return edSave();
    if (b.id === 'ed-drop-art') return edDropArt();
    if (b.id === 'ed-photo') return edEditFile();
    if (b.id === 'ed-reset') { ED.draft = (ED.files[ED.current] || []).map(p => ({...p, id: p.f})); return edDrawWork(); }
    const i = +b.dataset.i, p = ED.draft[i];
    if (b.dataset.eact === 'edit') return edEditPhoto(i);
    if (b.dataset.eact === 'del') p.deleted = true;
    if (b.dataset.eact === 'undo') delete p.deleted;
    if (b.dataset.eact === 'cover') { ED.draft.splice(i, 1); ED.draft.unshift(p); }
    edDrawWork();
  });

  $('#ed-work').addEventListener('change', async e => {
    if (e.target.type !== 'file' || !e.target.files.length) return;
    await edAdd(e.target.files);
  });
  $('#ed-work').addEventListener('dragover', e => {
    if (!ED.current) return;
    e.preventDefault(); e.target.closest('.drop')?.classList.add('over');
  });
  $('#ed-work').addEventListener('dragleave', e => e.target.closest('.drop')?.classList.remove('over'));
  $('#ed-work').addEventListener('drop', e => {
    if (!ED.current || !e.dataTransfer.files.length) return;
    e.preventDefault(); e.target.closest('.drop')?.classList.remove('over');
    edAdd(e.dataTransfer.files);
  });

  enableDnd($('#ed-work'), (art, order) => {
    ED.draft.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    edDrawWork();
  });

  if (ED.token) edStart();
}

async function edAdd(files, note) {
  toast(`Готовлю ${files.length} фото…`);
  try {
    for (const file of files) {
      const {full, thumb, preview} = await edShrink(file);
      ED.draft.push({id: 'new-' + Math.random().toString(36).slice(2), full, thumb, preview});
    }
    edDrawWork();
    toast(note || 'Фото добавлены. Нажмите «Сохранить и опубликовать».', 'ok');
  } catch (e) { toast(e.message); }
}

function edPhotoOpts() {
  const t = edTiles.find(x => x.art === ED.current);
  return {
    title: t ? t.name : 'Свой файл',
    art: ED.current || '',
    onDraft: ED.current ? file => edAdd([file],
      'Копия в черновике. Прежний снимок на месте. На сайт — только после «Сохранить и опубликовать».') : null,
  };
}

function edEditFile() {
  if (typeof openPhotoEditor !== 'function') return toast('Редактор фото не загрузился', 'err');
  openPhotoEditor({...edPhotoOpts(), pick: true});
}

function edEditPhoto(i) {
  if (typeof openPhotoEditor !== 'function') return toast('Редактор фото не загрузился', 'err');
  const p = ED.draft[i];
  if (!p || p.deleted) return;
  const opts = edPhotoOpts();
  const from = p.f ? p.f.replace(/\.jpg$/i, '') : '';
  if (from) {
    const slot = {art: ED.current, from, draftIndex: i};
    opts.slot = slot;
    opts.onSave = payload => edSaveSlot(slot, payload);
  }
  if (p.full) opts.src = 'data:image/jpeg;base64,' + p.full;
  else {
    opts.src = edRaw(ED.current, p.f, p.sha);
    opts.fallbackSrc = 'img/' + encodeURIComponent(ED.current) + '/' + encodeURIComponent(p.f);
  }
  openPhotoEditor(opts);
}

async function edFileShas(art, stem) {
  const one = async name => {
    try { return (await gh2(`/contents/docs/img/${encodeURIComponent(art)}/${encodeURIComponent(name)}?ref=main`)).sha; }
    catch (e) { if (e.status === 404) return null; throw e; }
  };
  const full = await one(stem + '.jpg');
  const thumb = await one(stem + '_t.jpg');
  if (!full && !thumb) return null;
  return {full, thumb};
}

/** Один кадр: новый файл, ссылка в той же позиции. Остальной черновик не публикуется. */
async function edSaveSlot(slot, payload) {
  if (!slot.stem) slot.stem = PE.peEditStem(slot.from);
  const result = await PE.peRunSlotSave({
    blob: b64 => gh2('/git/blobs', {method: 'POST', body: JSON.stringify({content: b64, encoding: 'base64'})}),
    readData: () => readAt('main', 'docs/data.json'),
    fileShas: edFileShas,
    commit: commit2,
  }, {art: slot.art, from: slot.from, stem: slot.stem, fullB64: payload.fullB64, thumbB64: payload.thumbB64});
  const item = ED.draft[slot.draftIndex];
  if (item && result.status === 'saved') {
    const old = item.f;
    item.f = result.stem + '.jpg';
    item.sha = result.fullSha;
    item.thumbSha = result.thumbSha;
    if (payload.preview) item.preview = payload.preview;
    delete item.full; delete item.thumb;
    const rec = (ED.files[slot.art] || []).find(p => p.f === old || p.f === item.f);
    if (rec) { rec.f = item.f; rec.sha = item.sha; rec.thumbSha = item.thumbSha; }
    const tile = edTiles.find(t => t.art === slot.art);
    if (tile) tile.photos = result.photos.slice();
    slot.from = result.stem;
    slot.stem = null;
    edDrawList();
    edDrawWork();
  }
  return result;
}
