// ─── Config ───────────────────────────────────────────────────────────────────
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwoUpXTtNcrCj14mc_JvaQMcCJp6DgVSsARfLkxKvxG17iB3HlnZ8Oh1JgY8ZYj1pFn/exec';

// ─── Marks ────────────────────────────────────────────────────────────────────
let liked   = new Set(JSON.parse(localStorage.getItem('liked')   || '[]'));
let watched = new Set(JSON.parse(localStorage.getItem('watched') || '[]'));
function saveMarks() {
  localStorage.setItem('liked',   JSON.stringify([...liked]));
  localStorage.setItem('watched', JSON.stringify([...watched]));
}

// ─── State ────────────────────────────────────────────────────────────────────
let allSeries      = [];   // [{id, name, files:[{id,name,date}]}]
let currentSeries  = null; // the series currently open
let activeFilter   = 'all';
let shiurSearch    = '';
let seriesSearch   = '';
let sortBy         = 'name';
let playingId      = null;

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchData() {
  setSeriesSection('loading');
  try {
    const res  = await fetch(SCRIPT_URL);
    if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('תגובה לא תקינה');
    allSeries = data;
    renderSeries();
  } catch (e) {
    document.getElementById('errorMsg').textContent =
      e.message.includes('Failed to fetch')
        ? 'לא ניתן להתחבר. בדוק חיבור אינטרנט ונסה שוב.'
        : e.message;
    setSeriesSection('error');
  }
}

// ─── Series view ──────────────────────────────────────────────────────────────
function setSeriesSection(name) {
  document.getElementById('loadingState').style.display = name === 'loading' ? 'block' : 'none';
  document.getElementById('errorState').style.display   = name === 'error'   ? 'block' : 'none';
  document.getElementById('seriesGrid').style.display   = name === 'grid'    ? 'grid'  : 'none';
  document.getElementById('seriesEmpty').style.display  = name === 'empty'   ? 'block' : 'none';
}

function renderSeries() {
  const q        = seriesSearch.trim().toLowerCase();
  const filtered = allSeries.filter(s => !q || s.name.toLowerCase().includes(q));

  if (filtered.length === 0) { setSeriesSection('empty'); return; }
  setSeriesSection('grid');

  const grid = document.getElementById('seriesGrid');
  grid.innerHTML = '';

  filtered.forEach(series => {
    const total   = series.files.length;
    const doneNum = series.files.filter(f => watched.has(f.id)).length;
    const pct     = total ? Math.round((doneNum / total) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'series-card';
    card.innerHTML = `
      <div class="series-icon">📚</div>
      <div class="series-name">${series.name}</div>
      <div class="series-count">
        <span class="series-count-num">${total}</span> שיעורים
        ${doneNum ? `· <span style="color:var(--green)">✅ ${doneNum} נצפו</span>` : ''}
      </div>
      <div class="series-progress">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>`;
    card.addEventListener('click', () => openSeries(series));
    grid.appendChild(card);
  });
}

function openSeries(series) {
  currentSeries = series;
  activeFilter  = 'all';
  shiurSearch   = '';
  sortBy        = 'name';

  document.getElementById('seriesView').style.display  = 'none';
  document.getElementById('shiurimView').style.display = 'block';
  document.getElementById('seriesTitleBar').textContent = series.name;
  document.getElementById('shiurSearch').value = '';
  document.getElementById('sortBy').value = 'name';
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.qf-btn[data-filter="all"]').classList.add('active');

  renderShiurim();
}

function backToSeries() {
  currentSeries = null;
  document.getElementById('shiurimView').style.display = 'none';
  document.getElementById('seriesView').style.display  = 'block';
  renderSeries();
}

// ─── Shiurim view ─────────────────────────────────────────────────────────────
function getFiltered() {
  if (!currentSeries) return [];
  const q = shiurSearch.trim().toLowerCase();

  let list = currentSeries.files.filter(f => {
    if (q && !cleanName(f.name).toLowerCase().includes(q)) return false;
    if (activeFilter === 'liked'     && !liked.has(f.id))   return false;
    if (activeFilter === 'watched'   && !watched.has(f.id)) return false;
    if (activeFilter === 'unwatched' &&  watched.has(f.id)) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === 'name')      return cleanName(a.name).localeCompare(cleanName(b.name), 'he');
    if (sortBy === 'date_desc') return (b.date || '').localeCompare(a.date || '');
    if (sortBy === 'date_asc')  return (a.date || '').localeCompare(b.date || '');
    return 0;
  });
  return list;
}

