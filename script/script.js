const PLAYLIST_URL = 'json/playlists.json';
const FALLBACK = 'img/cd.png';
const $ = s => document.querySelector(s);

const a = $('#a'), capa = $('#capa'), tit = $('#tit'), art = $('#art'),
      playBtn = $('#playBtn'), prev = $('#prev'), next = $('#next'),
      loader = $('#loader'), menuBtn = $('#menuBtn'), dropMenu = $('#dropMenu'),
      shufBtn = $('#shufBtn'), playlistName = $('#playlistName');

let playlists = {}, pool = [], idx = 0, shuffleOn = false;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch error ' + res.status);
  return res.json();
}

(async () => {
  try {
    playlists = await fetchJson(PLAYLIST_URL);
    fillMenu();
    
    const firstPlaylist = Object.keys(playlists)[0];
    if (!firstPlaylist) {
      loader.textContent = 'nenhuma playlist encontrada';
      return;
    }
    
    currentPl = firstPlaylist;
    playlistName.textContent = firstPlaylist;
    await loadPool();
    idx = Math.floor(Math.random() * pool.length);
    loader.style.display = 'none';
    await loadTrack({ autoplay: false });
    
  } catch (err) {
    loader.textContent = 'erro ao carregar playlists';
  }
})();

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
  const vis = dropMenu.style.display === 'flex';
  dropMenu.style.display = vis ? 'none' : 'flex';
};

document.addEventListener('click', e => {
  if (!e.target.closest('#menuBtn') && !e.target.closest('#dropMenu')) {
    dropMenu.style.display = 'none';
  }
});

shufBtn.onclick = () => {
  shuffleOn = !shuffleOn;
  shufBtn.classList.toggle('active', shuffleOn);
  if (shuffleOn) shufflePool();
};

function shufflePool() {
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
}

async function loadPool() {
  try {
    const url = playlists[currentPl];
    if (!url) {
      pool = [];
      return;
    }
    
    const data = await fetchJson(url);
    pool = data.map(item => {
      if (typeof item === 'string') {
        return { title: item, artist: 'unknown', url: item };
      }
      return {
        title: item.title || item.name || '',
        artist: item.artist || '',
        url: item.url || item.src || '',
        cover: item.cover || ''
      };
    }).filter(it => it.url);
    
    if (shuffleOn) shufflePool();
    
  } catch (err) {
    console.error('loadPool error', err);
    pool = [];
  }
}

async function loadTrack({ autoplay = false } = {}) {
  const t = pool[idx];
  if (!t) {
    tit.textContent = art.textContent = '–';
    a.removeAttribute('src');
    capa.src = FALLBACK;
    updatePlayButton();
    return;
  }
  
  a.pause();
  tit.textContent = t.title || '—';
  art.textContent = t.artist || '—';
  a.src = t.url;
  capa.src = t.cover || FALLBACK;
  
  if (autoplay) {
    a.play().catch(() => {});
  }
  updatePlayButton();
}

function updatePlayButton() {
  const playing = !a.paused && !a.ended;
  playBtn.innerHTML = playing ? 
    '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' : 
    '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
}

function togglePlay() {
  if (a.paused) {
    a.play().catch(() => {});
  } else {
    a.pause();
  }
}

playBtn.onclick = togglePlay;
a.addEventListener('play', updatePlayButton);
a.addEventListener('pause', updatePlayButton);

function goToNext(autoplay = true) {
  if (!pool.length) return;
  idx = (idx + 1) % pool.length;
  loadTrack({ autoplay });
}

function goToPrev(autoplay = true) {
  if (!pool.length) return;
  idx = (idx - 1 + pool.length) % pool.length;
  loadTrack({ autoplay });
}

next.onclick = () => goToNext(true);
prev.onclick = () => goToPrev(true);
a.addEventListener('ended', () => goToNext(true));

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