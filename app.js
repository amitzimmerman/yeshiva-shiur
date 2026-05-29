const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx_SKDgy53zJy0ekpq6w8LtMIwJrwZq2Jsnba6FUgL5-FBQtrKzBiizDKNWE5rIM_tauw/exec';
let SCRIPT_URL = localStorage.getItem('script_url') || SCRIPT_URL_DEFAULT;

// ─── Admin mode ───────────────────────────────────────────────────────────────
const ADMIN_CODE = 'drorAdmin';
localStorage.removeItem('isAdmin');
sessionStorage.removeItem('isAdmin');
let isAdmin = false;

function checkAdmin(callback) {
  if (isAdmin) { callback(); return; }
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

// ─── Visit tracking ──────────────────────────────────────────────────────────
function logVisit(fresh) {
  const LAST_KEY = 'dror_last_visit_log';
  const now = Date.now();
  // Don't double-log within 5 minutes unless it's a fresh password entry
  if (!fresh && now - (+localStorage.getItem(LAST_KEY) || 0) < 5 * 60 * 1000) return;
  localStorage.setItem(LAST_KEY, now);
  const p = new URLSearchParams({
    action: 'logVisit',
    ts:   new Date(now).toISOString(),
    ua:   navigator.userAgent,
    lang: navigator.language || ''
  });
  fetch(`${SCRIPT_URL}?${p}`, { mode: 'no-cors' }).catch(() => {});
}

// ─── Password — 30 דקות ───────────────────────────────────────────────────────
const AUTH_TTL = 30 * 60 * 1000;
(function() {
  const overlay = document.getElementById('authOverlay');
  try {
    const ts = parseInt(localStorage.getItem('auth_ts') || '0', 10);
    if (ts && Date.now() - ts < AUTH_TTL) {
      overlay.style.display = 'none';
      logVisit(false);
      return;
    }
  } catch(_) {}
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const check = () => {
    if (document.getElementById('authInput').value === 'drorhiran') {
      localStorage.setItem('auth_ts', Date.now().toString());
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      logVisit(true);
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
// מבנה נתונים חדש: עץ תיקיות — {id, name, files:[], folders:[...]}
// navStack: מערך של תיקיות מה-root לתיקייה הנוכחית
let view         = 'rabbis';
let allData      = [];
let navStack     = [];   // [rabbiFolder, sub1, sub2, ...]
let activeFilter = 'all';
let searchQuery  = '';
let searchScope  = 'all';
let sortBy       = 'name';
let playingId    = null;
let playList     = [];

// ─── Tree helpers ─────────────────────────────────────────────────────────────
function countFilesInFolder(folder) {
  let n = (folder.files || []).length;
  (folder.folders || []).forEach(sub => n += countFilesInFolder(sub));
  return n;
}
function countWatchedInFolder(folder) {
  let n = (folder.files || []).filter(f => watched.has(f.id)).length;
  (folder.folders || []).forEach(sub => n += countWatchedInFolder(sub));
  return n;
}
function collectAllFilesFlat(folder, rabbi, results) {
  (folder.files || []).forEach(f => results.push({ f, rabbi, folder }));
  (folder.folders || []).forEach(sub => collectAllFilesFlat(sub, rabbi, results));
}
function collectAllFoldersFlat(folder, rabbi, results, depth) {
  depth = depth || 0;
  if (depth > 0) results.push({ folder, rabbi });
  (folder.folders || []).forEach(sub => collectAllFoldersFlat(sub, rabbi, results, depth + 1));
}
function currentFolder() { return navStack.length > 0 ? navStack[navStack.length - 1] : null; }

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
const DATA_CACHE_KEY = 'shiurim_cache_v2';  // v2 = מבנה עץ חדש
const CACHE_TTL = 6 * 60 * 60 * 1000;

// תמיכה בשני פורמטים: ישן (series) וחדש (folders)
function normalizeNode(node) {
  if (!node) return node;
  // המרת 'series' ל-'folders' לתאימות לאחור
  if (node.series && !node.folders) {
    node.folders = (node.series || []).map(s => normalizeNode(s));
    delete node.series;
  }
  if (!node.folders) node.folders = [];
  if (!node.files)   node.files   = [];
  node.folders = node.folders.map(f => normalizeNode(f));
  return node;
}

function parseAndFilter(data) {
  if (!Array.isArray(data)) throw new Error('תגובה לא תקינה');
  return data.map(normalizeNode).filter(r => countFilesInFolder(r) > 0);
}

async function fetchData(forceRefresh = false) {
  // שלב 1: אם יש Cache תקין — הצג מיד
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw);
        if (data && data.length > 0) {
          allData = data;
          showRabbis();
          // רענן ברקע אם Cache ישן
          if (!ts || Date.now() - ts > CACHE_TTL) refreshFromDataJson();
          return;
        }
      }
    } catch(_) {}
  }

  // שלב 2: אין Cache — טען מ-data.json
  setView('loading');
  document.getElementById('loadingMsg').textContent = 'טוען שיעורים...';

  try {
    const url = 'data.json' + (forceRefresh ? '?t=' + Date.now() : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
    const data = parseAndFilter(await res.json());
    if (data.length === 0) throw new Error('לא נמצאו שיעורים');
    allData = data;
    try { localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
    showRabbis();
    return;
  } catch(e) {
    // נסה Cache ישן לפני שמציג שגיאה
    try {
      const raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) {
        const { data } = JSON.parse(raw);
        if (data && data.length > 0) {
          allData = data;
          showRabbis();
          showToast('⚠️ מציג נתונים שמורים');
          return;
        }
      }
    } catch(_) {}
    document.getElementById('errorMsg').textContent = 'לא ניתן לטעון שיעורים. בדוק חיבור אינטרנט.';
    setView('error');
  }
}

function refreshFromDataJson() {
  fetch('data.json?t=' + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(raw => {
      if (!raw) return;
      const data = parseAndFilter(raw);
      if (data.length > 0) {
        allData = data;
        localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
        if (view === 'rabbis') renderRabbis();
      }
    }).catch(() => {});
}

// ─── View manager ─────────────────────────────────────────────────────────────
function setView(name) {
  document.getElementById('loadingState').style.display   = name === 'loading'  ? 'block' : 'none';
  document.getElementById('errorState').style.display     = name === 'error'    ? 'block' : 'none';
  document.getElementById('rabbisGrid').style.display     = name === 'rabbis'   ? 'grid'  : 'none';
  // 'folder' מציג גם grid וגם list (תיקיות + קבצים ביחד)
  document.getElementById('seriesGrid').style.display     = ['series','folder'].includes(name) ? 'grid' : 'none';
  document.getElementById('shiurimList').style.display    = ['shiurim','search','favorites','downloads','folder'].includes(name) ? 'flex' : 'none';
  document.getElementById('emptyState').style.display     = name === 'empty'    ? 'block' : 'none';
  document.getElementById('quickFilterBar').style.display = name === 'shiurim'  ? 'block' : 'none';

  const shiurCtrls = document.getElementById('shiurControls');
  shiurCtrls.style.display = name === 'shiurim' ? 'contents' : 'none';

  view = name;
  updateBreadcrumb();
  document.getElementById('mobileBackBtn').style.display = (name === 'rabbis') ? 'none' : 'block';
}

// ─── Breadcrumb — בנייה דינמית לפי navStack ──────────────────────────────────
function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (navStack.length === 0) { bc.style.display = 'none'; return; }
  bc.style.display = 'flex';
  bc.innerHTML = '';

  const homeBtn = document.createElement('button');
  homeBtn.className = 'bc-btn';
  homeBtn.textContent = '🏠 ראשי';
  homeBtn.addEventListener('click', showRabbis);
  bc.appendChild(homeBtn);

  navStack.forEach((folder, i) => {
    const sep = document.createElement('span');
    sep.className = 'bc-sep';
    sep.textContent = ' › ';
    bc.appendChild(sep);

    if (i < navStack.length - 1) {
      const btn = document.createElement('button');
      btn.className = 'bc-btn';
      btn.textContent = folder.name;
      const targetIdx = i;
      btn.addEventListener('click', () => {
        navStack = navStack.slice(0, targetIdx + 1);
        renderFolderContents();
        updateBreadcrumb();
      });
      bc.appendChild(btn);
    } else {
      const span = document.createElement('span');
      span.className = 'bc-current';
      span.textContent = folder.name;
      bc.appendChild(span);
    }
  });
}

function updateSearch() {
  document.getElementById('searchInput').placeholder = 'חיפוש...';
  document.getElementById('searchInput').value = '';
  searchQuery = '';
}

// ─── Rabbis view ──────────────────────────────────────────────────────────────
function showRabbis() {
  navStack = [];
  activeFilter = 'all';
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
    const total       = countFilesInFolder(rabbi);
    const doneNum     = countWatchedInFolder(rabbi);
    const pct         = total ? Math.round((doneNum / total) * 100) : 0;
    const folderCount = (rabbi.folders || []).length;
    const initial     = rabbi.name.replace(/^הרב\s+/, '').charAt(0) || '?';

    const card = document.createElement('div');
    card.className = 'grid-card';
    card.innerHTML = `
      <div class="grid-card-cover">
        <div class="grid-card-avatar">${initial}</div>
      </div>
      <div class="grid-card-body">
        <div class="grid-card-name">${rabbi.name}</div>
        <div class="grid-card-meta">
          ${folderCount ? `<strong>${folderCount}</strong> תיקיות · ` : ''}
          <strong>${total}</strong> שיעורים
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => openFolder(rabbi));
    grid.appendChild(card);
  });
}

// ─── Folder navigation ────────────────────────────────────────────────────────
function openFolder(folder) {
  navStack.push(folder);
  history.pushState({ depth: navStack.length }, '');
  activeFilter = 'all';
  sortBy = 'name';
  updateSearch();
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.qf-btn[data-filter="all"]');
  if (allBtn) allBtn.classList.add('active');
  const sortEl = document.getElementById('sortBy');
  if (sortEl) sortEl.value = 'name';
  renderFolderContents();
}

function goBack() {
  if (navStack.length === 0) return;
  navStack.pop();
  if (navStack.length === 0) {
    showRabbis();
  } else {
    renderFolderContents();
    updateBreadcrumb();
  }
}

// ─── Folder contents: תיקיות בתור grid + קבצים בתור list ────────────────────
function renderFolderContents() {
  if (navStack.length === 0) { showRabbis(); return; }
  const folder = navStack[navStack.length - 1];
  const q = searchQuery.toLowerCase();

  const subFolders = (folder.folders || [])
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const files = (folder.files || []);

  const hasSubs  = subFolders.length > 0;
  const hasFiles = files.length > 0;

  if (!hasSubs && !hasFiles) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו תוצאות';
    setView('empty'); return;
  }

  if      (hasSubs && hasFiles) setView('folder');
  else if (hasSubs)              setView('series');
  else                           setView('shiurim');

  // ── grid של תת-תיקיות ──────────────────────────────────────────────────────
  const grid = document.getElementById('seriesGrid');
  grid.innerHTML = '';
  subFolders.forEach(sub => {
    const total    = countFilesInFolder(sub);
    const doneNum  = countWatchedInFolder(sub);
    const pct      = total ? Math.round((doneNum / total) * 100) : 0;
    const initial  = sub.name.charAt(0) || '?';
    const hasSubs2 = sub.folders && sub.folders.length > 0;

    const card = document.createElement('div');
    card.className = 'grid-card';
    card.innerHTML = `
      <div class="grid-card-cover grid-card-cover--series">
        <div class="grid-card-avatar">${initial}</div>
      </div>
      <div class="grid-card-body">
        <div class="grid-card-name">${sub.name}</div>
        <div class="grid-card-meta">
          ${hasSubs2 ? `<strong>${sub.folders.length}</strong> תיקיות · ` : ''}
          <strong>${total}</strong> שיעורים
          ${doneNum ? `· <span style="color:var(--green)">✅ ${doneNum}</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => openFolder(sub));
    grid.appendChild(card);
  });

  // ── רשימת קבצים (אם יש) ───────────────────────────────────────────────────
  if (hasFiles) renderShiurim();
}

// ─── Shiurim view ─────────────────────────────────────────────────────────────
function getFiltered() {
  const folder = currentFolder();
  if (!folder) return [];
  const q = searchQuery.toLowerCase();
  let list = (folder.files || []).filter(f => {
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
    // אם גם אין תת-תיקיות — הצג ריק
    const folder = currentFolder();
    if (!folder || !(folder.folders && folder.folders.length > 0)) {
      document.getElementById('emptyMsg').textContent = 'לא נמצאו שיעורים';
      setView('empty');
    }
    return;
  }

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
    btnPlay.addEventListener('click', () => playFile(f, filtered));

    const btnWa = clone.querySelector('.btn-wa');
    btnWa.href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

    // ⬇ הורד — הורדה לטלפון
    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
    btnDl.addEventListener('click', () => { downloaded.add(f.id); saveMarks(); showToast('⬇️ מוריד...'); });

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
let playerContext = null;

function playFile(f, list) {
  if (list) playList = list;
  playerContext = navStack.map(n => n.name);
  playingId = f.id;
  openPlayerPage(f);
}

async function openPlayerPage(f) {
  const page  = document.getElementById('playerPage');
  const frame = document.getElementById('ppFrame');
  const audio = document.getElementById('ppAudio');

  history.pushState({ player: true }, '');

  document.getElementById('ppTitle').textContent = cleanName(f.name);
  document.getElementById('ppCrumb').textContent = (playerContext || []).join(' › ');

  frame.src = `https://drive.google.com/file/d/${f.id}/preview`;
  frame.style.display = 'block';
  audio.pause(); audio.src = ''; audio.style.display = 'none';

  page.style.display = 'flex';
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  updatePlayerPage(f);
}

function updatePlayerPage(f) {
  const idx = playList.findIndex(x => x.id === f.id);

  document.getElementById('ppPrev').disabled = idx <= 0;
  document.getElementById('ppNext').disabled = idx < 0 || idx >= playList.length - 1;
  document.getElementById('ppCounter').textContent = playList.length ? `${idx + 1} / ${playList.length}` : '';

  document.getElementById('ppDl').href = dlUrl(f.id);
  document.getElementById('ppWa').href = `https://wa.me/?text=${encodeURIComponent(`${cleanName(f.name)}\n${dlUrl(f.id)}`)}`;

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

  const sourcesDiv  = document.getElementById('ppSources');
  const sourceFrame = document.getElementById('ppSourceFrame');
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
  const audio = document.getElementById('ppAudio');
  audio.pause(); audio.src = ''; audio.style.display = 'none';
  document.getElementById('playerPage').style.display = 'none';
  document.body.style.overflow = '';
  playingId = null;
});

// ─── Download all ─────────────────────────────────────────────────────────────
document.getElementById('dlAllBtn').addEventListener('click', () => {
  const folder = currentFolder();
  if (!folder) return;
  const files = (folder.files || []).filter(f => f.id);
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
document.getElementById('reloadBtn').addEventListener('click', () => {
  if (allData.length > 0) { showRabbis(); showToast('🔄 מציג נתונים שמורים'); }
  else fetchData(false);
});
document.getElementById('reloadOnError').addEventListener('click', () => fetchData(true));
document.getElementById('logoArea').addEventListener('click', showRabbis);

document.getElementById('mobileBackBtn').addEventListener('click', goBack);

// ─── Global search ────────────────────────────────────────────────────────────
function renderGlobalSearch() {
  const q = searchQuery.toLowerCase();
  const results = [];
  allData.forEach(rabbi => collectAllFilesFlat(rabbi, rabbi, results));
  const filtered = results.filter(({ f }) => cleanName(f.name).toLowerCase().includes(q));

  if (filtered.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו שיעורים';
    setView('empty'); return;
  }

  setView('search');
  const list = document.getElementById('shiurimList');
  list.innerHTML = '';
  const tmpl = document.getElementById('cardTemplate');

  filtered.forEach(({ f, rabbi, folder }) => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = rabbi.name + (folder.name !== rabbi.name ? ' › ' + folder.name : '');
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, filtered.map(r => r.f)));

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

// ─── Folder search (cross-rabbi) ─────────────────────────────────────────────
function renderFolderSearch() {
  const q = searchQuery.toLowerCase();
  const results = [];
  allData.forEach(rabbi => collectAllFoldersFlat(rabbi, rabbi, results));
  const filtered = results.filter(({ folder }) => folder.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא נמצאו תיקיות';
    setView('empty'); return;
  }

  setView('series');
  const grid = document.getElementById('seriesGrid');
  grid.innerHTML = '';

  filtered.forEach(({ folder, rabbi }) => {
    const total   = countFilesInFolder(folder);
    const doneNum = countWatchedInFolder(folder);
    const pct     = total ? Math.round((doneNum / total) * 100) : 0;
    const initial = folder.name.charAt(0) || '?';

    const card = document.createElement('div');
    card.className = 'grid-card';
    card.innerHTML = `
      <div class="grid-card-cover grid-card-cover--series">
        <div class="grid-card-avatar">${initial}</div>
      </div>
      <div class="grid-card-body">
        <div class="series-search-rabbi">${rabbi.name}</div>
        <div class="grid-card-name">${folder.name}</div>
        <div class="grid-card-meta">
          <strong>${total}</strong> שיעורים
          ${doneNum ? `· <span style="color:var(--green)">✅ ${doneNum}</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => {
      // נווט ישירות לתיקייה עם ה-navStack הנכון
      navStack = [rabbi];
      openFolder(folder);
    });
    grid.appendChild(card);
  });
}

// ─── Favorites ────────────────────────────────────────────────────────────────
function renderFavorites() {
  const results = [];
  allData.forEach(rabbi => collectAllFilesFlat(rabbi, rabbi, results));
  const filtered = results.filter(({ f }) => liked.has(f.id));

  if (filtered.length === 0) {
    document.getElementById('emptyMsg').textContent = 'אין שיעורים מועדפים עדיין — לחץ ❤️ על שיעור כדי להוסיף';
    setView('empty'); return;
  }

  setView('favorites');
  renderFileList(filtered, renderFavorites);
}

// ─── Downloads history ────────────────────────────────────────────────────────
function renderDownloaded() {
  const results = [];
  allData.forEach(rabbi => collectAllFilesFlat(rabbi, rabbi, results));
  const filtered = results.filter(({ f }) => downloaded.has(f.id));

  if (filtered.length === 0) {
    document.getElementById('emptyMsg').textContent = 'לא הורדת שיעורים עדיין';
    setView('empty'); return;
  }

  setView('downloads');
  renderFileList(filtered, renderDownloaded);
}

// פונקציית עזר לרינדור רשימת קבצים (מועדפים / הורדות)
function renderFileList(items, rerender) {
  const list = document.getElementById('shiurimList');
  list.innerHTML = '';
  const tmpl = document.getElementById('cardTemplate');

  items.forEach(({ f, rabbi, folder }) => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = rabbi.name + (folder.name !== rabbi.name ? ' › ' + folder.name : '');
    clone.querySelector('.card-title').textContent = cleanName(f.name);
    if (watched.has(f.id)) clone.querySelector('.watched-dot').style.display = 'block';

    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f, items.map(r => r.f)));

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
      saveMarks(); rerender();
    });

    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      saveMarks(); rerender();
    });

    list.appendChild(clone);
  });
}

