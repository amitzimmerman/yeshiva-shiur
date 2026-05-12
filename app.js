const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx_SKDgy53zJy0ekpq6w8LtMIwJrwZq2Jsnba6FUgL5-FBQtrKzBiizDKNWE5rIM_tauw/exec';
let SCRIPT_URL = localStorage.getItem('script_url') || SCRIPT_URL_DEFAULT;

// ─── Admin mode ───────────────────────────────────────────────────────────────
const ADMIN_CODE = 'drorAdmin';   // ← שנה לקוד שאתה רוצה
let isAdmin = localStorage.getItem('isAdmin') === 'yes';

function checkAdmin(callback) {
  if (isAdmin) { callback(); return; }
  // build inline modal
  const overlay = document.createElement('div');
  overlay.className = 'admin-overlay';
  overlay.innerHTML = `
    <div class="admin-box">
      <div class="admin-title">🔐 כניסת מנהל</div>
      <input id="adminInput" class="auth-input" type="password" placeholder="קוד ניהול" />
      <div class="admin-row">
        <button id="adminOk"     class="auth-btn"         style="flex:1">כניסה</button>
        <button id="adminCancel" class="about-cancel-btn" style="flex:0 0 auto">ביטול</button>
      </div>
      <p id="adminErr" class="auth-error" style="display:none;">קוד שגוי</p>
    </div>`;
  document.body.appendChild(overlay);
  const inp = overlay.querySelector('#adminInput');
  inp.focus();
  const attempt = () => {
    if (inp.value === ADMIN_CODE) {
      localStorage.setItem('isAdmin', 'yes');
      isAdmin = true;
      overlay.remove();
      callback();
    } else {
      overlay.querySelector('#adminErr').style.display = 'block';
      inp.value = '';
    }
  };
  overlay.querySelector('#adminOk').addEventListener('click', attempt);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  overlay.querySelector('#adminCancel').addEventListener('click', () => overlay.remove());
}

// ─── Password ─────────────────────────────────────────────────────────────────
(function() {
  const overlay = document.getElementById('authOverlay');
  if (localStorage.getItem('auth') === 'ok') { overlay.style.display = 'none'; return; }
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const check = () => {
    if (document.getElementById('authInput').value === 'drorhiran') {
      localStorage.setItem('auth', 'ok');
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    } else {
      document.getElementById('authError').style.display = 'block';
      document.getElementById('authInput').value = '';
    }
  };
  document.getElementById('authBtn').addEventListener('click', check);
  document.getElementById('authInput').addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
})();

// ─── Marks ────────────────────────────────────────────────────────────────────
let liked      = new Set(JSON.parse(localStorage.getItem('liked')      || '[]'));
let watched    = new Set(JSON.parse(localStorage.getItem('watched')    || '[]'));
let downloaded = new Set(JSON.parse(localStorage.getItem('downloaded') || '[]'));
function saveMarks() {
  localStorage.setItem('liked',      JSON.stringify([...liked]));
  localStorage.setItem('watched',    JSON.stringify([...watched]));
  localStorage.setItem('downloaded', JSON.stringify([...downloaded]));
}

// ─── State ────────────────────────────────────────────────────────────────────
// view: 'rabbis' | 'series' | 'shiurim'
let view          = 'rabbis';
let allData       = [];   // [{id, name, series:[{id, name, files:[]}]}]
let currentRabbi  = null;
let currentSeries = null;
let activeFilter  = 'all';
let searchQuery   = '';
let searchScope   = 'all'; // 'all' | 'rabbis' | 'series'
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

// ─── Fetch ────────────────────────────────────────────────────────────────────
const DATA_CACHE_KEY = 'shiurim_cache_v1';
const STATIC_JSON    = 'lessons.json';
const GITHUB_REPO    = 'amitzimmerman/yeshiva-shiur';

function parseAndFilter(data) {
  if (!Array.isArray(data)) throw new Error('תגובה לא תקינה');
  return data.filter(r => r.series && r.series.some(s => s.files && s.files.length > 0));
}

