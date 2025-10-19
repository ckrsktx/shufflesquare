const PLAYLIST_URL = 'json/playlists.json';
const FALLBACK = 'img/cd.png';
const $ = s => document.querySelector(s);

/* ========== ELEMENTOS ========== */
const a = $('#a'),
      capa = $('#capa'),
      tit = $('#tit'),
      art = $('#art'),
      playBtn = $('#playBtn'),
      prev = $('#prev'),
      next = $('#next'),
      loader = $('#loader'),
      menuBtn = $('#menuBtn'),
      dropMenu = $('#dropMenu'),
      shufBtn = $('#shufBtn'),
      playlistName = $('#playlistName'),
      favBtn = $('#favBtn');

/* ========== TIMER (SEM DUPLICAÇÃO) ========== */
const timerDiv = $('#timer');
function fmt(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
function updateTimer() {
  if (!a.duration) { timerDiv.textContent = '0:00 / 0:00'; return; }
  timerDiv.textContent = `${fmt(a.currentTime)} / ${fmt(a.duration)}`;
}
a.addEventListener('timeupdate', updateTimer);
a.addEventListener('loadedmetadata', updateTimer);

/* ======================================= */
/* ========== ESTADO ========== */
let playlists = {}, originalPool = [], pool = [],
    idx = 0, shuffleOn = false, isLoading = false, currentPl = '',
    coverCache = new Map(), COVER_TIMEOUT = 4000, RESET_AFTER = 5,
    recentPlayed = new Set(), playsSinceReset = 0, lastCountedKey = null,
    playedInCycle = new Set(), startTimeoutId = null, START_TIMEOUT_MS = 4000;

/* ========== FAVORITOS ========== */
const FAV_KEY = 'favShuffleSquare';
let favPool = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
let previousPlaylist = '', previousIdx = 0;

/* ========== FUNÇÃO NOTIFICAÇÃO BLACKOUT FAVORITOS ========== */
function showNoFavOverlay(msg = "Nenhuma faixa favorita.") {
  let overlay = document.getElementById('noFavOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'noFavOverlay';
    overlay.innerHTML = msg;
    document.body.appendChild(overlay);
  } else {
    overlay.innerHTML = msg;
    overlay.classList.remove('hide');
  }
  setTimeout(() => {
    overlay.classList.add('hide');
    setTimeout(() => { if (overlay) overlay.remove(); }, 400);
  }, 1800);
}

/* ========== ATUALIZA VISUAL DO BOTÃO FAVORITOS ========== */
function updateFavBtnStatus() {
  favBtn.classList.toggle('active', currentPl === 'Favoritos');
}

/* ========== INIT ========== */
(async function initPlayer() {
  loader.textContent = 'Carregando playlists...';
  try {
    playlists = await fetchJsonWithTimestamp(PLAYLIST_URL);
    //console.log('[PLAYLISTS]', playlists);
  } catch {
    loader.textContent = 'Erro ao carregar playlists 😕';
    return;
  }
  fillMenu();
  currentPl = Object.keys(playlists)[0] || '';
  playlistName.textContent = currentPl || '–';
  if (!currentPl) {
    loader.textContent = 'Nenhuma playlist encontrada!';
    return;
  }
  await loadPool({ resetIdx: true, stopPlayback: false });
  idx = Math.max(0, Math.floor(Math.random() * (pool.length || 1)));
  loader.style.display = 'none';
  await loadTrack({ autoplay: false });
  preloadNext();
  updateFavBtnStatus();
})();

/* ========== MENU ========== */
function fillMenu() {
  dropMenu.innerHTML = '';
  Object.keys(playlists).forEach(g => {
    const div = document.createElement('div');
    div.className = 'menuItem';
    div.textContent = g;
    div.onclick = async () => {
      dropMenu.style.display = 'none';
      menuBtn.disabled = true;
      try {
        a.pause(); a.currentTime = 0;
        currentPl = g; playlistName.textContent = g;
        recentPlayed.clear(); playsSinceReset = 0; lastCountedKey = null; playedInCycle.clear(); clearStartTimeout();
        await loadPool({ resetIdx: true, stopPlayback: true });
        idx = Math.max(0, Math.floor(Math.random() * (pool.length || 1)));
        await loadTrack({ autoplay: false });
        preloadNext();
        updateFavBtnStatus();
      } catch (e) {
        alert('Erro ao trocar playlist');
      }
      menuBtn.disabled = false;
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

/* ========== SHUFFLE ========== */
shufBtn.onclick = () => {
  shuffleOn = !shuffleOn;
  shufBtn.classList.toggle('active', shuffleOn);
  shufBtn.setAttribute('aria-pressed', String(shuffleOn));
  pool = shuffleOn ? shuffleArray(originalPool) : [...originalPool];
  const curKey = safeKeyForTrack(currentTrack());
  idx = Math.max(0, pool.findIndex(t => safeKeyForTrack(t) === curKey));
  playedInCycle.clear();
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

/* ========== CARREGA POOL ========== */
async function loadPool({ resetIdx = false, stopPlayback = true } = {}) {
  try {
    const url = playlists[currentPl] || playlists[Object.keys(playlists)[0]];
    if (!url) {
      originalPool = [];
      pool = [];
      alert('Playlist sem URL definida!');
      return;
    }
    const data = await fetchJsonWithTimestamp(url);
    if (!Array.isArray(data) || data.length === 0) {
      originalPool = [];
      pool = [];
      alert('Playlist sem músicas!');
      return;
    }
    originalPool = data.map(item => {
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
    pool = shuffleOn ? shuffleArray(originalPool) : [...originalPool];
    if (resetIdx) idx = 0;
    recentPlayed.clear(); playsSinceReset = 0; lastCountedKey = null; playedInCycle.clear(); clearStartTimeout();
    //console.log('[POOL]', currentPl, pool);
  } catch (e) {
    originalPool = [];
    pool = [];
    alert('Erro ao carregar músicas da playlist!');
    console.error(e);
  }
}

/* ========== CAPA DO ÁLBUM ========== */
async function getCoverForTrack(t) {
  const key = safeKeyForTrack(t);
  if (coverCache.has(key)) return coverCache.get(key);
  if (t.cover && typeof t.cover === 'string' && t.cover.trim()) { coverCache.set(key, t.cover); return t.cover; }
  // procura por movie/artista/ano
  const wantMovie = (() => {
    const pl = (currentPl || '').toLowerCase(), typ = (t.type || '').toLowerCase(), titleLower = (t.title || '').toLowerCase();
    return typ.includes('movie') || typ.includes('filme') || pl.includes('filmes') || pl.includes('filme') || /\bfilme\b/.test(titleLower);
  })();
  const artist = (t.artist || '').trim(), title = (t.title || '').trim(), year = (t.year || '').toString().trim();
  const attempts = [];
  if (artist && title && year) attempts.push({ term: `${artist} ${title} ${year}`, entity: wantMovie ? 'movie' : 'song' });
  if (artist && title) attempts.push({ term: `${artist} ${title}`, entity: wantMovie ? 'movie' : 'song' });
  if (title) attempts.push({ term: `${title}`, entity: wantMovie ? 'movie' : 'song' });
  for (const att of attempts) {
    const q = encodeURIComponent(att.term), entity = att.entity === 'movie' ? 'movie' : 'song';
    try {
      const resp = await fetchWithTimeout(`https://itunes.apple.com/search?term=${q}&limit=3&entity=${entity}`, {}, 3000);
      if (!resp.ok) continue;
      const json = await resp.json();
      if (!Array.isArray(json.results) || !json.results.length) continue;
      const normTitle = normalizeText(title), normArtist = normalizeText(artist);
      let best = null, bestScore = -1;
      for (const r of json.results) {
        const candTitle = normalizeText(r.trackName || r.collectionName || ''), candArtist = normalizeText(r.artistName || r.collectionArtistName || '');
        let score = 0;
        if (normTitle && candTitle.includes(normTitle)) score += 5;
        else { const tTokens = normTitle.split(' ').filter(Boolean); score += tTokens.filter(tok => candTitle.includes(tok)).length; }
        if (normArtist && candArtist.includes(normArtist)) score += 3;
        if (year && r.releaseDate) try { if ((new Date(r.releaseDate)).getFullYear().toString() === year) score += 2; } catch {}
        if (normTitle && candTitle === normTitle) score += 4;
        if (normArtist && candArtist === normArtist) score += 2;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (best && bestScore >= 4) {
        const artUrl = (best.artworkUrl100 || best.artworkUrl60 || '').replace('100x100', '300x300');
        if (artUrl) { coverCache.set(key, artUrl); return artUrl; }
      }
    } catch {}
  }
  coverCache.set(key, FALLBACK); return FALLBACK;
}

async function preloadNext() {
  if (!pool.length) return;
  let nextIdx = (idx + 1) % pool.length;
  if (shuffleOn) {
    for (let i = 0; i < 10; i++) {
      const cand = Math.floor(Math.random() * pool.length);
      if (cand !== idx && !playedInCycle.has(safeKeyForTrack(pool[cand]))) { nextIdx = cand; break; }
    }
  }
  const nextT = pool[nextIdx]; if (!nextT) return;
  const key = safeKeyForTrack(nextT); if (coverCache.has(key)) return;
  getCoverForTrack(nextT).catch(() => {});
}

function currentTrack() { return pool && pool[idx]; }

async function loadTrack({ autoplay = false } = {}) {
  if (isLoading) return;
  const t = currentTrack();
  if (!t) {
    tit.textContent = art.textContent = '–';
    a.removeAttribute('src');
    capa.src = FALLBACK;
    capa.style.opacity = '1';
    updatePlayButton();
    updateFavBtnStatus();
    //console.warn('[LOAD TRACK] Sem faixa no pool ou erro.');
    return;
  }
  isLoading = true;
  a.pause();
  a.currentTime = 0;
  capa.style.opacity = '0';
  tit.textContent = t.title || '—';
  art.textContent = t.artist || '—';
  a.src = t.url;
  capa.src = FALLBACK;
  capa.style.opacity = '1';
  isLoading = false;
  getCoverForTrack(t).then(url => { if (url !== FALLBACK) capa.src = url; }).catch(() => {});
  updateMediaSession();
  if (autoplay) {
    a.play().catch(() => {});
    clearStartTimeout();
    startTimeoutId = setTimeout(() => {
      if (a.paused || a.readyState < 3) goToNext(true).catch(() => {});
      clearStartTimeout();
    }, START_TIMEOUT_MS);
  }
  updatePlayButton();
  updateHeartStatus();
  insertHeart();
  updateFavBtnStatus();
}

/* ========== PLAY BUTTON ========== */
function updatePlayButton() {
  const playing = a && !a.paused && !a.ended;
  playBtn.innerHTML = playing
    ? '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  playBtn.setAttribute('aria-pressed', String(playing));
  document.title = `${tit.textContent} – ${art.textContent}`;
}
function togglePlay() { if (a.paused) a.play().catch(() => {}); else a.pause(); updatePlayButton(); }
playBtn.onclick = togglePlay;
a.addEventListener('play', updatePlayButton);
a.addEventListener('pause', () => { updatePlayButton(); clearStartTimeout(); });
a.addEventListener('waiting', updatePlayButton);
a.addEventListener('playing', () => {
  clearStartTimeout();
  const t = currentTrack(); const key = safeKeyForTrack(t); if (!key) return;
  if (lastCountedKey !== key) {
    recentPlayed.add(key); playsSinceReset++; lastCountedKey = key;
    if (playsSinceReset >= RESET_AFTER) { recentPlayed.clear(); playsSinceReset = 0; lastCountedKey = null; }
  }
  playedInCycle.add(key);
  if (playedInCycle.size >= pool.length) playedInCycle.clear();
  updatePlayButton();
  updateFavBtnStatus();
});

/* ========== AVANÇAR / VOLTAR ========== */
let lastSkip = 0;
async function goToNext(autoplay = true) {
  const now = Date.now(); if (now - lastSkip < 200) return; lastSkip = now; clearStartTimeout();
  if (shuffleOn) {
    let unplayed = pool.map((_, i) => i).filter(i => i !== idx && !playedInCycle.has(safeKeyForTrack(pool[i])));
    if (!unplayed.length) { playedInCycle.clear(); unplayed = pool.map((_, i) => i !== idx); }
    idx = unplayed.length ? unplayed[Math.floor(Math.random() * unplayed.length)] : (idx + 1) % pool.length;
  } else {
    idx = (idx + 1) % pool.length;
  }
  await loadTrack({ autoplay });
}
async function goToPrev(autoplay = true) {
  const now = Date.now(); if (now - lastSkip < 200) return; lastSkip = now; clearStartTimeout();
  if (shuffleOn) {
    let candidate = idx, attempts = 0;
    do { candidate = Math.floor(Math.random() * pool.length); attempts++; } while (candidate === idx && attempts < 40);
    idx = candidate;
  } else {
    idx = (idx - 1 + pool.length) % pool.length;
  }
  await loadTrack({ autoplay });
}
next.onclick = () => goToNext(true);
prev.onclick = () => goToPrev(true);
a.addEventListener('ended', () => { preloadNext(); goToNext(true); });

/* ========== MEDIA SESSION ========== */
function updateMediaSession() {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: tit.textContent || '',
        artist: art.textContent || '',
        artwork: [{ src: capa.src || FALLBACK, sizes: '300x300', type: 'image/png' }]
      });
      ['play', 'pause', 'previoustrack', 'nexttrack'].forEach(action =>
        navigator.mediaSession.setActionHandler(action, () =>
          (action === 'play' ? a.play() : action === 'pause' ? a.pause() : action === 'previoustrack' ? prev.click() : next.click())
        )
      );
    } catch (e) { /* ignore */ }
  }
}

/* ========== OBS ========== */
const obs = new MutationObserver(() => { document.title = `${tit.textContent} – ${art.textContent}`; });
obs.observe(tit,   { childList: true, characterData: true, subtree: true });
obs.observe(art,   { childList: true, characterData: true, subtree: true });

/* ========== TECLADO ========== */
document.addEventListener('keydown', e => {
  if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') next.click();
  else if (e.code === 'ArrowLeft')  prev.click();
});

/* ========== FAVORITOS + CORAÇÕES PEQUENOS ========== */
function createHeart() {
  const h = document.createElement('button');
  h.className = 'heart';
  h.innerHTML = '♥';
  h.title = 'Favoritar';
  h.onclick = () => toggleFavorite(currentTrack(), h);
  return h;
}
function toggleFavorite(t, el) {
  const key = safeKeyForTrack(t);
  const idxFav = favPool.findIndex(f => safeKeyForTrack(f) === key);
  if (idxFav === -1) { favPool.push(t); el.classList.add('active'); }
  else { favPool.splice(idxFav, 1); el.classList.remove('active'); }
  localStorage.setItem(FAV_KEY, JSON.stringify(favPool));
  updateHeartStatus();
}
function updateHeartStatus() {
  const h = document.querySelector('.heart');
  if (!h) return;
  const key = safeKeyForTrack(currentTrack());
  h.classList.toggle('active', favPool.some(f => safeKeyForTrack(f) === key));
}
function insertHeart() {
  if (document.querySelector('.heart')) return;
  const heart = createHeart();
  document.querySelector('#info').appendChild(heart);
}
const heartObs = new MutationObserver(updateHeartStatus);
heartObs.observe(tit, { childList: true, characterData: true, subtree: true });
heartObs.observe(art, { childList: true, characterData: true, subtree: true });

favBtn.onclick = () => {
  if (currentPl === 'Favoritos') {
    exitFavorites();
  } else {
    enterFavorites();
  }
  updateFavBtnStatus();
};
function enterFavorites() {
  if (favPool.length === 0) {
    showNoFavOverlay("Nenhuma faixa favorita.");
    return;
  }
  previousPlaylist = currentPl; previousIdx = idx;
  currentPl = 'Favoritos';
  playlistName.textContent = 'Favoritos';
  originalPool = [...favPool];
  pool = shuffleOn ? shuffleArray(originalPool) : [...originalPool];
  idx = Math.max(0, Math.floor(Math.random() * (pool.length || 1)));
  loadTrack({autoplay:false});
  updateFavBtnStatus();
}
function exitFavorites() {
  currentPl = previousPlaylist || Object.keys(playlists)[0] || '';
  playlistName.textContent = currentPl;
  loadPool({resetIdx: false, stopPlayback: true}).then(()=>{
    idx = previousIdx || 0;
    loadTrack({autoplay:false});
    updateFavBtnStatus();
  });
}

/* ========== UTILS ========= */
function safeKeyForTrack(t) {
  if (!t) return 'unknown';
  if (t.artist && t.title) return `${(t.artist+'').trim().toLowerCase()}|${(t.title+'').trim().toLowerCase()}`;
  return t.url || (typeof t === 'string' ? t : JSON.stringify(t));
}
async function fetchJsonWithTimestamp(url) {
  try {
    const res = await fetch(url + '?t=' + Date.now(), {cache:'no-store'});
    if (!res.ok) throw new Error('fetch error ' + res.status);
    return res.json();
  } catch (e) {
    console.error('Erro ao carregar JSON:', url, e);
    throw e;
  }
}
function normalizeText(s) {
  if (!s) return '';
  return (''+s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
}
function fetchWithTimeout(url, opts = {}, timeout = 4000) {
  const controller = new AbortController(), id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...opts, signal: controller.signal}).finally(() => clearTimeout(id));
}

/* ========== OUTRAS FUNÇÕES OPCIONAIS (desempenho, toast, etc) ========== */
function clearStartTimeout() {
  if (startTimeoutId) { clearTimeout(startTimeoutId); startTimeoutId = null; }
}
