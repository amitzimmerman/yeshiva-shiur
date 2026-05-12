const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx_SKDgy53zJy0ekpq6w8LtMIwJrwZq2Jsnba6FUgL5-FBQtrKzBiizDKNWE5rIM_tauw/exec';
let SCRIPT_URL = localStorage.getItem('script_url') || SCRIPT_URL_DEFAULT;

// ─── Marks ────────────────────────────────────────────────────────────────────
let liked   = new Set(JSON.parse(localStorage.getItem('liked')   || '[]'));
let watched = new Set(JSON.parse(localStorage.getItem('watched') || '[]'));
function saveMarks() {
  localStorage.setItem('liked',   JSON.stringify([...liked]));
  localStorage.setItem('watched', JSON.stringify([...watched]));
}

// ─── State ────────────────────────────────────────────────────────────────────
// view: 'rabbis' | 'series' | 'shiurim'
let view          = 'rabbis';
let allData       = [];   // [{id, name, series:[{id, name, files:[]}]}]
let currentRabbi  = null;
let currentSeries = null;
let activeFilter  = 'all';
let searchQuery   = '';
let sortBy        = 'name';
let playingId     = null;
let playList      = [];   // ordered list of files currently navigable

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
const DATA_CACHE_KEY = 'shiurim_cache_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 min

function parseAndFilter(data) {
  if (!Array.isArray(data)) throw new Error('תגובה לא תקינה');
  return data.filter(r => r.series && r.series.some(s => s.files && s.files.length > 0));
}

async function fetchFromNetwork() {
  const res = await fetch(SCRIPT_URL);
  if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
  const data = parseAndFilter(await res.json());
  localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  return data;
}

async function fetchData(forceRefresh = false) {
  if (!forceRefresh) {
    // 1. Try localStorage cache (instant)
    try {
      const raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) {
        const { data } = JSON.parse(raw);
        if (data && data.length > 0) {
          allData = data;
          showRabbis();
          refreshInBackground();
          return;
        }
      }
    } catch(e) {}

    // 2. Try data.json from same origin (fast CDN, no spinner)
    try {
      const res = await fetch('data.json');
      if (res.ok) {
        const data = parseAndFilter(await res.json());
        if (data.length > 0) {
          allData = data;
          showRabbis();
          refreshInBackground();
          return;
        }
      }
    } catch(e) {}
  }

  // 3. Fallback: fetch live from Apps Script
  setView('loading');
  try {
    allData = await fetchFromNetwork();
    if (allData.length === 0) throw new Error('לא נמצאו שיעורים. ודא שהקבצים הועברו לתיקיות בדרייב.');
    showRabbis();
  } catch (e) {
    document.getElementById('errorMsg').textContent =
      e.message.includes('Failed to fetch')
        ? 'לא ניתן להתחבר. בדוק חיבור אינטרנט ונסה שוב.'
        : e.message;
    setView('error');
  }
}

function refreshInBackground() {
  fetchFromNetwork().then(fresh => {
    allData = fresh;
    if (view === 'rabbis') renderRabbis();
  }).catch(() => {});
}