function saveToCache(data) {
  localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
}

// ─── Regular load: cache → lessons.json — never hits Apps Script ──────────────
async function fetchData(forceRefresh = false) {
  // 1. localStorage cache (instant, skip if force-refresh)
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) {
        const { data } = JSON.parse(raw);
        if (data && data.length > 0) {
          allData = data;
          showRabbis();
          return;
        }
      }
    } catch(_) {}
  }

  // 2. lessons.json from CDN (fast, ~100ms)
  setView('loading');
  try {
    const url = forceRefresh ? (STATIC_JSON + '?t=' + Date.now()) : STATIC_JSON;
    const res = await fetch(url);
    if (res.ok) {
      const data = parseAndFilter(await res.json());
      if (data.length > 0) {
        allData = data;
        saveToCache(data);
        showRabbis();
        return;
      }
    }
  } catch(_) {}

  // 3. Fall back to stale cache if available
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    if (raw) {
      const { data } = JSON.parse(raw);
      if (data && data.length > 0) {
        allData = data;
        showRabbis();
        showToast('⚠️ מציג נתונים שמורים — לחץ סנכרן לעדכון');
        return;
      }
    }
  } catch(_) {}

  // 4. No data at all
  document.getElementById('errorMsg').textContent =
    'לא נמצאו שיעורים. המנהל צריך ללחוץ על ⚙️ → "סנכרן שיעורים" פעם אחת.';
  setView('error');
}

// ─── Admin sync: Apps Script → GitHub → cache ─────────────────────────────────
async function adminSync() {
  const btn       = document.getElementById('syncBtn');
  const status    = document.getElementById('syncStatus');
  const ghToken   = localStorage.getItem('gh_token') || '';
  btn.disabled    = true;
  btn.textContent = '⏳ שואב מ-Drive...';
  status.textContent = '';

  try {
    // Step 1: fetch from Apps Script
    const res = await fetch(SCRIPT_URL);
    if (!res.ok) throw new Error(`שגיאת Apps Script: ${res.status}`);
    const raw  = await res.json();
    if (raw.error) throw new Error(raw.error);
    const data = parseAndFilter(raw);
    if (data.length === 0) throw new Error('לא נמצאו שיעורים בתיקיות');

    const total = data.reduce((n, r) => n + r.series.reduce((m, s) => m + s.files.length, 0), 0);

    // Step 2: update local cache immediately
    saveToCache(data);
    allData = data;
    if (['rabbis','error','loading','empty'].includes(view)) showRabbis();

    // Step 3: push to GitHub if token set
    if (ghToken) {
      btn.textContent = '⏳ מעלה ל-GitHub...';
      await pushLessonsToGitHub(ghToken, JSON.stringify(data, null, 2));
      status.textContent = `✅ הועלה בהצלחה! ${total} שיעורים — Netlify יתעדכן תוך ~60 שניות`;
      status.style.color = 'var(--green)';
    } else {
      status.textContent = `✅ עודכן מקומית (${total} שיעורים). הגדר GitHub Token לסנכרון מלא.`;
      status.style.color = 'var(--green)';
    }
  } catch(e) {
    status.textContent = '❌ ' + e.message;
    status.style.color = 'var(--red)';
  } finally {
    btn.textContent = '🔄 סנכרן שיעורים';
    btn.disabled    = false;
  }
}

