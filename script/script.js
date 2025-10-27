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
    playlists = await fetch(PLAYLIST_URL).then(r => r.json());
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
  idx = Math.floor(Math.random() * pool.length);
  loader.style.display = 'none';
  await loadTrack({ autoplay: false });
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
      idx = Math.floor(Math.random() * pool.length);
      await loadTrack({ autoplay: false });
      dropMenu.style.display = 'none';
    }; 
    dropMenu.appendChild(div);
  });
}

menuBtn.onclick = () => {
  dropMenu.style.display = dropMenu.style.display === 'flex' ? 'none' : 'flex';
};

/* ========== SHUFFLE ========== */
shufBtn.onclick = () => {
  shuffleOn = !shuffleOn; 
  shufBtn.classList.toggle('active', shuffleOn);
  if (shuffleOn) {
    pool = shuffleArray([...pool]);
  }
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
    
    const data = await fetch(url).then(r => r.json());
    pool = data.map(item => ({
      title: item.title || item.name || '',
      artist: item.artist || '',
      url: item.url || item.src || '',
      cover: item.cover || ''
    })).filter(it => it.url);
    
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
    return; 
  }
  
  a.pause();
  tit.textContent = t.title || '—'; 
  art.textContent = t.artist || '—'; 
  a.src = t.url;
  capa.src = t.cover || FALLBACK;
  capa.style.opacity = '1';
  
  if (autoplay) { 
    a.play().catch(() => {}); 
  }
  
  updatePlayButton();
}

/* ========== PLAYBACK CONTROLS ========== */
function updatePlayButton() {
  const playing = !a.paused && !a.ended;
  playBtn.innerHTML = playing ? 
    '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' : 
    '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
}

function togglePlay() { 
  a.paused ? a.play() : a.pause(); 
}

playBtn.onclick = togglePlay;
a.addEventListener('play', updatePlayButton);
a.addEventListener('pause', updatePlayButton);

/* ========== NAVIGATION ========== */
function goToNext() {
  if (!pool.length) return;
  idx = shuffleOn ? Math.floor(Math.random() * pool.length) : (idx + 1) % pool.length;
  loadTrack({ autoplay: true });
}

function goToPrev() {
  if (!pool.length) return;
  idx = shuffleOn ? Math.floor(Math.random() * pool.length) : (idx - 1 + pool.length) % pool.length;
  loadTrack({ autoplay: true });
}

next.onclick = goToNext;
prev.onclick = goToPrev;
a.addEventListener('ended', goToNext);

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