document.getElementById('favoritesBtn').addEventListener('click', () => {
  navStack = []; searchQuery = '';
  document.getElementById('searchInput').value = '';
  renderFavorites();
});
document.getElementById('downloadsBtn').addEventListener('click', () => {
  navStack = []; searchQuery = '';
  document.getElementById('searchInput').value = '';
  renderDownloaded();
});

// ─── Search ───────────────────────────────────────────────────────────────────
function runSearch() {
  if (!searchQuery.trim()) {
    if (navStack.length > 0) renderFolderContents();
    else                     renderRabbis();
    return;
  }
  if (searchScope === 'rabbis') {
    navStack = [];
    renderRabbis();
  } else if (searchScope === 'series') {
    renderFolderSearch();
  } else {
    renderGlobalSearch();
  }
}

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value;
  runSearch();
});
document.getElementById('searchScope').addEventListener('change', e => {
  searchScope = e.target.value;
  const ph = { all: 'חיפוש שיעור...', rabbis: 'חיפוש רב...', series: 'חיפוש תיקייה...' };
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
    showToast('⚠️ קישור לא תקין — חייב להתחיל ב-script.google.com');
    return;
  }
  if (url) { localStorage.setItem('script_url', url); SCRIPT_URL = url; }
  settingsModal.style.display = 'none';
  showToast('✅ ההגדרות נשמרו');
});