// ─── View manager ─────────────────────────────────────────────────────────────
function setView(name) {
  document.getElementById('loadingState').style.display   = name === 'loading'  ? 'block' : 'none';
  document.getElementById('errorState').style.display     = name === 'error'    ? 'block' : 'none';
  document.getElementById('rabbisGrid').style.display     = name === 'rabbis'   ? 'grid'  : 'none';
  document.getElementById('seriesGrid').style.display     = name === 'series'   ? 'grid'  : 'none';
  document.getElementById('shiurimList').style.display    = (name === 'shiurim' || name === 'search') ? 'flex' : 'none';
  document.getElementById('emptyState').style.display     = name === 'empty'    ? 'block' : 'none';
  document.getElementById('quickFilterBar').style.display = name === 'shiurim'  ? 'block' : 'none';

  const shiurCtrls = document.getElementById('shiurControls');
  shiurCtrls.style.display = name === 'shiurim' ? 'contents' : 'none';

  view = name;
  updateBreadcrumb();
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────
function updateBreadcrumb() {
  const bc      = document.getElementById('breadcrumb');
  const bcRabbi = document.getElementById('bcRabbi');
  const bcSep2  = document.getElementById('bcSep2');
  const bcCur   = document.getElementById('bcCurrent');

  if (view === 'rabbis') {
    bc.style.display = 'none';
    return;
  }
  bc.style.display = 'flex';

  if (view === 'series') {
    bcRabbi.style.display = 'none';
    bcSep2.style.display  = 'none';
    bcCur.textContent     = currentRabbi?.name || '';
  } else if (view === 'shiurim') {
    bcRabbi.textContent   = currentRabbi?.name || '';
    bcRabbi.style.display = 'inline-block';
    bcSep2.style.display  = 'inline';
    bcCur.textContent     = currentSeries?.name || '';
  }
}

function updateSearch() {
  const ph = {
    rabbis:  'חיפוש רב...',
    series:  'חיפוש סדרה...',
    shiurim: 'חיפוש שיעור...',
  };
  document.getElementById('searchInput').placeholder = ph[view] || 'חיפוש...';
  document.getElementById('searchInput').value = '';
  searchQuery = '';
}

// ─── Rabbis view ──────────────────────────────────────────────────────────────
function showRabbis() {
  currentRabbi = null; currentSeries = null;
  updateSearch();
  setView('rabbis');
  renderRabbis();
}

function renderRabbis() {
  const q    = searchQuery.toLowerCase();
  const list = allData.filter(r => !q || r.name.toLowerCase().includes(q));

  if (list.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו רבנים';
    setView('empty'); return;
  }
  setView('rabbis');

  const grid = document.getElementById('rabbisGrid');
  grid.innerHTML = '';
  list.forEach(rabbi => {
    const nonEmptySeries = rabbi.series.filter(s => s.files && s.files.length > 0);
    const total   = nonEmptySeries.reduce((s, sr) => s + sr.files.length, 0);
    const doneNum = nonEmptySeries.reduce((s, sr) =>
      s + sr.files.filter(f => watched.has(f.id)).length, 0);
    const pct = total ? Math.round((doneNum / total) * 100) : 0;

    const initial = rabbi.name.replace(/^הרב\s+/, '').charAt(0) || '?';
    const card = document.createElement('div');
    card.className = 'grid-card';
    card.innerHTML = `
      <div class="grid-card-cover">
        <div class="grid-card-avatar">${initial}</div>
      </div>
      <div class="grid-card-body">
        <div class="grid-card-name">${rabbi.name}</div>
        <div class="grid-card-meta">
          <strong>${nonEmptySeries.length}</strong> סדרות ·
          <strong>${total}</strong> שיעורים
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => showSeries(rabbi));
    grid.appendChild(card);
  });
}

// ─── Series view ──────────────────────────────────────────────────────────────
function showSeries(rabbi) {
  currentRabbi = rabbi; currentSeries = null;
  updateSearch();
  setView('series');
  renderSeries();
}

function renderSeries() {
  const q    = searchQuery.toLowerCase();
  const list = currentRabbi.series.filter(s =>
    s.files.length > 0 && (!q || s.name.toLowerCase().includes(q)));

  if (list.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו סדרות';
    setView('empty'); return;
  }
  setView('series');

  const grid = document.getElementById('seriesGrid');
  grid.innerHTML = '';
  list.forEach(series => {
    const total   = series.files.length;
    const doneNum = series.files.filter(f => watched.has(f.id)).length;
    const pct     = total ? Math.round((doneNum / total) * 100) : 0;

    const initial = series.name.charAt(0) || '?';
    const card = document.createElement('div');
    card.className = 'grid-card';
    card.innerHTML = `
      <div class="grid-card-cover grid-card-cover--series">
        <div class="grid-card-avatar">${initial}</div>
      </div>
      <div class="grid-card-body">
        <div class="grid-card-name">${series.name}</div>
        <div class="grid-card-meta">
          <strong>${total}</strong> שיעורים
          ${doneNum ? `· <span style="color:var(--green)">✅ ${doneNum}</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => showShiurim(series));
    grid.appendChild(card);
  });
}

// ─── Shiurim view ─────────────────────────────────────────────────────────────
function showShiurim(series) {
  currentSeries = series;
  activeFilter  = 'all';
  sortBy        = 'name';
  updateSearch();
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.qf-btn[data-filter="all"]').classList.add('active');
  document.getElementById('sortBy').value = 'name';
  setView('shiurim');
  renderShiurim();
}

function getFiltered() {
  if (!currentSeries) return [];
  const q = searchQuery.toLowerCase();
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
  document.getElementById('statsTotal').textContent   = `${filtered.length} שיעורים`;
  document.getElementById('statsLiked').textContent   = `${liked.size} ❤️`;
  document.getElementById('statsWatched').textContent = `${watched.size} ✅`;

  const list = document.getElementById('shiurimList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו שיעורים';
    setView('empty'); return;
  }
  setView('shiurim');

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
    btnPlay.addEventListener('click', () => playFile(f, filtered, { rabbi: currentRabbi, series: currentSeries }));

    const btnWa = clone.querySelector('.btn-wa');
    const waText = encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`);
    btnWa.href = `https://wa.me/?text=${waText}`;

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


// ─── Player Page ──────────────────────────────────────────────────────────────
let playerContext = null; // { rabbi, series } when known

function playFile(f, list, context) {
  if (list) playList = list;
  if (context) playerContext = context;
  playingId = f.id;
  openPlayerPage(f);
}

function openPlayerPage(f) {
  const page  = document.getElementById('playerPage');
  document.getElementById('ppFrame').src =
    `https://drive.google.com/file/d/${f.id}/preview`;
  document.getElementById('ppTitle').textContent = cleanName(f.name);

  const crumbParts = [];
  if (playerContext?.rabbi) crumbParts.push(playerContext.rabbi.name);
  if (playerContext?.series) crumbParts.push(playerContext.series.name);
  document.getElementById('ppCrumb').textContent = crumbParts.join(' › ');

  page.style.display = 'flex';
  page.scrollTop = 0;
  updatePlayerPage(f);

  watched.add(f.id); saveMarks();
}

function updatePlayerPage(f) {
  const idx = playList.findIndex(x => x.id === f.id);

  document.getElementById('ppPrev').disabled = idx <= 0;
  document.getElementById('ppNext').disabled = idx < 0 || idx >= playList.length - 1;
  document.getElementById('ppCounter').textContent =
    playList.length ? `${idx + 1} / ${playList.length}` : '';

  const dlBtn = document.getElementById('ppDl');
  dlBtn.href = dlUrl(f.id);

  const waBtn = document.getElementById('ppWa');
  waBtn.href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

  const likeBtn = document.getElementById('ppLike');
  likeBtn.textContent = liked.has(f.id) ? '❤️ אהבתי' : '🤍 אהבתי';
  likeBtn.classList.toggle('active', liked.has(f.id));
  likeBtn.onclick = () => {
    liked.has(f.id) ? liked.delete(f.id) : liked.add(f.id);
    saveMarks(); updatePlayerPage(f);
    showToast(liked.has(f.id) ? '❤️ נוסף למועדפים' : '💔 הוסר מהמועדפים');
  };

  const watchBtn = document.getElementById('ppWatched');
  watchBtn.textContent = watched.has(f.id) ? '✅ ראיתי' : '☐ ראיתי';
  watchBtn.classList.toggle('active', watched.has(f.id));
  watchBtn.onclick = () => {
    watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
    saveMarks(); updatePlayerPage(f);
    showToast(watched.has(f.id) ? '✅ סומן כנצפה' : '🔵 סומן כלא נצפה');
  };

  // Sources (PDF)
  const sourcesDiv   = document.getElementById('ppSources');
  const sourceFrame  = document.getElementById('ppSourceFrame');
  if (f.sourceId) {
    sourceFrame.src = `https://drive.google.com/file/d/${f.sourceId}/preview`;
    sourcesDiv.style.display = 'block';
  } else {
    sourcesDiv.style.display = 'none';
    sourceFrame.src = '';
  }

  document.getElementById('ppPrev').onclick = () => {
    if (idx > 0) { playingId = playList[idx - 1].id; openPlayerPage(playList[idx - 1]); }
  };
  document.getElementById('ppNext').onclick = () => {
    if (idx < playList.length - 1) { playingId = playList[idx + 1].id; openPlayerPage(playList[idx + 1]); }
  };
}

document.getElementById('ppClose').addEventListener('click', () => {
  document.getElementById('ppFrame').src = '';
  document.getElementById('playerPage').style.display = 'none';
  playingId = null;
});

// ─── Download all ─────────────────────────────────────────────────────────────
document.getElementById('dlAllBtn').addEventListener('click', () => {
  if (!currentSeries) return;
  const files = currentSeries.files.filter(f => f.id);
  if (files.length === 0) return;
  showToast(`⬇️ מוריד ${files.length} שיעורים...`);
  files.forEach((f, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = dlUrl(f.id);
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      watched.add(f.id);
    }, i * 700);
  });
  setTimeout(() => { saveMarks(); renderShiurim(); }, 300);
});

// ─── Navigation events ────────────────────────────────────────────────────────
document.getElementById('bcHome').addEventListener('click', showRabbis);
document.getElementById('bcRabbi').addEventListener('click', () => {
  if (currentRabbi) showSeries(currentRabbi);
});
document.getElementById('reloadBtn').addEventListener('click', () => fetchData(true));
document.getElementById('reloadOnError').addEventListener('click', () => fetchData(true));

// ─── Global search ────────────────────────────────────────────────────────────
function renderGlobalSearch() {
  const q = searchQuery.toLowerCase();
  const results = [];
  allData.forEach(rabbi => {
    rabbi.series.forEach(series => {
      if (!series.files || series.files.length === 0) return;
      series.files.forEach(f => {
        if (cleanName(f.name).toLowerCase().includes(q)) {
          results.push({ f, rabbi, series });
        }
      });
    });
  });

  if (results.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו שיעורים';
    setView('empty'); return;
  }

  setView('search');
  const list = document.getElementById('shiurimList');
  list.innerHTML = '';
  const tmpl = document.getElementById('cardTemplate');

  results.forEach(({ f, rabbi, series }) => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = `${rabbi.name} › ${series.name}`;
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, results.map(r => r.f), { rabbi, series }));

    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => {
      watched.add(f.id); saveMarks();
      showToast('⬇️ מתחיל הורדה — סומן כנצפה');
      setTimeout(renderGlobalSearch, 150);
    });

    const btnWa = clone.querySelector('.btn-wa');
    btnWa.href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

    const btnLike = clone.querySelector('.btn-like');
    btnLike.textContent = liked.has(f.id) ? '❤️' : '🤍';
    if (liked.has(f.id)) btnLike.classList.add('active');
    btnLike.addEventListener('click', () => {
      liked.has(f.id) ? liked.delete(f.id) : liked.add(f.id);
      showToast(liked.has(f.id) ? '❤️ נוסף למועדפים' : '💔 הוסר מהמועדפים');
      saveMarks(); renderGlobalSearch();
    });

    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      showToast(watched.has(f.id) ? '✅ סומן כנצפה' : '🔵 סומן כלא נצפה');
      saveMarks(); renderGlobalSearch();
    });

    list.appendChild(clone);
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value;
  if (searchQuery.trim()) {
    renderGlobalSearch();
  } else {
    if (currentSeries)     renderShiurim();
    else if (currentRabbi) renderSeries();
    else                   renderRabbis();
  }
});