// ─── Push lessons.json to GitHub via API ──────────────────────────────────────
async function pushLessonsToGitHub(token, content) {
  const API = `https://api.github.com/repos/${GITHUB_REPO}/contents/lessons.json`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json'
  };

  // Get existing file SHA (required for update)
  let sha = '';
  try {
    const r = await fetch(API, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch(_) {}

  // Encode Hebrew content to base64
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body    = { message: 'sync: עדכון שיעורים', content: encoded };
  if (sha) body.sha = sha;

  const r = await fetch(API, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error('GitHub: ' + (err.message || r.status));
  }
}

// ─── View manager ─────────────────────────────────────────────────────────────
function setView(name) {
  document.getElementById('loadingState').style.display   = name === 'loading'  ? 'block' : 'none';
  document.getElementById('errorState').style.display     = name === 'error'    ? 'block' : 'none';
  document.getElementById('rabbisGrid').style.display     = name === 'rabbis'   ? 'grid'  : 'none';
  document.getElementById('seriesGrid').style.display     = name === 'series'   ? 'grid'  : 'none';
  document.getElementById('shiurimList').style.display    = ['shiurim','search','favorites','downloads'].includes(name) ? 'flex' : 'none';
  document.getElementById('emptyState').style.display     = name === 'empty'    ? 'block' : 'none';
  document.getElementById('quickFilterBar').style.display = name === 'shiurim'  ? 'block' : 'none';

  const shiurCtrls = document.getElementById('shiurControls');
  shiurCtrls.style.display = name === 'shiurim' ? 'contents' : 'none';

  view = name;
  updateBreadcrumb();
  // Mobile back button: visible whenever not on home
  const mbb = document.getElementById('mobileBackBtn');
  mbb.style.display = (name === 'rabbis') ? 'none' : 'block';
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
  } else {
    bcRabbi.style.display = 'none';
    bcSep2.style.display  = 'none';
    bcCur.textContent = view === 'favorites'  ? '❤️ מועדפים'
                      : view === 'downloads'  ? '⬇️ הורדות'
                      : view === 'search'     ? '🔍 חיפוש'
                      : '';
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
      downloaded.add(f.id); saveMarks(); showToast('⬇️ מתחיל הורדה...');
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
  const page = document.getElementById('playerPage');
  document.getElementById('ppFrame').src = `https://drive.google.com/file/d/${f.id}/preview`;
  document.getElementById('ppTitle').textContent = cleanName(f.name);

  const crumbParts = [];
  if (playerContext?.rabbi) crumbParts.push(playerContext.rabbi.name);
  if (playerContext?.series) crumbParts.push(playerContext.series.name);
  document.getElementById('ppCrumb').textContent = crumbParts.join(' › ');

  page.style.display = 'flex';
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  updatePlayerPage(f);
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
  document.body.style.overflow = '';
  playingId = null;
});

// ─── Download all ─────────────────────────────────────────────────────────────
document.getElementById('dlAllBtn').addEventListener('click', () => {
  if (!currentSeries) return;
  const files = currentSeries.files.filter(f => f.id);
  if (!files.length) return;
  showToast(`⬇️ מוריד ${files.length} שיעורים...`);
  files.forEach((f, i) => {
    setTimeout(() => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'display:none;width:0;height:0;position:absolute;';
      iframe.src = dlUrl(f.id);
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 15000);
    }, i * 1500);
  });
});

// ─── Navigation events ────────────────────────────────────────────────────────
document.getElementById('bcHome').addEventListener('click', showRabbis);
document.getElementById('bcRabbi').addEventListener('click', () => {
  if (currentRabbi) showSeries(currentRabbi);
});
document.getElementById('reloadBtn').addEventListener('click', () => {
  localStorage.removeItem(DATA_CACHE_KEY);
  fetchData(true);
});
document.getElementById('reloadOnError').addEventListener('click', () => {
  localStorage.removeItem(DATA_CACHE_KEY);
  fetchData(true);
});

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

    setPathBreadcrumb(clone.querySelector('.card-date'), rabbi, series);
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, results.map(r => r.f), { rabbi, series }));

    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => { downloaded.add(f.id); saveMarks(); showToast('⬇️ מתחיל הורדה...'); });

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

// helper: clickable rabbi › series path
function setPathBreadcrumb(el, rabbi, series) {
  el.innerHTML = '';
  const r = document.createElement('button');
  r.className = 'path-btn'; r.textContent = rabbi.name;
  r.addEventListener('click', e => { e.stopPropagation(); showSeries(rabbi); });
  const sep = document.createTextNode(' › ');
  const s = document.createElement('button');
  s.className = 'path-btn'; s.textContent = series.name;
  s.addEventListener('click', e => { e.stopPropagation(); currentRabbi = rabbi; showShiurim(series); });
  el.append(r, sep, s);
}

