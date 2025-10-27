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
let playlists = {}, pool = [], idx = 0, shuffleOn = false, currentPl = '';

/* ========== INIT ========== */
(async () => {
  try { 
    const response = await fetch(PLAYLIST_URL);
    playlists = await response.json();
  } catch (err) {
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
  
  await loadPool();
  if (pool.length > 0) {
    idx = Math.floor(Math.random() * pool.length);
    await loadTrack({ autoplay: false });
  }
  loader.style.display = 'none';
})();

/* ========== MENU ========== */
function fillMenu() {
  dropMenu.innerHTML = '';
  Object.keys(playlists).forEach(g => {
    const div = document.createElement('div'); 
    div.className = 'menuItem'; 
    div.textContent = g;
    div.onclick = async () => {
      a.pause(); 
      currentPl = g; 
      playlistName.textContent = g;
      await loadPool();
      if (pool.length > 0) {
        idx = Math.floor(Math.random() * pool.length);
        await loadTrack({ autoplay: false });
      }
      dropMenu.style.display = 'none';
    }; 
    dropMenu.appendChild(div);
  });
}

menuBtn.onclick = () => {
  dropMenu.style.display = dropMenu.style.display === 'flex' ? 'none' : 'flex';
};

document.addEventListener('click', (e) => {
  if (!menuBtn.contains(e.target) && !dropMenu.contains(e.target)) {
    dropMenu.style.display = 'none';
  }
});

/* ========== SHUFFLE ========== */
shufBtn.onclick = () => {
  shuffleOn = !shuffleOn; 
  shufBtn.classList.toggle('active', shuffleOn);
};

function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

/* ========== POOL ========== */
async function loadPool() {
  try {
    const url = playlists[currentPl];
    if (!url) { 
      pool = []; 
      return; 
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    pool = data.map(item => {
      // Se for string simples, converte para objeto
      if (typeof item === 'string') {
        return {
          title: item,
          artist: 'Artista Desconhecido',
          url: item,
          cover: FALLBACK
        };
      }
      
      return {
        title: item.title || item.name || 'Sem título',
        artist: item.artist || 'Artista Desconhecido',
        url: item.url || item.src || '',
        cover: item.cover || FALLBACK
      };
    }).filter(it => it.url && it.url.trim() !== '');
    
    console.log('Pool carregado:', pool.length, 'tracks');
    
  } catch (err) { 
    console.error('loadPool error', err); 
    pool = []; 
  }
}

/* ========== TRACK MANAGEMENT ========== */
function currentTrack() { 
  return pool[idx]; 
}

async function loadTrack({ autoplay = false } = {}) {
  const t = currentTrack();
  if (!t) { 
    tit.textContent = '–'; 
    art.textContent = '–'; 
    capa.src = FALLBACK;
    capa.style.opacity = '1';
    updatePlayButton();
    return; 
  }
  
  console.log('Carregando track:', t.title, 'URL:', t.url);
  
  // Atualiza UI primeiro
  tit.textContent = t.title || '—'; 
  art.textContent = t.artist || '—'; 
  capa.src = t.cover || FALLBACK;
  
  // Configura o audio
  a.src = t.url;
  a.load(); // Importante: força o carregamento
  
  updatePlayButton();
  
  if (autoplay) {
    try {
      await a.play();
    } catch (err) {
      console.log('Autoplay bloqueado:', err);
    }
  }
  
  capa.style.opacity = '1';
}

/* ========== PLAYBACK CONTROLS ========== */
function updatePlayButton() {
  const playing = !a.paused && !a.ended;
  playBtn.innerHTML = playing ? 
    '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' : 
    '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
}

function togglePlay() { 
  if (a.paused) {
    a.play().catch(err => console.log('Play error:', err));
  } else {
    a.pause();
  }
}

playBtn.onclick = togglePlay;
a.addEventListener('play', updatePlayButton);
a.addEventListener('pause', updatePlayButton);
a.addEventListener('ended', () => {
  console.log('Track ended, going to next');
  goToNext();
});

/* ========== NAVIGATION ========== */
function goToNext() {
  if (pool.length === 0) return;
  
  if (shuffleOn) {
    idx = Math.floor(Math.random() * pool.length);
  } else {
    idx = (idx + 1) % pool.length;
  }
  
  loadTrack({ autoplay: true });
}

function goToPrev() {
  if (pool.length === 0) return;
  
  if (shuffleOn) {
    idx = Math.floor(Math.random() * pool.length);
  } else {
    idx = (idx - 1 + pool.length) % pool.length;
  }
  
  loadTrack({ autoplay: true });
}

next.onclick = goToNext;
prev.onclick = goToPrev;

/* ========== KEYBOARD ========== */
document.addEventListener('keydown', e => {
  if (e.code === 'Space') { 
    e.preventDefault(); 
    togglePlay(); 
  } else if (e.code === 'ArrowRight') { 
    next.click(); 
  } else if (e.code === 'ArrowLeft') { 
    prev.click(); 
  }
});

// Debug helper
window.debugPlayer = () => {
  return {
    currentTrack: currentTrack(),
    pool: pool,
    idx: idx,
    shuffleOn: shuffleOn,
    audio: {
      src: a.src,
      paused: a.paused,
      readyState: a.readyState
    }
  };
};