// ─── Admin: share all files ───────────────────────────────────────────────────
document.getElementById('shareFilesBtn').addEventListener('click', async () => {
  const btn    = document.getElementById('shareFilesBtn');
  const status = document.getElementById('syncStatus');
  btn.disabled    = true;
  btn.textContent = '⏳ משתף קבצים...';
  status.textContent = '';
  status.style.color = '';
  try {
    const res = await fetch(SCRIPT_URL + '?action=share');
    if (!res.ok) throw new Error('שגיאת שרת ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    status.textContent = '✅ ' + (data.msg || 'שיתוף הושלם — הקבצים נגישים לציבור');
    status.style.color = 'var(--green)';
  } catch(e) {
    status.textContent = '❌ ' + e.message;
    status.style.color = 'var(--red)';
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔓 שתף קבצים לציבור';
  }
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
        ${data.p1      ? `<p>${esc(data.p1)}</p>` : ''}
        ${data.p2      ? `<p>${esc(data.p2)}</p>` : ''}
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

// ─── PWA Install ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installBtn').style.display = 'inline-flex';
});
window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn').style.display = 'none';
  deferredInstallPrompt = null;
  showToast('✅ האפליקציה הותקנה בהצלחה!');
});
document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') document.getElementById('installBtn').style.display = 'none';
  deferredInstallPrompt = null;
});

