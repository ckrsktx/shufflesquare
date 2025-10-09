/* ========== CONFIG ========== */
const PLAYLIST_URL = 'json/playlists.json';
const FALLBACK = 'https://i.ibb.co/n8LFzxmb/reprodutor-de-musica-2.png';
const $ = s => document.querySelector(s);

/* ========== DOM ========== */
const a = $('#a');
const capa = $('#capa');
const tit = $('#tit');
const art = $('#art');
const playBtn = $('#playBtn');
const prev = $('#prev');
const next = $('#next');
const loader = $('#loader');
const menuBtn = $('#menuBtn');
const dropMenu = $('#dropMenu');
const shufBtn = $('#shufBtn');
const playlistName = $('#playlistName');

/* ========== STATE ========== */
let playlists = {};
let originalPool = [];
let pool = [];
let idx = 0;
let shuffleOn = false;
let isLoading = false;
let currentPl = '';

const coverCache = new Map();
const COVER_TIMEOUT = 8000;
const RESET_AFTER = 5;
const recentPlayed = new Set();
let playsSinceReset = 0;
let lastCountedKey = null;
const playedInCycle = new Set();

let startTimeoutId = null;
const START_TIMEOUT_MS = 7000;

/* ========== UTILS ========== */
function safeKeyForTrack(t) {
  if (!t) return 'unknown';
  if (t.artist && t.title) return `${(t.artist + '').trim().toLowerCase()}|${(t.title + '').trim().toLowerCase()}`;
  if (t.url) return t.url;
  if (typeof t === 'string') return t;
  return JSON.stringify(t);
}

async function fetchJsonWithTimestamp(url) {
  const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('fetch error ' + res.status);
  return await res.json();
}

