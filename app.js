// ─── Config (stored in localStorage) ────────────────────────────────────────
function getConfig() {
  return {
    folderUrl: localStorage.getItem('drive_folder_url') || '',
    apiKey:    localStorage.getItem('drive_api_key')    || '',
  };
}

function extractFolderId(url) {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// ─── User marks ──────────────────────────────────────────────────────────────
let liked   = new Set(JSON.parse(localStorage.getItem('liked')   || '[]'));
let watched = new Set(JSON.parse(localStorage.getItem('watched') || '[]'));

function saveMarks() {
  localStorage.setItem('liked',   JSON.stringify([...liked]));
  localStorage.setItem('watched', JSON.stringify([...watched]));
}

// ─── All files fetched from Drive ────────────────────────────────────────────
let allFiles = [];

// ─── UI state ────────────────────────────────────────────────────────────────
let activeFilter = 'all';
let searchQuery  = '';
let sortBy       = 'name';
let playingId    = null;

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── Show / hide sections ────────────────────────────────────────────────────
function showSection(name) {
  ['loadingState','setupState','errorState','shiurimList','emptyState']
    .forEach(id => {
      const el = document.getElementById(id);
      el.style.display = (id === name) ? (id === 'shiurimList' ? 'flex' : 'block') : 'none';
    });
  if (name === 'shiurimList') document.getElementById('shiurimList').style.display = 'flex';
}

// ─── Fetch from Google Drive API ─────────────────────────────────────────────
async function fetchDriveFiles() {
  const { folderUrl, apiKey } = getConfig();
  if (!folderUrl || !apiKey) { showSection('setupState'); return; }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) {
    showError('קישור התיקייה לא תקין. ודא שהוא נראה כך: drive.google.com/drive/folders/...');
    return;
  }

  showSection('loadingState');

  const query  = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent('files(id,name,createdTime,mimeType,size)');
  const url    = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=name&pageSize=1000&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `שגיאה ${res.status}`;
      showError(msg);
      return;
    }
    const data = await res.json();
    allFiles = (data.files || []).filter(f =>
      f.mimeType.startsWith('audio/') ||
      f.mimeType.startsWith('video/') ||
      f.name.match(/\.(mp3|mp4|wav|ogg|m4a|flac|aac)$/i)
    );
    render();
  } catch (e) {
    showError('לא ניתן להתחבר ל-Google Drive. בדוק חיבור אינטרנט והגדרות.');
  }
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  showSection('errorState');
}

// ─── Filter & sort ───────────────────────────────────────────────────────────
function getFiltered() {
  let list = allFiles.filter(f => {
    const q = searchQuery.trim().toLowerCase();
    if (q && !cleanName(f.name).toLowerCase().includes(q)) return false;
    if (activeFilter === 'liked'    && !liked.has(f.id))   return false;
    if (activeFilter === 'watched'  && !watched.has(f.id)) return false;
    if (activeFilter === 'unwatched' && watched.has(f.id)) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === 'name')      return a.name.localeCompare(b.name, 'he');
    if (sortBy === 'date_desc') return new Date(b.createdTime) - new Date(a.createdTime);
    if (sortBy === 'date_asc')  return new Date(a.createdTime) - new Date(b.createdTime);
    return 0;
  });

  return list;
}