// ─── Analytics Panel ─────────────────────────────────────────────────────────
function parseUA(ua) {
  let device = '💻 מחשב';
  if (/iPhone|Android.*Mobile/.test(ua))       device = '📱 פלאפון';
  else if (/iPad|Android|Tablet/.test(ua))      device = '📱 טאבלט';

  let browser = 'אחר';
  if      (/Edg\//.test(ua))   browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua))browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return { device, browser };
}

async function loadAnalytics() {
  document.getElementById('analyticsStats').innerHTML = '<span style="color:var(--muted);font-size:.9rem">טוען...</span>';
  document.getElementById('analyticsTable').innerHTML = '';
  document.getElementById('analyticsNote').style.display = 'none';

  try {
    const res = await fetch(`${SCRIPT_URL}?action=getVisits`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('bad');
    renderAnalytics(raw);
  } catch(_) {
    document.getElementById('analyticsStats').innerHTML = '';
    document.getElementById('analyticsTable').innerHTML = '<p style="text-align:center;color:var(--muted);padding:1.5rem 0">אין נתונים עדיין</p>';
    const note = document.getElementById('analyticsNote');
    note.innerHTML = '⚠️ כדי לראות כניסות מכל המכשירים, יש להוסיף קוד ל-Apps Script. <a href="#" id="showAppsScriptCode">הצג הוראות ←</a>';
    note.style.display = 'block';
    document.getElementById('showAppsScriptCode').addEventListener('click', e => {
      e.preventDefault();
      note.innerHTML = `<b>הוסף לפונקציית <code>doGet(e)</code> ב-Apps Script:</b><br><pre style="font-size:.75rem;text-align:left;background:#f0f2f5;padding:.75rem;border-radius:6px;overflow:auto">if (e.parameter.action === 'logVisit') {
  var s = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('Visits') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Visits');
  s.appendRow([e.parameter.ts, e.parameter.ua, e.parameter.lang]);
  return ContentService.createTextOutput('ok');
}
if (e.parameter.action === 'getVisits') {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Visits');
  if (!s) return ContentService.createTextOutput('[]').setMimeType(ContentService.MimeType.JSON);
  var rows = s.getDataRange().getValues().reverse().slice(0,1000)
    .map(r => ({ts:r[0], ua:r[1], lang:r[2]}));
  return ContentService.createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}</pre>לאחר מכן: <b>פרוס מחדש</b> את ה-Apps Script (Deploy → Manage deployments → ✏️ Edit → גרסה חדשה → Deploy).`;
    });
  }
}

function renderAnalytics(visits) {
  const now   = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = today.getTime() - 6 * 24 * 60 * 60 * 1000;

  // visits = [{ts, ua, lang}] — ts may be ISO string
  const parsed = visits.map(v => ({
    ...v,
    ms: typeof v.ts === 'number' ? v.ts : new Date(v.ts).getTime()
  }));

  const todayN = parsed.filter(v => v.ms >= today.getTime()).length;
  const weekN  = parsed.filter(v => v.ms >= weekAgo).length;

  document.getElementById('analyticsStats').innerHTML = `
    <div class="an-stat"><div class="an-num">${parsed.length}</div><div class="an-lbl">סה"כ כניסות</div></div>
    <div class="an-stat"><div class="an-num">${todayN}</div><div class="an-lbl">היום</div></div>
    <div class="an-stat"><div class="an-num">${weekN}</div><div class="an-lbl">השבוע</div></div>`;

  if (!parsed.length) {
    document.getElementById('analyticsTable').innerHTML = '<p style="text-align:center;color:var(--muted);padding:1.5rem 0">אין נתונים עדיין</p>';
    return;
  }

  const rows = parsed.slice(0, 300).map(v => {
    const dateStr = isNaN(v.ms) ? v.ts : new Date(v.ms).toLocaleString('he-IL', {
      day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
    });
    const { device, browser } = parseUA(v.ua || '');
    const lang = (v.lang || '').split('-')[0].toUpperCase() || '—';
    return `<tr><td>${dateStr}</td><td>${device}</td><td>${browser}</td><td>${lang}</td></tr>`;
  }).join('');

  document.getElementById('analyticsTable').innerHTML = `
    <table class="an-table">
      <thead><tr><th>תאריך ושעה</th><th>מכשיר</th><th>דפדפן</th><th>שפה</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

document.getElementById('analyticsBtn').addEventListener('click', () => {
  checkAdmin(() => {
    document.getElementById('analyticsPanel').style.display = 'flex';
    loadAnalytics();
  });
});
document.getElementById('analyticsPanelClose').addEventListener('click', () => {
  document.getElementById('analyticsPanel').style.display = 'none';
});
document.getElementById('analyticsRefresh').addEventListener('click', loadAnalytics);
document.getElementById('analyticsExport').addEventListener('click', async () => {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getVisits`);
    const visits = await res.json();
    const csv = ['תאריך,מכשיר,דפדפן,שפה', ...visits.map(v => {
      const d = new Date(v.ts).toLocaleString('he-IL');
      const { device, browser } = parseUA(v.ua || '');
      const lang = (v.lang || '').split('-')[0].toUpperCase();
      return `"${d}","${device}","${browser}","${lang}"`;
    })].join('\n');
    await navigator.clipboard.writeText(csv);
    showToast('📋 הועתק — הדבק ב-Excel / גיליון Google');
  } catch(_) { showToast('❌ שגיאה בייצוא'); }
});