// ─── Series search (cross-rabbi) ─────────────────────────────────────────────
function renderSeriesSearch() {
  const q = searchQuery.toLowerCase();
  const results = [];
  allData.forEach(rabbi => {
    rabbi.series.forEach(series => {
      if (series.files && series.files.length > 0 &&
          series.name.toLowerCase().includes(q)) {
        results.push({ rabbi, series });
      }
    });
  });

  if (results.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו סדרות';
    setView('empty'); return;
  }

  setView('series');
  const grid = document.getElementById('seriesGrid');
  grid.innerHTML = '';

  results.forEach(({ rabbi, series }) => {
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
        <div class="series-search-rabbi">${rabbi.name}</div>
        <div class="grid-card-name">${series.name}</div>
        <div class="grid-card-meta">
          <strong>${total}</strong> שיעורים
          ${doneNum ? `· <span style="color:var(--green)">✅ ${doneNum}</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => { currentRabbi = rabbi; showShiurim(series); });
    grid.appendChild(card);
  });
}

// ─── Favorites ───────────────────────────────────────────────────────────────
function renderFavorites() {
  const results = [];
  allData.forEach(rabbi => {
    rabbi.series.forEach(series => {
      (series.files || []).forEach(f => {
        if (liked.has(f.id)) results.push({ f, rabbi, series });
      });
    });
  });

  if (results.length === 0) {
    document.getElementById('emptyMsg').textContent = 'אין שיעורים מועדפים עדיין — לחץ ❤️ על שיעור כדי להוסיף';
    setView('empty'); return;
  }

  setView('favorites');
  const list = document.getElementById('shiurimList');
  list.innerHTML = '';
  const tmpl = document.getElementById('cardTemplate');

  results.forEach(({ f, rabbi, series }) => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');
    card.classList.add('is-liked');
    if (watched.has(f.id)) card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    setPathBreadcrumb(clone.querySelector('.card-date'), rabbi, series);
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, results.map(r => r.f), { rabbi, series }));

    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => { downloaded.add(f.id); saveMarks(); showToast('⬇️ מתחיל הורדה...'); });

    const btnWa = clone.querySelector('.btn-wa');
    btnWa.href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

    const btnLike = clone.querySelector('.btn-like');
    btnLike.textContent = '❤️'; btnLike.classList.add('active');
    btnLike.addEventListener('click', () => {
      liked.delete(f.id); saveMarks(); showToast('💔 הוסר מהמועדפים'); renderFavorites();
    });

    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      saveMarks(); renderFavorites();
    });

    list.appendChild(clone);
  });
}

// ─── Downloads history ────────────────────────────────────────────────────────
function renderDownloaded() {
  const results = [];
  allData.forEach(rabbi => {
    rabbi.series.forEach(series => {
      (series.files || []).forEach(f => {
        if (downloaded.has(f.id)) results.push({ f, rabbi, series });
      });
    });
  });

  if (results.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא הורדת שיעורים עדיין';
    setView('empty'); return;
  }

  setView('downloads');
  const list = document.getElementById('shiurimList');
  list.innerHTML = '';
  const tmpl = document.getElementById('cardTemplate');

  results.forEach(({ f, rabbi, series }) => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');
    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    setPathBreadcrumb(clone.querySelector('.card-date'), rabbi, series);
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, results.map(r => r.f), { rabbi, series }));

    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => showToast('⬇️ מתחיל הורדה...'));

    const btnWa = clone.querySelector('.btn-wa');
    btnWa.href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

    const btnLike = clone.querySelector('.btn-like');
    btnLike.textContent = liked.has(f.id) ? '❤️' : '🤍';
    if (liked.has(f.id)) btnLike.classList.add('active');
    btnLike.addEventListener('click', () => {
      liked.has(f.id) ? liked.delete(f.id) : liked.add(f.id);
      saveMarks(); renderDownloaded();
    });

    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      saveMarks(); renderDownloaded();
    });

    list.appendChild(clone);
  });
}

document.getElementById('favoritesBtn').addEventListener('click', () => {
  currentRabbi = null; currentSeries = null; searchQuery = '';
  document.getElementById('searchInput').value = '';
  renderFavorites();
});

document.getElementById('downloadsBtn').addEventListener('click', () => {
  currentRabbi = null; currentSeries = null; searchQuery = '';
  document.getElementById('searchInput').value = '';
  renderDownloaded();
});

// ─── Search ───────────────────────────────────────────────────────────────────
function runSearch() {
  if (!searchQuery.trim()) {
    if (currentSeries)     renderShiurim();
    else if (currentRabbi) renderSeries();
    else                   renderRabbis();
    return;
  }
  if (searchScope === 'rabbis') {
    currentRabbi = null; currentSeries = null;
    renderRabbis();          // renderRabbis already filters by searchQuery
  } else if (searchScope === 'series') {
    renderSeriesSearch();
  } else {
    renderGlobalSearch();    // search shiurim names
  }
}

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value;
  runSearch();
});

document.getElementById('searchScope').addEventListener('change', e => {
  searchScope = e.target.value;
  // Update placeholder
  const ph = { all: 'חיפוש שיעור...', rabbis: 'חיפוש רב...', series: 'חיפוש סדרה...' };
  document.getElementById('searchInput').placeholder = ph[searchScope] || 'חיפוש...';
  if (searchQuery.trim()) runSearch();
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
  checkAdmin(() => {
    scriptUrlInput.value = SCRIPT_URL;
    document.getElementById('ghTokenInput').value = localStorage.getItem('gh_token') || '';
    document.getElementById('syncStatus').textContent = '';
    settingsModal.style.display = 'flex';
  });
});
document.getElementById('settingsCancel').addEventListener('click', () => {
  settingsModal.style.display = 'none';
});
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) settingsModal.style.display = 'none';
});
document.getElementById('settingsSave').addEventListener('click', () => {
  const url = scriptUrlInput.value.trim();
  if (url && !url.startsWith('https://script.google.com/')) {
    showToast('⚠️ קישור Apps Script לא תקין');
    return;
  }
  if (url) { localStorage.setItem('script_url', url); SCRIPT_URL = url; }
  const tok = document.getElementById('ghTokenInput').value.trim();
  if (tok)  localStorage.setItem('gh_token', tok);
  else      localStorage.removeItem('gh_token');
  settingsModal.style.display = 'none';
  showToast('✅ ההגדרות נשמרו');
});
document.getElementById('syncBtn').addEventListener('click', adminSync);

// ─── Logo → home ─────────────────────────────────────────────────────────────
document.getElementById('logoArea').addEventListener('click', showRabbis);

// ─── Mobile back button ───────────────────────────────────────────────────────
document.getElementById('mobileBackBtn').addEventListener('click', () => {
  if (view === 'shiurim')  showSeries(currentRabbi);
  else                     showRabbis();
});

// ─── About page ───────────────────────────────────────────────────────────────
const ABOUT_DEFAULTS = {
  title:   'ישיבת דרור חירן',
  p1:      'ישיבת דרור חירן היא ישיבה תיכונית המשלבת תורה ועבודה, ערכים יהודיים ואהבת הארץ.',
  p2:      'האתר מרכז שיעורי תורה מרבני הישיבה להאזנה ולהורדה חינם, לתלמידים ולבוגרים כאחד.',
  contact: 'לפרטים נוספים ויצירת קשר — פנו לישיבה ישירות.',
  location: ''
};

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getAboutContent() {
  try {
    const raw = localStorage.getItem('about_content');
    if (raw) return Object.assign({}, ABOUT_DEFAULTS, JSON.parse(raw));
  } catch(e) {}
  return Object.assign({}, ABOUT_DEFAULTS);
}

function renderAboutPage(editing) {
  const data = getAboutContent();
  const container = document.getElementById('aboutContent');

  if (editing) {
    container.innerHTML = `
      <div class="about-logo-wrap"><img src="dror-logo.png" class="about-logo" alt="לוגו" /></div>
      <div class="about-edit-group">
        <label class="about-edit-label">שם</label>
        <input  id="aEditTitle"    class="about-edit-input about-edit-title-input" placeholder="שם הישיבה" />
      </div>
      <div class="about-edit-group">
        <label class="about-edit-label">פסקה 1</label>
        <textarea id="aEditP1" class="about-edit-textarea" rows="3"></textarea>
      </div>
      <div class="about-edit-group">
        <label class="about-edit-label">פסקה 2</label>
        <textarea id="aEditP2" class="about-edit-textarea" rows="3"></textarea>
      </div>
      <div class="about-edit-group">
        <label class="about-edit-label">יצירת קשר</label>
        <textarea id="aEditContact" class="about-edit-textarea" rows="2"></textarea>
      </div>
      <div class="about-edit-group">
        <label class="about-edit-label">📍 מיקום / כתובת</label>
        <input id="aEditLocation" class="about-edit-input" placeholder="לדוגמה: חירן, ישראל" />
        <span class="about-edit-hint">הכתובת תוצג כמפה בתחתית הדף</span>
      </div>
      <div class="about-edit-actions">
        <button id="aEditSave"   class="about-save-btn">💾 שמור</button>
        <button id="aEditCancel" class="about-cancel-btn">ביטול</button>
      </div>
    `;
    // Set values after render (avoids HTML-escape issues)
    document.getElementById('aEditTitle').value    = data.title;
    document.getElementById('aEditP1').value       = data.p1;
    document.getElementById('aEditP2').value       = data.p2;
    document.getElementById('aEditContact').value  = data.contact;
    document.getElementById('aEditLocation').value = data.location;

    document.getElementById('aEditSave').addEventListener('click', () => {
      const saved = {
        title:    document.getElementById('aEditTitle').value.trim()    || ABOUT_DEFAULTS.title,
        p1:       document.getElementById('aEditP1').value.trim(),
        p2:       document.getElementById('aEditP2').value.trim(),
        contact:  document.getElementById('aEditContact').value.trim(),
        location: document.getElementById('aEditLocation').value.trim()
      };
      localStorage.setItem('about_content', JSON.stringify(saved));
      showToast('✅ נשמר בהצלחה');
      renderAboutPage(false);
    });
    document.getElementById('aEditCancel').addEventListener('click', () => renderAboutPage(false));

  } else {
    // View mode
    const mapHtml = data.location ? `
      <div class="about-map-wrap">
        <iframe class="about-map-frame"
          src="https://maps.google.com/maps?q=${encodeURIComponent(data.location)}&output=embed&hl=he&z=15"
          frameborder="0" allowfullscreen loading="lazy"></iframe>
      </div>` : '';

    container.innerHTML = `
      <div class="about-logo-wrap"><img src="dror-logo.png" class="about-logo" alt="לוגו" /></div>
      <h1 class="about-title">${esc(data.title)}</h1>
      <div class="about-content">
        ${data.p1      ? `<p>${esc(data.p1)}</p>`                                      : ''}
        ${data.p2      ? `<p>${esc(data.p2)}</p>`                                      : ''}
        ${data.contact ? `<hr class="about-divider"/><p class="about-contact">${esc(data.contact)}</p>` : ''}
      </div>
      ${data.location ? `
      <div class="about-location-section">
        <div class="about-section-title">📍 מיקום</div>
        <p class="about-location-text">${esc(data.location)}</p>
        ${mapHtml}
      </div>` : ''}
      ${isAdmin ? `<button id="aboutEditBtn" class="about-edit-btn">✏️ ערוך</button>` : ''}
    `;
    if (isAdmin) document.getElementById('aboutEditBtn').addEventListener('click', () => renderAboutPage(true));
  }
}

document.getElementById('aboutBtn').addEventListener('click', () => {
  renderAboutPage(false);
  document.getElementById('aboutPage').style.display = 'flex';
});
document.getElementById('aboutClose').addEventListener('click', () => {
  document.getElementById('aboutPage').style.display = 'none';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
fetchData();