// ─── Shiurim controls ─────────────────────────────────────────────────────────
document.getElementById('sortBy').addEventListener('change', e => {
  sortBy = e.target.value; renderShiurim();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  searchQuery = ''; activeFilter = 'all'; sortBy = 'name';
  document.getElementById('searchInput').value = '';
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

// ─── Settings ─────────────────────────────────────────────────────────────────
const settingsModal  = document.getElementById('settingsModal');
const scriptUrlInput = document.getElementById('scriptUrlInput');

document.getElementById('settingsBtn').addEventListener('click', () => {
  scriptUrlInput.value = SCRIPT_URL;
  settingsModal.style.display = 'flex';
});
document.getElementById('settingsCancel').addEventListener('click', () => {
  settingsModal.style.display = 'none';
});
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) settingsModal.style.display = 'none';
});
document.getElementById('settingsSave').addEventListener('click', () => {
  const url = scriptUrlInput.value.trim();
  if (!url.startsWith('https://script.google.com/')) {
    showToast('⚠️ קישור לא תקין — חייב להתחיל ב-script.google.com');
    return;
  }
  localStorage.setItem('script_url', url);
  localStorage.removeItem(DATA_CACHE_KEY);
  SCRIPT_URL = url;
  settingsModal.style.display = 'none';
  showToast('✅ נשמר — טוען נתונים...');
  fetchData(true);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
fetchData();