// ─── Android back button ──────────────────────────────────────────────────────
history.replaceState({ depth: 0 }, '');

window.addEventListener('popstate', () => {
  const playerPage = document.getElementById('playerPage');
  const aboutPage  = document.getElementById('aboutPage');

  if (playerPage && playerPage.style.display !== 'none') {
    const audio = document.getElementById('ppAudio');
    const frame = document.getElementById('ppFrame');
    if (audio) { audio.pause(); audio.src = ''; }
    if (frame) { frame.src = ''; }
    playerPage.style.display = 'none';
    document.body.style.overflow = '';
    playingId = null;
    history.pushState({ depth: navStack.length }, '');
    return;
  }

  const analyticsPage = document.getElementById('analyticsPanel');
  if (analyticsPage && analyticsPage.style.display !== 'none') {
    analyticsPage.style.display = 'none';
    history.pushState({ depth: navStack.length }, '');
    return;
  }

  if (aboutPage && aboutPage.style.display !== 'none') {
    aboutPage.style.display = 'none';
    history.pushState({ depth: 0 }, '');
    return;
  }

  if (navStack.length > 0) {
    navStack.pop();
    if (navStack.length === 0) {
      showRabbis();
    } else {
      renderFolderContents();
      updateBreadcrumb();
    }
    history.pushState({ depth: navStack.length }, '');
    return;
  }

  // בשורש — לחיצה נוספת תצא מהאפליקציה (התנהגות רגילה)
});

// ─── Init ─────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
fetchData();
