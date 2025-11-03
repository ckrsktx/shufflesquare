/* ========== CONFIG ========== */
const PLAYLIST_URL = 'json/playlists.json';
const FALLBACK = 'img/cd.png';
const $ = s => document.querySelector(s);

/* ========== DOM ========== */
const a = $('#a'), capa = $('#capa'), tit = $('#tit'), art = $('#art'),
      playBtn = $('#playBtn'), prev = $('#prev'), next = $('#next'),
      loader = $('#loader'), menuBtn = $('#menuBtn'), dropMenu = $('#dropMenu'),
      shufBtn = $('#shufBtn'), playlistName = $('#playlistName');

/* ========== STATE ========== */
let playlists = {}, originalPool = [], pool = [], idx = 0, shuffleOn = false,
    isLoading = false, currentPl = '', coverCache = new Map(), COVER_TIMEOUT = 4000,
    RESET_AFTER = 5, recentPlayed = new Set(), playsSinceReset = 0,
    lastCountedKey = null, playedInCycle = new Set(),
    startTimeoutId = null, START_TIMEOUT_MS = 4000;

/* ========== UTILS ========== */
function safeKeyForTrack(t) {
  if (!t) return 'unknown';
  if (t.artist && t.title) return `${(t.artist+'').trim().toLowerCase()}|${(t.title+'').trim().toLowerCase()}`;
  return t.url || (typeof t === 'string' ? t : JSON.stringify(t));
}
async function fetchJsonWithTimestamp(url) {
  const res = await fetch(url + '?t=' + Date.now(), {cache: 'no-store'});
  if (!res.ok) throw new Error('fetch error ' + res.status);
  return res.json();
}
function normalizeText(s) {
  if (!s) return '';
  return (''+s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}
function fetchWithTimeout(url, opts = {}, timeout = COVER_TIMEOUT) {
  const controller = new AbortController(), id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...opts, signal: controller.signal}).finally(() => clearTimeout(id));
}
function clearStartTimeout() {
  if (startTimeoutId) { clearTimeout(startTimeoutId); startTimeoutId = null; }
}

/* ========== INIT ========== */
(async () => {
  try { playlists = await fetchJsonWithTimestamp(PLAYLIST_URL); } catch (err) {
    loader.textContent = 'erro ao carregar playlists'; return;
  }
  fillMenu();
  currentPl = Object.keys(playlists)[0] || '';
  playlistName.textContent = currentPl || '–';
  if (!currentPl) { loader.textContent = 'nenhuma playlist encontrada'; return; }
  await loadPool({ resetIdx: true, stopPlayback: false });
  idx = Math.floor(Math.random() * pool.length);
  loader.style.display = 'none';
  await loadTrack({ autoplay: false });
  preloadNext();
  
  // Inicializar Media Session
  setupMediaSessionHandlers();
})();