function cleanName(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function driveDownloadUrl(id) {
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const filtered = getFiltered();

  document.getElementById('statsTotal').textContent   = `${filtered.length} שיעורים`;
  document.getElementById('statsLiked').textContent   = `${liked.size} ❤️`;
  document.getElementById('statsWatched').textContent = `${watched.size} ✅`;

  const list = document.getElementById('shiurimList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    showSection(allFiles.length === 0 ? 'setupState' : 'emptyState');
    return;
  }

  showSection('shiurimList');
  const tmpl = document.getElementById('cardTemplate');

  filtered.forEach(f => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    card.dataset.id = f.id;
    if (liked.has(f.id))     card.classList.add('is-liked');
    if (watched.has(f.id))   card.classList.add('is-watched');
    if (playingId === f.id)  card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = formatDate(f.createdTime);
    clone.querySelector('.card-title').textContent = cleanName(f.name);

    if (watched.has(f.id))
      clone.querySelector('.watched-dot').style.display = 'block';

    // Play
    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) { btnPlay.textContent = '⏸ מושמע'; btnPlay.classList.add('playing'); }
    btnPlay.addEventListener('click', () => playFile(f));

    // Download
    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = driveDownloadUrl(f.id);
    btnDl.addEventListener('click', () => {
      watched.add(f.id);
      saveMarks();
      showToast('⬇️ מתחיל הורדה — סומן כנצפה');
      setTimeout(render, 150);
    });

    // Like
    const btnLike = clone.querySelector('.btn-like');
    btnLike.textContent = liked.has(f.id) ? '❤️' : '🤍';
    if (liked.has(f.id)) btnLike.classList.add('active');
    btnLike.addEventListener('click', () => {
      liked.has(f.id) ? liked.delete(f.id) : liked.add(f.id);
      showToast(liked.has(f.id) ? '❤️ נוסף למועדפים' : '💔 הוסר מהמועדפים');
      saveMarks(); render();
    });

    // Watched
    const btnW = clone.querySelector('.btn-watched');
    btnW.textContent = watched.has(f.id) ? '✅' : '☐';
    if (watched.has(f.id)) btnW.classList.add('active');
    btnW.addEventListener('click', () => {
      watched.has(f.id) ? watched.delete(f.id) : watched.add(f.id);
      showToast(watched.has(f.id) ? '✅ סומן כנצפה' : '🔵 סומן כלא נצפה');
      saveMarks(); render();
    });

    list.appendChild(clone);
  });
}

// ─── Audio player ─────────────────────────────────────────────────────────────
function playFile(f) {
  const player = document.getElementById('audioPlayer');
  const bar    = document.getElementById('playerBar');
  const title  = document.getElementById('playerTitle');

  if (playingId === f.id) {
    player.paused ? player.play() : player.pause();
    return;
  }

  playingId = f.id;
  player.src = driveDownloadUrl(f.id);
  title.textContent = cleanName(f.name);
  bar.style.display = 'flex';
  player.play().catch(() => {});
  render();
}

document.getElementById('playerClose').addEventListener('click', () => {
  const player = document.getElementById('audioPlayer');
  player.pause();
  player.src = '';
  document.getElementById('playerBar').style.display = 'none';
  playingId = null;
  render();
});

// ─── Settings modal ───────────────────────────────────────────────────────────
function openModal() {
  const { folderUrl, apiKey } = getConfig();
  document.getElementById('folderUrl').value = folderUrl;
  document.getElementById('apiKey').value    = apiKey;
  document.getElementById('settingsModal').classList.add('open');
}

function closeModal() {
  document.getElementById('settingsModal').classList.remove('open');
}

document.getElementById('btnSettings').addEventListener('click', openModal);
document.getElementById('btnSetupOpen').addEventListener('click', openModal);
document.getElementById('btnErrorSettings').addEventListener('click', openModal);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target === document.getElementById('settingsModal')) closeModal();
});

document.getElementById('saveSettings').addEventListener('click', () => {
  const folderUrl = document.getElementById('folderUrl').value.trim();
  const apiKey    = document.getElementById('apiKey').value.trim();
  if (!folderUrl || !apiKey) { showToast('⚠️ יש למלא את שני השדות'); return; }
  if (!extractFolderId(folderUrl)) { showToast('⚠️ קישור תיקייה לא תקין'); return; }
  localStorage.setItem('drive_folder_url', folderUrl);
  localStorage.setItem('drive_api_key',    apiKey);
  closeModal();
  fetchDriveFiles();
});

// ─── Filters & search ─────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value; render();
});
document.querySelector('.search-btn').addEventListener('click', () => render());

document.getElementById('sortBy').addEventListener('change', e => {
  sortBy = e.target.value; render();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  searchQuery = ''; activeFilter = 'all'; sortBy = 'name';
  document.getElementById('searchInput').value = '';
  document.getElementById('sortBy').value = 'name';
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.qf-btn[data-filter="all"]').classList.add('active');
  render();
});

document.getElementById('reloadBtn').addEventListener('click', fetchDriveFiles);

document.querySelectorAll('.qf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
const { folderUrl, apiKey } = getConfig();
if (folderUrl && apiKey) {
  fetchDriveFiles();
} else {
  showSection('setupState');
}
