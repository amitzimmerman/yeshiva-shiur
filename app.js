// ─── Config ──────────────────────────────────────────────────────────────────
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwoUpXTtNcrCj14mc_JvaQMcCJp6DgVSsARfLkxKvxG17iB3HlnZ8Oh1JgY8ZYj1pFn/exec';

// ─── User marks ──────────────────────────────────────────────────────────────
let liked   = new Set(JSON.parse(localStorage.getItem('liked')   || '[]'));
let watched = new Set(JSON.parse(localStorage.getItem('watched') || '[]'));

function saveMarks() {
  localStorage.setItem('liked',   JSON.stringify([...liked]));
  localStorage.setItem('watched', JSON.stringify([...watched]));
}

// ─── State ───────────────────────────────────────────────────────────────────
let allFiles     = [];
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

// ─── Section visibility ──────────────────────────────────────────────────────
function showSection(name) {
  ['loadingState', 'errorState', 'emptyState'].forEach(id => {
    document.getElementById(id).style.display = (id === name) ? 'block' : 'none';
  });
  document.getElementById('shiurimList').style.display =
    (name === 'shiurimList') ? 'flex' : 'none';
}

// ─── Fetch from Apps Script ───────────────────────────────────────────────────
async function fetchFiles() {
  showSection('loadingState');
  try {
    const res = await fetch(SCRIPT_URL);
    if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('תגובה לא תקינה');
    allFiles = data;
    render();
  } catch (e) {
    document.getElementById('errorMsg').textContent =
      e.message.includes('Failed to fetch')
        ? 'לא ניתן להתחבר. בדוק חיבור אינטרנט ונסה שוב.'
        : e.message;
    showSection('errorState');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cleanName(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

function dlUrl(id) {
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

function getFiltered() {
  let list = allFiles.filter(f => {
    const q = searchQuery.trim().toLowerCase();
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

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const filtered = getFiltered();

  document.getElementById('statsTotal').textContent   = `${filtered.length} שיעורים`;
  document.getElementById('statsLiked').textContent   = `${liked.size} ❤️`;
  document.getElementById('statsWatched').textContent = `${watched.size} ✅`;

  const list = document.getElementById('shiurimList');
  list.innerHTML = '';

  if (filtered.length === 0) { showSection('emptyState'); return; }
  showSection('shiurimList');

  const tmpl = document.getElementById('cardTemplate');

  filtered.forEach(f => {
    const clone = tmpl.content.cloneNode(true);
    const card  = clone.querySelector('.shiur-card');

    card.dataset.id = f.id;
    if (liked.has(f.id))    card.classList.add('is-liked');
    if (watched.has(f.id))  card.classList.add('is-watched');
    if (playingId === f.id) card.classList.add('is-playing');

    clone.querySelector('.card-date').textContent  = f.date || '';
    clone.querySelector('.card-title').textContent = cleanName(f.name);

    if (watched.has(f.id))
      clone.querySelector('.watched-dot').style.display = 'block';

    // Play
    const btnPlay = clone.querySelector('.btn-play');
    if (playingId === f.id) {
      btnPlay.textContent = '⏸ מושמע';
      btnPlay.classList.add('playing');
    }
    btnPlay.addEventListener('click', () => playFile(f));

    // Download
    const btnDl = clone.querySelector('.btn-dl');
    btnDl.href = dlUrl(f.id);
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

  if (playingId === f.id) {
    player.paused ? player.play() : player.pause();
    return;
  }

  playingId = f.id;
  player.src = dlUrl(f.id);
  document.getElementById('playerTitle').textContent = cleanName(f.name);
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

// ─── Filters ─────────────────────────────────────────────────────────────────
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

document.getElementById('reloadBtn').addEventListener('click', fetchFiles);
document.getElementById('reloadOnError').addEventListener('click', fetchFiles);

document.querySelectorAll('.qf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
fetchFiles();
