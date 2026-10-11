/* Редактор каталога дилерского портала: фотографии и их порядок.
   Пишет прямо в репозиторий портала — витрина с QR-кодами не затрагивается. */
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

/** Один коммит из набора операций; повтор, если ветку успел сдвинуть кто-то другой. */
async function commit2(message, ops) {
  for (const wait of [0, 900, 2500, 5000]) {
    if (wait) await sleep2(wait);
    try {
      const head = (await gh2('/git/refs/heads/main')).object.sha;
      const baseTree = (await gh2(`/git/commits/${head}`)).tree.sha;
      const tree = ops.map(o => ({path: o.path, mode: '100644', type: 'blob', sha: o.sha ?? null}));
      const t = await gh2('/git/trees', {method: 'POST',
        body: JSON.stringify({base_tree: baseTree, tree})});
      const c = await gh2('/git/commits', {method: 'POST',
        body: JSON.stringify({message, tree: t.sha, parents: [head]})});
      await gh2('/git/refs/heads/main', {method: 'PATCH', body: JSON.stringify({sha: c.sha})});
      return;
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
async function edSaveArts(message) {
  const blob = await gh2('/git/blobs', {method: 'POST',
    body: JSON.stringify({content: edArts.join('\n') + '\n', encoding: 'utf-8'})});
  await commit2(message, [{path: 'arts.txt', sha: blob.sha}]);
}

const edArtIndex = art => edArts.findIndex(l => l.trim().toUpperCase() === art.toUpperCase());

async function edAddArt() {
  const art = $('#ed-new-art').value.trim().toUpperCase();
  if (!art) return;
  if (!/^[A-ZА-Я0-9-]{4,20}$/.test(art)) return toast('Это не похоже на артикул', 'err');
  if (edArtIndex(art) >= 0) return toast('Этот артикул уже в каталоге', 'err');
  try {
    edArts.push(art);
    await edSaveArts(`Каталог: добавлен ${art}`);
    $('#ed-new-art').value = '';
    toast('Добавлено. Карточка появится через 1–2 минуты, если артикул есть в таблице.');
  } catch (e) { edArts.pop(); toast('Не получилось: ' + e.message, 'err'); }
}

async function edDropArt() {
  const t = edTiles.find(x => x.art === ED.current);
  if (!t) return;
  if (!confirm(`Убрать «${t.name}» из каталога портала?`)) return;
  const i = edArtIndex(t.art);
  if (i < 0) return toast('Этого артикула нет в arts.txt', 'err');
  const [line] = edArts.splice(i, 1);
  try {
    await edSaveArts(`Каталог: убран ${t.art}`);
    edTiles = edTiles.filter(x => x.art !== t.art);
    ED.current = null;
    edDrawList(); edDrawWork();
    toast('Убрано. Каталог обновится через 1–2 минуты.');
  } catch (e) { edArts.splice(i, 0, line); toast('Не получилось: ' + e.message, 'err'); }
}

async function edLoadFiles() {
  const tree = await gh2('/git/trees/main?recursive=1');
  const byArt = {};
  tree.tree.filter(x => x.type === 'blob')
    .forEach(x => {
      const m = x.path.match(/^docs\/img\/([^/]+)\/(\d+)(_t)?\.jpg$/);
      if (!m) return;
      const [, art, base, isThumb] = m;
      const item = ((byArt[art] ||= {})[base] ||= {f: base + '.jpg'});
      if (isThumb) item.thumbSha = x.sha; else item.sha = x.sha;
    });
  ED.files = Object.fromEntries(Object.entries(byArt).map(([art, m]) =>
    [art, Object.keys(m).sort().map(k => m[k])]));
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
      <p>Слева список каталога: найдите модель по названию или артикулу — справа откроются её фотографии.</p></div>`;
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
          : `<button class="icon" data-eact="cover" data-i="${i}" title="Сделать обложкой">★</button>
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
        <button class="btn sm" id="ed-drop-art" type="button">Убрать из каталога</button>
      </div>
    </div>

    <div class="cover-preview">
      ${coverSrc ? `<img src="${coverSrc}" alt="Обложка модели ${esc(t.name)}">`
                 : '<span class="cp-none">обложки пока нет</span>'}
      <div>
        <b>Обложка карточки</b>
        <p>Первое фото в списке — то, что дилер видит в каталоге. Перетащите фото мышью или пальцем,
          чтобы изменить порядок, либо нажмите ★ на нужном.</p>
        <p>Загружено фотографий: <b>${kept.length}</b>. Рекомендуем JPG, вертикальные,
          не меньше 1000 px по длинной стороне — портал сам уменьшит их до 1600 px и сделает миниатюру.</p>
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

    // тот же коммит обновляет карточку каталога
    const data = JSON.parse(JSON.stringify(edData));
    const tile = data.tiles.find(x => x.art === art);
    tile.photos = names;
    data.tiles.sort((a, b) => (a.photos.length ? 0 : 1) - (b.photos.length ? 0 : 1) ||
      a.format.localeCompare(b.format) || a.name.localeCompare(b.name));
    const blob = await gh2('/git/blobs', {method: 'POST', body: JSON.stringify({
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 1)))), encoding: 'base64'})});
    ops.push({path: 'docs/data.json', sha: blob.sha});

    await commit2(`Фото ${art}: ${names.length} шт.`, ops);
    edData = data;
    await edLoadFiles();
    ED.draft = (ED.files[art] || []).map(p => ({...p, id: p.f}));
    edDrawList(); edDrawWork();
    toast('Опубликовано. Каталог обновится через 1–2 минуты.', 'ok');
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
    edData = await fetch('data.json', {cache: 'no-cache'}).then(r => r.json());
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
    const b = e.target.closest('button[data-eact], #ed-save, #ed-reset, #ed-drop-art'); if (!b) return;
    if (b.id === 'ed-save') return edSave();
    if (b.id === 'ed-drop-art') return edDropArt();
    if (b.id === 'ed-reset') { ED.draft = (ED.files[ED.current] || []).map(p => ({...p, id: p.f})); return edDrawWork(); }
    const i = +b.dataset.i, p = ED.draft[i];
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

async function edAdd(files) {
  toast(`Готовлю ${files.length} фото…`);
  try {
    for (const file of files) {
      const {full, thumb, preview} = await edShrink(file);
      ED.draft.push({id: 'new-' + Math.random().toString(36).slice(2), full, thumb, preview});
    }
    edDrawWork();
    toast('Фото добавлены. Нажмите «Сохранить и опубликовать».', 'ok');
  } catch (e) { toast(e.message); }
}