/* ========== MENU ========== */
function fillMenu() {
  dropMenu.innerHTML = '';
  Object.keys(playlists).forEach(g => {
    const div = document.createElement('div'); div.className = 'menuItem'; div.textContent = g;
    div.onclick = async () => {
      a.pause(); a.currentTime = 0; currentPl = g; playlistName.textContent = g;
      recentPlayed.clear(); playsSinceReset = 0; lastCountedKey = null; playedInCycle.clear(); clearStartTimeout();
      await loadPool({ resetIdx: true, stopPlayback: true });
      idx = Math.floor(Math.random() * pool.length);
      await loadTrack({ autoplay: false }); preloadNext(); dropMenu.style.display = 'none';
    }; dropMenu.appendChild(div);
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
  shuffleOn = !shuffleOn; shufBtn.classList.toggle('active', shuffleOn); shufBtn.setAttribute('aria-pressed', String(shuffleOn));
  pool = shuffleOn ? shuffleArray(originalPool) : [...originalPool];
  const curKey = safeKeyForTrack(currentTrack());
  idx = Math.max(0, pool.findIndex(t => safeKeyForTrack(t) === curKey));
  playedInCycle.clear(); preloadNext();
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
    originalPool = (await fetchJsonWithTimestamp(url)).map(item => {
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
  } catch (err) { console.error('loadPool error', err); originalPool = []; pool = []; }
}

/* ========== COVER UHD ========== */
async function getCoverForTrack(t) {
  const key = safeKeyForTrack(t);
  if (coverCache.has(key)) return coverCache.get(key);
  if (t.cover && typeof t.cover === 'string' && t.cover.trim()) { coverCache.set(key, t.cover); return t.cover; }
  
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
      const resp = await fetchWithTimeout(`https://itunes.apple.com/search?term=${q}&limit=5&entity=${entity}`, {}, 5000);
      if (!resp.ok) continue;
      const json = await resp.json();
      if (!Array.isArray(json.results) || !json.results.length) continue;
      
      const normTitle = normalizeText(title), normArtist = normalizeText(artist);
      let best = null, bestScore = -1;
      
      for (const r of json.results) {
        const candTitle = normalizeText(r.trackName || r.collectionName || ''), 
              candArtist = normalizeText(r.artistName || r.collectionArtistName || '');
        let score = 0;
        
        if (normTitle && candTitle.includes(normTitle)) score += 5;
        else { 
          const tTokens = normTitle.split(' ').filter(Boolean); 
          score += tTokens.filter(tok => candTitle.includes(tok)).length; 
        }
        
        if (normArtist && candArtist.includes(normArtist)) score += 3;
        
        if (year && r.releaseDate) {
          try { 
            if ((new Date(r.releaseDate)).getFullYear().toString() === year) score += 2; 
          } catch {}
        }
        
        if (normTitle && candTitle === normTitle) score += 4;
        if (normArtist && candArtist === normArtist) score += 2;
        
        if (score > bestScore) { bestScore = score; best = r; }
      }
      
      if (best && bestScore >= 4) {
        // BUSCAR CAPA UHD - Tentar diferentes tamanhos
        let artUrl = best.artworkUrl100 || best.artworkUrl60 || '';
        if (artUrl) {
          // Tentar obter a maior resolução possível
          if (artUrl.includes('100x100')) artUrl = artUrl.replace('100x100', '1000x1000');
          else if (artUrl.includes('60x60')) artUrl = artUrl.replace('60x60', '1000x1000');
          
          // Se ainda não for UHD, tentar outros padrões
          if (!artUrl.includes('1000x1000')) {
            artUrl = artUrl.replace(/\d+x\d+bb\.jpg$/, '100000x100000-999.jpg');
          }
          
          coverCache.set(key, artUrl); 
          return artUrl;
        }
      }
    } catch (error) {
      console.log('iTunes search error:', error);
    }
  }
  
  // Fallback para Spotify se iTunes não encontrar
  if (artist && title) {
    try {
      const spotifyQuery = encodeURIComponent(`${artist} ${title}`);
      const spotifyResp = await fetchWithTimeout(
        `https://api.spotify.com/v1/search?q=${spotifyQuery}&type=track&limit=1`,
        {}, 4000
      );
      if (spotifyResp.ok) {
        const spotifyData = await spotifyResp.json();
        if (spotifyData.tracks && spotifyData.tracks.items.length > 0) {
          const track = spotifyData.tracks.items[0];
          if (track.album && track.album.images && track.album.images.length > 0) {
            // Pegar a imagem de maior resolução do Spotify
            const largestImage = track.album.images.reduce((largest, current) => 
              current.width > largest.width ? current : largest
            );
            coverCache.set(key, largestImage.url);
            return largestImage.url;
          }
        }
      }
    } catch (error) {
      // Ignora erro do Spotify
    }
  }
  
  coverCache.set(key, FALLBACK); 
  return FALLBACK;
}

/* ========== PRELOAD NEXT ========== */
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

/* ========== CURRENT TRACK HELPERS ========== */
function currentTrack() { return pool && pool[idx]; }

/* ========== MEDIA SESSION CORRIGIDO ========== */
let currentMediaSessionCover = '';

function updateMediaSession() {
  if ('mediaSession' in navigator) {
    try {
      const coverUrl = capa.src || FALLBACK;
      
      // Só atualiza se a capa mudou
      if (coverUrl !== currentMediaSessionCover) {
        currentMediaSessionCover = coverUrl;
        
        // Criar array de artworks com múltiplos tamanhos
        const artwork = [];
        const sizes = [96, 128, 192, 256, 384, 512, 1024];
        
        sizes.forEach(size => {
          artwork.push({
            src: coverUrl,
            sizes: `${size}x${size}`,
            type: getImageType(coverUrl)
          });
        });

        navigator.mediaSession.metadata = new MediaMetadata({
          title: tit.textContent || 'Título desconhecido',
          artist: art.textContent || 'Artista desconhecido',
          album: currentPl || 'ShuffleSquare',
          artwork: artwork
        });
      }
      
      // Sempre atualiza o estado da posição
      updateMediaPositionState();
      
    } catch (error) {
      console.error('MediaSession error:', error);
    }
  }
}

function getImageType(url) {
  if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  if (url.includes('.webp')) return 'image/webp';
  return 'image/png';
}

function updateMediaPositionState() {
  if ('mediaSession' in navigator && a.duration && isFinite(a.duration)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        playbackRate: a.playbackRate,
        position: a.currentTime
      });
    } catch (error) {
      // Ignora erro de setPositionState (não suportado em alguns dispositivos)
    }
  }
}