function normalizeText(s) {
  if (!s) return '';
  return ('' + s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function fetchWithTimeout(url, opts = {}, timeout = COVER_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function clearStartTimeout() {
  if (startTimeoutId) {
    clearTimeout(startTimeoutId);
    startTimeoutId = null;
  }
}

/* ========== INIT ========== */
(async () => {
  try {
    playlists = await fetchJsonWithTimestamp(PLAYLIST_URL);
  } catch (err) {
    console.error('Erro ao buscar playlists index', err);
    loader.textContent = 'erro ao carregar playlists';
    return;
  }
  fillMenu();
  currentPl = Object.keys(playlists)[0] || '';
  playlistName.textContent = currentPl || '–';
  if (!currentPl) {
    loader.textContent = 'nenhuma playlist encontrada';
    return;
  }
  await loadPool({ resetIdx: true, stopPlayback: false });

  /* SORTEAR PRIMEIRA FAIXA (F5 ou primeira entrada) */
  idx = Math.floor(Math.random() * pool.length);

  loader.style.display = 'none';
  await loadTrack({ autoplay: false });
  preloadNext();
})();

/* ========== MENU ========== */
function fillMenu() {
  dropMenu.innerHTML = '';
  Object.keys(playlists).forEach(g => {
    const div = document.createElement('div');
    div.className = 'menuItem';
    div.textContent = g;
    div.onclick = async () => {
      try {
        a.pause();
        a.currentTime = 0;
        currentPl = g;
        playlistName.textContent = g;

        recentPlayed.clear();
        playsSinceReset = 0;
        lastCountedKey = null;
        playedInCycle.clear();
        clearStartTimeout();

        await loadPool({ resetIdx: true, stopPlayback: true });

        /* SORTEAR PRIMEIRA FAIXA AO TROCAR PLAYLIST */
        idx = Math.floor(Math.random() * pool.length);

        await loadTrack({ autoplay: false });
        preloadNext();
        dropMenu.style.display = 'none';
      } catch (e) {
        console.error('erro mudando playlist', e);
      }
    };
    dropMenu.appendChild(div);
  });
}

menuBtn.onclick = () => {
  const vis = dropMenu.style.display === 'flex';
  dropMenu.style.display = vis ? 'none' : 'flex';
  dropMenu.setAttribute('aria-hidden', String(!vis));
};

document.addEventListener('click', e => {
  if (!e.target.closest('#menuBtn') && !e.target.closest('#dropMenu')) dropMenu.style.display = 'none';
});

/* ========== SHUFFLE (sem reiniciar lista nem trocar música atual) ========== */
shufBtn.onclick = () => {
  shuffleOn = !shuffleOn;
  shufBtn.classList.toggle('active', shuffleOn);
  shufBtn.setAttribute('aria-pressed', String(shuffleOn));
  /* apenas redefine o pool das próximas faixas */
  if (shuffleOn) {
    pool = shuffleArray(originalPool);
  } else {
    pool = [...originalPool];
  }
  /* mantém a música atual no mesmo índice */
  const curKey = safeKeyForTrack(currentTrack());
  const found = pool.findIndex(t => safeKeyForTrack(t) === curKey);
  idx = found >= 0 ? found : 0;
  playedInCycle.clear();          // novo ciclo
  preloadNext();
};

function shuffleArray(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ========== POOL ========== */
async function loadPool({ resetIdx = false, stopPlayback = true } = {}) {
  try {
    const url = playlists[currentPl] || playlists[Object.keys(playlists)[0]];
    if (!url) { originalPool = []; pool = []; return; }
    originalPool = await fetchJsonWithTimestamp(url);
    originalPool = originalPool.map(item => {
      if (typeof item === 'string') return { title: item, artist: 'unknown', url: item };
      return {
        title: item.title || item.name || item.track || '',
        artist: item.artist || item.artista || item.albumArtist || item.author || '',
        url: item.url || item.src || item.stream || item.file || '',
        year: item.year || item.releaseYear || item.ano || '',
        type: item.type || item.category || '',
        cover: item.cover || item.artwork || item.image || ''
      };
    }).filter(it => it.url);
    if (stopPlayback) { a.pause(); a.currentTime = 0; }
    /* define pool conforme estado do shuffle, sem recriar índice */
    pool = shuffleOn ? shuffleArray(originalPool) : [...originalPool];
    if (resetIdx) idx = 0;
    recentPlayed.clear();
    playsSinceReset = 0;
    lastCountedKey = null;
    playedInCycle.clear();
    clearStartTimeout();
  } catch (err) {
    console.error('loadPool error', err);
    originalPool = []; pool = [];
  }
}

/* ========== COVER (sem flick) ========== */
async function getCoverForTrack(t) {
  const key = safeKeyForTrack(t);
  if (coverCache.has(key)) return coverCache.get(key);
  if (t.cover && typeof t.cover === 'string' && t.cover.trim()) {
    coverCache.set(key, t.cover);
    return t.cover;
  }

  function isProbablyMovie(trackObj) {
    const pl = (currentPl || '').toLowerCase();
    const typ = (trackObj.type || '').toLowerCase();
    const titleLower = (trackObj.title || '').toLowerCase();
    if (typ.includes('movie') || typ.includes('filme') || pl.includes('filmes') || pl.includes('filme')) return true;
    if (/\bfilme\b/.test(titleLower)) return true;
    return false;
  }

  const wantMovie = isProbablyMovie(t);
  const artist = (t.artist || '').trim();
  const title = (t.title || '').trim();
  const year = (t.year || '').toString().trim();
  const attempts = [];

  if (artist && title && year) attempts.push({ term: `${artist} ${title} ${year}`, entity: wantMovie ? 'movie' : 'song' });
  if (artist && title) attempts.push({ term: `${artist} ${title}`, entity: wantMovie ? 'movie' : 'song' });
  if (title && artist) attempts.push({ term: `${title} ${artist}`, entity: wantMovie ? 'movie' : 'song' });
  if (title && year) attempts.push({ term: `${title} ${year}`, entity: wantMovie ? 'movie' : 'movie' });
  if (title) attempts.push({ term: `${title}`, entity: wantMovie ? 'movie' : 'song' });
  if (!artist && title && t.url) {
    const filename = t.url.split('/').pop().split('.')[0].replace(/[-_]/g, ' ');
    attempts.push({ term: `${title} ${filename}`, entity: wantMovie ? 'movie' : 'song' });
  }

  for (const att of attempts) {
    const q = encodeURIComponent(att.term);
    const entity = att.entity === 'movie' ? 'movie' : 'song';
    const url = `https://itunes.apple.com/search?term=${q}&limit=5&entity=${entity}`;
    try {
      const resp = await fetchWithTimeout(url, {}, 5000);
      if (!resp || !resp.ok) continue;
      const json = await resp.json();
      if (!Array.isArray(json.results) || json.results.length === 0) continue;

      const normTitle = normalizeText(title);
      const normArtist = normalizeText(artist);
      let best = null;
      let bestScore = -1;

      for (const r of json.results) {
        const candTitle = normalizeText(r.trackName || r.collectionName || '');
        const candArtist = normalizeText(r.artistName || r.collectionArtistName || '');
        let score = 0;
        if (normTitle && candTitle.includes(normTitle)) score += 5;
        else {
          const tTokens = normTitle.split(' ').filter(Boolean);
          const matchedTokens = tTokens.filter(tok => candTitle.includes(tok)).length;
          score += matchedTokens;
        }
        if (normArtist && candArtist.includes(normArtist)) score += 3;
        if (year && r.releaseDate) {
          try {
            const rYear = (new Date(r.releaseDate)).getFullYear().toString();
            if (rYear === year) score += 2;
          } catch (e) {}
        }
        if (normTitle && candTitle === normTitle) score += 4;
        if (normArtist && candArtist === normArtist) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }

      if (best && bestScore >= 4) {
        const artUrl = (best.artworkUrl100 || best.artworkUrl60 || '').replace('100x100', '600x600');
        if (artUrl) {
          coverCache.set(key, artUrl);
          return artUrl;
        }
      }
    } catch (e) {}
  }

  coverCache.set(key, FALLBACK);
  return FALLBACK;
}

/* ========== PRELOAD NEXT ========== */
async function preloadNext() {
  if (!pool.length) return;
  let nextIdx = (idx + 1) % pool.length;
  if (shuffleOn) {
    for (let i = 0; i < 20; i++) {
      const cand = Math.floor(Math.random() * pool.length);
      if (cand !== idx && !playedInCycle.has(safeKeyForTrack(pool[cand]))) {
        nextIdx = cand;
        break;
      }
    }
  }
  const nextT = pool[nextIdx];
  if (!nextT) return;
  const key = safeKeyForTrack(nextT);
  if (coverCache.has(key)) return;
  getCoverForTrack(nextT).catch(() => {});
}

/* ========== CURRENT TRACK HELPERS ========== */
function currentTrack() {
  return pool && pool[idx];
}

/* ========== LOAD & PLAY (capa só aparece depois de pronta) ========== */
async function loadTrack({ autoplay = false } = {}) {
  if (isLoading) return;
  const t = currentTrack();
  if (!t) {
    tit.textContent = '–';
    art.textContent = '–';
    a.removeAttribute('src');
    capa.src = FALLBACK;
    capa.style.opacity = '1';
    updatePlayButton();
    return;
  }

  isLoading = true;
  a.pause();
  a.currentTime = 0;
  capa.style.opacity = '0';

  tit.textContent = t.title || '—';
  art.textContent = t.artist || '—';
  a.src = t.url;

  /* capa só entra depois de decidir */
  let cover = FALLBACK;
  try { cover = await getCoverForTrack(t); } catch (e) {}
  capa.src = cover;
  capa.onload = () => { capa.style.opacity = '1'; isLoading = false; };
  capa.onerror = () => { capa.style.opacity = '1'; isLoading = false; };

  updateMediaSession();
  preloadNext();

  if (autoplay) {
    a.play().catch(err => console.warn('play fail', err));
    /* timeout só após play() */
    startTimeoutId = setTimeout(() => {
      if (a.paused || a.readyState < 3) goToNext(true).catch(() => {});
      clearStartTimeout();
    }, START_TIMEOUT_MS);
  }
  updatePlayButton();
}

/* ========== PLAY BUTTON UI ========== */
function updatePlayButton() {
  if (a && !a.paused && !a.ended) {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    playBtn.setAttribute('aria-pressed', 'true');
  } else {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    playBtn.setAttribute('aria-pressed', 'false');
  }
  document.title = `${tit.textContent} – ${art.textContent}`;
}

function togglePlay() {
  if (a.paused) {
    a.play().catch(err => { console.warn('play failed', err); updatePlayButton(); });
  } else {
    a.pause();
  }
  updatePlayButton();
}

playBtn.onclick = togglePlay;

a.addEventListener('play', updatePlayButton);
a.addEventListener('pause', () => { updatePlayButton(); clearStartTimeout(); });
a.addEventListener('waiting', updatePlayButton);

a.addEventListener('playing', () => {
  clearStartTimeout();
  const t = currentTrack();
  const key = safeKeyForTrack(t);
  if (!key) return;
  if (lastCountedKey !== key) {
    recentPlayed.add(key);
    playsSinceReset++;
    lastCountedKey = key;
    if (playsSinceReset >= RESET_AFTER) {
      recentPlayed.clear();
      playsSinceReset = 0;
      lastCountedKey = null;
    }
  }
  playedInCycle.add(key);
  if (playedInCycle.size >= pool.length) playedInCycle.clear();
  updatePlayButton();
});

/* ========== NEXT / PREV ========== */
async function goToNext(autoplay = true) {
  if (!pool.length) return;
  clearStartTimeout();
  if (shuffleOn) {
    let unplayed = pool.map((_, i) => i).filter(i => i !== idx && !playedInCycle.has(safeKeyForTrack(pool[i])));
    if (unplayed.length === 0) {
      playedInCycle.clear();
      unplayed = pool.map((_, i) => i).filter(i => i !== idx);
    }
    if (unplayed.length === 0) {
      idx = (idx + 1) % pool.length;
    } else {
      idx = unplayed[Math.floor(Math.random() * unplayed.length)];
    }
  } else {
    idx = (idx + 1) % pool.length;
  }
  await loadTrack({ autoplay });
}

async function goToPrev(autoplay = true) {
  if (!pool.length) return;
  clearStartTimeout();
  if (shuffleOn) {
    let candidate = idx;
    let attempts = 0;
    const MAX = 40;
    do {
      candidate = Math.floor(Math.random() * pool.length);
      attempts++;
    } while (candidate === idx && attempts < MAX);
    idx = candidate;
  } else {
    idx = (idx - 1 + pool.length) % pool.length;
  }
  await loadTrack({ autoplay });
}

next.onclick = () => goToNext(true);
prev.onclick = () => goToPrev(true);
a.addEventListener('ended', () => goToNext(true));

/* ========== MEDIA SESSION ========== */
function updateMediaSession() {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: tit.textContent || '',
        artist: art.textContent || '',
        artwork: [{ src: capa.src || FALLBACK, sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', () => a.play());
      navigator.mediaSession.setActionHandler('pause', () => a.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev.click());
      navigator.mediaSession.setActionHandler('nexttrack', () => next.click());
    } catch (e) { console.warn('mediaSession fail', e); }
  }
}

/* ========== OBSERVE CHANGES ========== */
const obs = new MutationObserver(() => {
  document.title = `${tit.textContent} – ${art.textContent}`;
});
obs.observe(tit, { childList: true, characterData: true, subtree: true });
obs.observe(art, { childList: true, characterData: true, subtree: true });

/* ========== WAKE LOCK ========== */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
a.addEventListener('play', requestWakeLock);
a.addEventListener('pause', () => {
  if (wakeLock && wakeLock.release) wakeLock.release().catch(() => {});
  wakeLock = null;
});

/* ========== KEYBOARD ========== */
document.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') { next.click(); }
  if (e.code === 'ArrowLeft') { prev.click(); }
});

/* ========== PUBLIC ========== */
window.changePlaylist = async function (name) {
  if (!playlists[name]) throw new Error('playlist não encontrada: ' + name);
  a.pause();
  a.currentTime = 0;
  recentPlayed.clear();
  playsSinceReset = 0;
  lastCountedKey = null;
  playedInCycle.clear();
  clearStartTimeout();
  currentPl = name;
  playlistName.textContent = name;
  await loadPool({ resetIdx: true, stopPlayback: true });
  idx = Math.floor(Math.random() * pool.length);
  await loadTrack({ autoplay: false });
};

/* ========== DEBUG ========== */
window._playerState = () => ({
  idx,
  shuffleOn,
  currentPl,
  poolLength: pool.length,
  playsSinceReset,
  recentPlayedSize: recentPlayed.size,
  playedInCycleSize: playedInCycle.size,
  startTimeout: !!startTimeoutId
});


/* ===== CPU WAKE LOCK + HEARTBEAT (evita quit com tela apagada) ===== */
let cpuLock = null;
async function lockCPU() {
  try {
    if ('wakeLock' in navigator && 'cpu' in WakeLockType) {
      cpuLock = await navigator.wakeLock.request('cpu');
      cpuLock.addEventListener('release', () => cpuLock = null);
    }
  } catch (e) {}
}
a.addEventListener('play', lockCPU);
a.addEventListener('pause', () => {
  if (cpuLock) cpuLock.release().catch(() => {});
  cpuLock = null;
});

/* heartbeat – mantém aba viva */
setInterval(() => {
  if (!a.paused && a.src) fetch(PLAYLIST_URL, { mode: 'no-cors' });
}, 25_000);

/* ===== REDUZ FONT QUANDO TÍTULO > 30 CHAR ===== */
function ajustaFonteTitulo() {
  const tit = $('#tit');
  const base = 1.05;                 // rem original
  const min = 0.80;                  // rem mínimo
  const limite = 30;                 // chars
  const chars = tit.textContent.length;

  if (chars > limite) {
    const novo = Math.max(min, base - (chars - limite) * 0.015);
    tit.style.fontSize = novo + 'rem';
  } else {
    tit.style.fontSize = base + 'rem';   // volta ao padrão
  }
}

/* executa sempre que o título mudar */
const titObs = new MutationObserver(ajustaFonteTitulo);
titObs.observe($('#tit'), { childList: true, characterData: true, subtree: true });

/* primeira vez */
ajustaFonteTitulo();


/* ===== TEXTO SIMPLES “Escolha a playlist ;)” ===== */
(() => {
  const menu = $('#menuBtn');
  if (!menu) return;

  const texto = document.createElement('div');
  texto.innerHTML = 'Escolha a playlist ;)';
  Object.assign(texto.style, {
    position: 'fixed',
    top: '4.2rem',
    right: '1.2rem',
    color: 'var(--fg)',
    fontSize: '.85rem',
    opacity: '0',
    transition: 'opacity .35s ease',
    zIndex: '35',
    pointerEvents: 'none'
  });
  document.body.appendChild(texto);

  requestAnimationFrame(() => texto.style.opacity = '1');

  const esconde = () => {
    texto.style.opacity = '0';
    menu.removeEventListener('click', esconde);
    setTimeout(() => texto.remove(), 400);
  };
  menu.addEventListener('click', esconde);
})();


 