function renderShiurim() {
  const filtered = getFiltered();
  const total    = currentSeries?.files.length || 0;

  document.getElementById('statsTotal').textContent   = `${filtered.length} שיעורים`;
  document.getElementById('statsLiked').textContent   = `${liked.size} ❤️`;
  document.getElementById('statsWatched').textContent = `${watched.size} ✅`;

  const list = document.getElementById('shiurimList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    document.getElementById('shiurimEmpty').style.display = 'block';
    list.style.display = 'none';
    return;
  }
  document.getElementById('shiurimEmpty').style.display = 'none';
  list.style.display = 'flex';

  const tmpl = document.getElementById('cardTemplate');
  filtered.forEach(f => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = f.date || '';
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f));

    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => {
      watched.add(f.id); saveMarks();
      showToast('⬇️ מתחיל הורדה — סומן כנצפה');
      setTimeout(renderShiurim, 150);
    });

    const btnLike = clone.querySelector('.btn-like');
    btnLike.textContent = liked.has(f.id) ? '❤️' : '🤍';
    if (liked.has(f.id)) btnLike.classList.add('active');
    btnLike.addEventListener('click', () => {
      liked.has(f.id) ? liked.delete(f.id) : liked.add(f.id);
      showToast(liked.has(f.id) ? '❤️ נוסף למועדפים' : '💔 הוסר מהמועדפים');
      saveMarks(); renderShiurim();
    });

    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      showToast(watched.has(f.id) ? '✅ סומן כנצפה' : '🔵 סומן כלא נצפה');
      saveMarks(); renderShiurim();
    });

    list.appendChild(clone);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanName(f) { return f.replace(/\.[^/.]+$/, ''); }
function dlUrl(id)    { return `https://drive.google.com/uc?export=download&id=${id}`; }

// ─── Player ───────────────────────────────────────────────────────────────────
function playFile(f) {
  if (playingId === f.id) return;
  playingId = f.id;
  document.getElementById('drivePlayer').src = `https://drive.google.com/file/d/${f.id}/preview`;
  document.getElementById('playerTitle').textContent = cleanName(f.name);
  document.getElementById('playerBar').style.display = 'flex';
  renderShiurim();
}

document.getElementById('playerClose').addEventListener('click', () => {
  document.getElementById('drivePlayer').src = '';
  document.getElementById('playerBar').style.display = 'none';
  playingId = null;
  renderShiurim();
});

// ─── Events ───────────────────────────────────────────────────────────────────
document.getElementById('backBtn').addEventListener('click', backToSeries);
document.getElementById('reloadBtn').addEventListener('click', fetchData);
document.getElementById('reloadOnError').addEventListener('click', fetchData);

document.getElementById('seriesSearch').addEventListener('input', e => {
  seriesSearch = e.target.value; renderSeries();
});

document.getElementById('shiurSearch').addEventListener('input', e => {
  shiurSearch = e.target.value; renderShiurim();
});

document.getElementById('sortBy').addEventListener('change', e => {
  sortBy = e.target.value; renderShiurim();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  shiurSearch = ''; activeFilter = 'all'; sortBy = 'name';
  document.getElementById('shiurSearch').value = '';
  document.getElementById('sortBy').value = 'name';
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.qf-btn[data-filter="all"]').classList.add('active');
  renderShiurim();
});

document.querySelectorAll('.qf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderShiurim();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
fetchData();