function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      a.play().catch(() => {});
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      a.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      goToPrev(true).catch(() => {});
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      goToNext(true).catch(() => {});
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        a.currentTime = details.seekTime;
      }
    });

    // Tentar configurar seekforward/seekbackward se suportado
    try {
      navigator.mediaSession.setActionHandler('seekforward', () => {
        a.currentTime = Math.min(a.currentTime + 10, a.duration);
      });
      
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        a.currentTime = Math.max(a.currentTime - 10, 0);
      });
    } catch (e) {
      // Não suportado
    }

  } catch (error) {
    console.log('MediaSession actions not supported:', error);
  }
}

/* ========== LOAD & PLAY ========== */
async function loadTrack({ autoplay = false } = {}) {
  if (isLoading) return;
  const t = currentTrack();
  if (!t) { 
    tit.textContent = art.textContent = '–'; 
    a.removeAttribute('src'); 
    capa.src = FALLBACK; 
    capa.style.opacity = '1'; 
    updatePlayButton(); 
    updateMediaSession();
    return; 
  }
  
  isLoading = true; 
  a.pause(); 
  a.currentTime = 0; 
  capa.style.opacity = '0';
  tit.textContent = t.title || '—'; 
  art.textContent = t.artist || '—'; 
  a.src = t.url;
  
  // Mostrar fallback imediatamente
  capa.src = FALLBACK;
  capa.style.opacity = '1';
  
  // Atualizar Media Session imediatamente com fallback
  updateMediaSession();
  setupMediaSessionHandlers();
  
  isLoading = false;

  // Buscar capa UHD em background e atualizar quando carregar
  getCoverForTrack(t).then(url => { 
    if (url !== FALLBACK) {
      const img = new Image();
      img.onload = () => {
        capa.src = url;
        // Atualizar Media Session com a capa UHD
        updateMediaSession();
      };
      img.onerror = () => {
        // Manter fallback se der erro
      };
      img.src = url;
    }
  }).catch(() => {});

  // Configurar listeners para atualização de tempo
  a.addEventListener('loadedmetadata', () => {
    updateMediaPositionState();
  }, { once: true });

  updatePlayButton();
  
  if (autoplay) { 
    a.play().catch(() => {}); 
    startTimeoutId = setTimeout(() => { 
      if (a.paused || a.readyState < 3) goToNext(true).catch(() => {}); 
      clearStartTimeout(); 
    }, START_TIMEOUT_MS); 
  }
}

/* ========== PLAY BUTTON UI ========== */
function updatePlayButton() {
  const playing = a && !a.paused && !a.ended;
  playBtn.innerHTML = playing ? '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  playBtn.setAttribute('aria-pressed', String(playing));
  document.title = playing ? `${tit.textContent} – ${art.textContent}` : 'ShuffleSquare';
}
function togglePlay() { 
  if (a.paused) a.play().catch(() => {}); 
  else a.pause(); 
  updatePlayButton(); 
}
playBtn.onclick = togglePlay;
a.addEventListener('play', () => { 
  updatePlayButton(); 
  updateMediaSession();
}); 
a.addEventListener('pause', () => { 
  updatePlayButton(); 
  clearStartTimeout(); 
}); 
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
  if (!pool.length) return; clearStartTimeout();
  if (shuffleOn) { 
    let unplayed = pool.map((_, i) => i).filter(i => i !== idx && !playedInCycle.has(safeKeyForTrack(pool[i]))); 
    if (!unplayed.length) { playedInCycle.clear(); unplayed = pool.map((_, i) => i).filter(i => i !== idx); } 
    idx = unplayed.length ? unplayed[Math.floor(Math.random() * unplayed.length)] : (idx + 1) % pool.length; 
  } else { 
    idx = (idx + 1) % pool.length; 
  }
  await loadTrack({ autoplay });
}
async function goToPrev(autoplay = true) {
  if (!pool.length) return; clearStartTimeout();
  if (shuffleOn) { 
    let candidate = idx, attempts = 0; 
    do { 
      candidate = Math.floor(Math.random() * pool.length); 
      attempts++; 
    } while (candidate === idx && attempts < 40); 
    idx = candidate; 
  } else { 
    idx = (idx - 1 + pool.length) % pool.length; 
  }
  await loadTrack({ autoplay });
}
next.onclick = () => goToNext(true); 
prev.onclick = () => goToPrev(true); 
a.addEventListener('ended', () => { preloadNext(); goToNext(true); });

/* ========== OUVINTES PARA ATUALIZAR TEMPO ========== */
a.addEventListener('timeupdate', updateMediaPositionState);
a.addEventListener('durationchange', updateMediaPositionState);
a.addEventListener('loadedmetadata', updateMediaPositionState);

/* ========== OBSERVE CHANGES ========== */
const obs = new MutationObserver(() => { 
  const playing = a && !a.paused && !a.ended;
  if (playing) {
    document.title = `${tit.textContent} – ${art.textContent}`;
    updateMediaSession();
  }
});
obs.observe(tit, { childList: true, characterData: true, subtree: true }); 
obs.observe(art, { childList: true, characterData: true, subtree: true });

/* ========== WAKE LOCK ========== */
let wakeLock = null;
async function requestWakeLock() { 
  try { 
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); 
  } catch {} 
}
a.addEventListener('play', requestWakeLock);
a.addEventListener('pause', () => { 
  if (wakeLock && wakeLock.release) wakeLock.release().catch(() => {}); 
  wakeLock = null;
});

/* ========== KEYBOARD ========== */
document.addEventListener('keydown', e => { 
  if (e.code === 'Space') { 
    e.preventDefault(); 
    togglePlay(); 
  } else if (e.code === 'ArrowRight') next.click(); 
  else if (e.code === 'ArrowLeft') prev.click(); 
});

/* ========== PUBLIC ========== */
window.changePlaylist = async function (name) {
  if (!playlists[name]) throw new Error('playlist não encontrada: ' + name);
  a.pause(); a.currentTime = 0; recentPlayed.clear(); playsSinceReset = 0; lastCountedKey = null; playedInCycle.clear(); clearStartTimeout();
  currentPl = name; playlistName.textContent = name; await loadPool({ resetIdx: true, stopPlayback: true });
  idx = Math.floor(Math.random() * pool.length); await loadTrack({ autoplay: false });
};

/* ========== DEBUG ========== */
window._playerState = () => ({ idx, shuffleOn, currentPl, poolLength: pool.length, playsSinceReset, recentPlayedSize: recentPlayed.size, playedInCycleSize: playedInCycle.size, startTimeout: !!startTimeoutId });

/* ===== ANSIEDADE ===== */
let skipCount = 0, lastSkipTime = 0; const SKIP_WINDOW = 1500, SKIP_LIMIT = 5;
const toast = document.createElement('div'); toast.innerHTML = 'Ei, calma!<br>Menos ansiedade, curta a playlist. ;)';
Object.assign(toast.style, { position: 'fixed', top: `${capa.getBoundingClientRect().top + capa.offsetHeight/2}px`, left: `${capa.getBoundingClientRect().left + capa.offsetWidth/2}px`, transform: 'translate(-50%,-50%)', background: 'rgba(0,0,0,.55)', color: '#fff', padding: '1.2rem 1.8rem', borderRadius: '1rem', fontSize: '1.05rem', textAlign: 'center', lineHeight: '1.4', zIndex: '999', pointerEvents: 'none', opacity: '0', willChange: 'opacity' }); document.body.appendChild(toast);
function showToast() { toast.style.top = `${capa.getBoundingClientRect().top + capa.offsetHeight/2}px`; toast.style.left = `${capa.getBoundingClientRect().left + capa.offsetWidth/2}px`; toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 3000); }
[next, prev].forEach(btn => btn.addEventListener('click', () => { const now = Date.now(); if (now - lastSkipTime < SKIP_WINDOW) skipCount++; else skipCount = 1; lastSkipTime = now; if (skipCount >= SKIP_LIMIT) { skipCount = 0; showToast(); } }));

/* ===== TEXTO SIMPLES "Escolha a playlist ;)" ===== */
(() => {
  const menu = $('#menuBtn'); if (!menu) return; const texto = document.createElement('div'); texto.innerHTML = 'Escolha a playlist ;)';
  Object.assign(texto.style, { position: 'fixed', top: '4.2rem', right: '1.2rem', color: 'var(--fg)', fontSize: '.85rem', opacity: '0', willChange: 'opacity' }); document.body.appendChild(texto);
  requestAnimationFrame(() => texto.style.opacity = '1');
  const esconde = () => { texto.style.opacity = '0'; menu.removeEventListener('click', esconde); setTimeout(() => texto.remove(), 400); };
  menu.addEventListener('click', esconde);
})();

/* ===== HEARTBEAT LEVE (15 s) ===== */
setInterval(() => { if (!a.paused && a.src) fetch(PLAYLIST_URL, { mode: 'no-cors' }); }, 15_000);