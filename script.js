/* ============================================================
   Oryares LOOP v4.0 — 3D Neural YouTube Looper
   ============================================================ */

// ---- State ----
let apiReady = false;
let apiLoading = false;
let pendingVideoLoad = false;
let player;
let loopInterval;
let isFloating = false;
let floatDrag = null;
let embedHostIndex = 0;
let watchedVideoId = '';
const embedHosts = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
const hostRetryErrorCodes = [101, 150, 153];

function setWatchVideoId(videoId) {
  watchedVideoId = videoId || '';
}

function setOverlayActions(visible) {
  const actions = document.getElementById('overlayActions');
  if (actions) actions.hidden = !visible;
}

function retryWithNextEmbedHost() {
  if (embedHostIndex >= embedHosts.length - 1) return false;
  const videoId = extractVideoId(document.getElementById('videoInput').value);
  if (!videoId) return false;

  embedHostIndex += 1;
  showOverlay(true, 'RETRYING WITH A DIFFERENT PLAYER...');
  resetPlayer();
  createNewPlayer(videoId, timeToSeconds(document.getElementById('startTime').value));
  return true;
}

// ---- YouTube API ----
function onYouTubeIframeAPIReady() {
  if (apiReady) return;
  apiReady = true;
  apiLoading = false;
  showOverlay(true, 'PASTE A LINK TO BEGIN');
  if (pendingVideoLoad) {
    pendingVideoLoad = false;
    loadNewVideo();
  }
}

function loadYouTubeApi() {
  if (apiReady || apiLoading) return;
  if (document.querySelector('script[data-youtube-api]')) return;

  apiLoading = true;
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.async = true;
  script.dataset.youtubeApi = 'true';
  script.onload = () => {
    if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
      onYouTubeIframeAPIReady();
      return;
    }
    apiLoading = false;
    script.remove();
    showOverlay(true, 'YOUTUBE API DID NOT START — REFRESH AND TRY AGAIN');
  };
  script.onerror = () => {
    apiLoading = false;
    script.remove();
    showOverlay(true, 'COULD NOT REACH YOUTUBE — CHECK YOUR CONNECTION');
  };
  document.head.appendChild(script);
}

function extractVideoId(input) {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
      if (url.pathname.replace(/\/+$/, '') === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else {
        const pathMatch = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
        videoId = pathMatch ? pathMatch[1] : '';
      }
    }

    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : '';
  } catch (error) {
    return '';
  }
}

function timeToSeconds(timeStr) {
  timeStr = timeStr.trim();
  if (!timeStr) return 0;
  if (!timeStr.includes(':')) return parseFloat(timeStr) || 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function secondsToTime(totalSeconds) {
  const tenths = Math.max(0, Math.round((Number(totalSeconds) || 0) * 10));
  const hrs = Math.floor(tenths / 36000);
  const mins = Math.floor((tenths % 36000) / 600);
  const wholeSecs = Math.floor((tenths % 600) / 10);
  const fraction = tenths % 10;
  const seconds = `${String(wholeSecs).padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${seconds}`;
  }
  return `${mins}:${seconds}`;
}

function showOverlay(show, message) {
  const overlay = document.getElementById('playerOverlay');
  const text = document.getElementById('playerOverlayText');
  if (overlay) overlay.classList.toggle('active', show);
  if (show && message && text) text.textContent = message;
  if (show) setOverlayActions(false);
}

function scrollToPlayer() {
  const playerWrapper = document.getElementById('player-wrapper');
  if (!playerWrapper) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  playerWrapper.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

function getResponsivePlayerSize() {
  const wrapper = document.getElementById('player-wrapper');
  if (!wrapper) return { w: 640, h: 360 };
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement === wrapper) {
    return { w: wrapper.clientWidth || window.innerWidth, h: wrapper.clientHeight || window.innerHeight };
  }
  const w = wrapper.clientWidth || 640;
  return { w: w, h: Math.round(w * 9 / 16) };
}

function resetPlayer() {
  clearInterval(loopInterval);
  if (player && typeof player.destroy === 'function') {
    try {
      player.destroy();
    } catch {
    }
  }

  const wrapper = document.getElementById('player-wrapper');
  if (!wrapper) return;
  const current = document.getElementById('player');
  if (current && current.tagName === 'IFRAME') {
    const placeholder = document.createElement('div');
    placeholder.id = 'player';
    current.replaceWith(placeholder);
  } else if (!current) {
    const placeholder = document.createElement('div');
    placeholder.id = 'player';
    wrapper.insertBefore(placeholder, wrapper.firstChild);
  }
  player = null;
}

function configurePlayerIframe(iframe) {
  if (!iframe) return;
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.allowFullscreen = true;
}

function createNewPlayer(videoId, startSec) {
  if (!apiReady || typeof YT === 'undefined') return;
  setWatchVideoId(videoId);

  const wrapper = document.getElementById('player-wrapper');
  if (wrapper) {
    const permissionObserver = new MutationObserver(() => {
      const iframe = wrapper.querySelector('iframe');
      if (!iframe) return;
      configurePlayerIframe(iframe);
      permissionObserver.disconnect();
    });
    permissionObserver.observe(wrapper, { childList: true, subtree: true });
  }

  const size = getResponsivePlayerSize();
  const origin = window.location.protocol === 'file:' ? 'http://localhost' : window.location.origin;
  const playerVars = {
    controls: 1,
    playsinline: 1,
    start: Math.floor(startSec),
    rel: 0,
    fs: 1,
    disablekb: 0,
    origin: origin,
  };

  player = new YT.Player('player', {
    height: size.h,
    width: size.w,
    videoId: videoId,
    host: embedHosts[embedHostIndex],
    playerVars: playerVars,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
}

function onPlayerReady(event) {
  showOverlay(false);
  const iframe = event.target.getIframe();
  configurePlayerIframe(iframe);
  if (iframe) iframe.focus();
  event.target.playVideo();
  startLoopTracker();
}

function onPlayerStateChange(event) {
  syncMusic();

  if (event.data === YT.PlayerState.PLAYING) {
    showOverlay(false);
    startLoopTracker();
  } else {
    clearInterval(loopInterval);
  }
}

function onPlayerError(event) {
  clearInterval(loopInterval);
  const code = event && event.data;

  if (hostRetryErrorCodes.includes(code) && retryWithNextEmbedHost()) return;

  const errorMessages = {
    2: 'INVALID VIDEO LINK — CHECK THE VIDEO ID',
    5: 'THIS VIDEO CANNOT BE PLAYED IN A BROWSER',
    100: 'VIDEO NOT FOUND — IT MAY BE PRIVATE OR REMOVED',
    101: 'THE OWNER BLOCKED EMBEDDING — WATCH IT ON YOUTUBE',
    150: 'THE OWNER BLOCKED EMBEDDING — WATCH IT ON YOUTUBE',
    153: 'THE PLAYER LOST ITS CONNECTION — RELOAD THE PAGE AND TRY AGAIN',
  };
  const message = errorMessages[code] || "COULDN'T LOAD THAT LINK — CHECK IT AND TRY AGAIN";
  showOverlay(true, message);
  if ([101, 150, 153, 100, 5].includes(code)) setOverlayActions(true);
}

// ---- Loop Tracker ----
function startLoopTracker() {
  clearInterval(loopInterval);
  loopInterval = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== 'function') return;

    const currentTime = player.getCurrentTime();
    const startTime = timeToSeconds(document.getElementById('startTime').value);
    const endTime = timeToSeconds(document.getElementById('endTime').value);
    const duration = player.getDuration() || 1;

    // Update progress bar
    updateProgress(currentTime, startTime, endTime, duration);

    // Loop logic
    if (endTime > startTime && currentTime >= endTime) {
      player.seekTo(startTime, true);
    }
  }, 100);
}

function updateProgress(currentTime, startTime, endTime, duration) {
  const fill = document.getElementById('progressFill');
  const startMarker = document.getElementById('startMarker');
  const endMarker = document.getElementById('endMarker');
  const currentTimeEl = document.getElementById('currentTimeDisplay');
  const loopDurationEl = document.getElementById('loopDurationDisplay');

  if (!fill || !duration) return;

  // Overall progress
  const pct = Math.min((currentTime / duration) * 100, 100);
  fill.style.width = pct + '%';

  // Markers
  if (startTime > 0) {
    startMarker.style.left = (startTime / duration * 100) + '%';
    startMarker.style.display = 'block';
  } else {
    startMarker.style.display = 'none';
  }

  if (endTime > 0 && endTime < duration) {
    endMarker.style.left = (endTime / duration * 100) + '%';
    endMarker.style.display = 'block';
  } else {
    endMarker.style.display = 'none';
  }

  // Time displays
  if (currentTimeEl) currentTimeEl.textContent = secondsToTime(currentTime);
  if (loopDurationEl && endTime > startTime) {
    loopDurationEl.textContent = 'Loop: ' + secondsToTime(endTime - startTime);
  }
}

// ---- Load Video ----
function loadNewVideo(shouldScroll = false) {
  const rawInput = document.getElementById('videoInput').value.trim();
  const videoId = extractVideoId(rawInput);

  if (!videoId) {
    alert('Please enter a valid YouTube Video ID or URL');
    return;
  }

  if (shouldScroll && !isFloating) scrollToPlayer();

  if (!apiReady || typeof YT === 'undefined' || typeof YT.Player !== 'function') {
    pendingVideoLoad = true;
    showOverlay(true, 'LOADING YOUTUBE API...');
    loadYouTubeApi();
    return;
  }

  const startTime = timeToSeconds(document.getElementById('startTime').value);
  showOverlay(true, 'LOADING...');

  embedHostIndex = 0;
  resetPlayer();
  createNewPlayer(videoId, startTime);
}

// ---- Responsive Player Resize ----
function resizePlayer() {
  if (!player || typeof player.setSize !== 'function') return;
  const size = getResponsivePlayerSize();
  player.setSize(size.w, size.h);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizePlayer, 200);
});

function handleFullscreenChange() {
  resizePlayer();
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    window.requestAnimationFrame(() => {
      resizePlayer();
      if (!isFloating) scrollToPlayer();
    });
  }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

// ---- Event Listeners ----
const watchOnYoutubeBtn = document.getElementById('watchOnYoutubeBtn');
const testEmbedBtn = document.getElementById('testEmbedBtn');

loadYouTubeApi();

document.getElementById('loadBtn').addEventListener('click', () => {
  loadNewVideo(true);
});

if (watchOnYoutubeBtn) {
  watchOnYoutubeBtn.addEventListener('click', () => {
    if (!watchedVideoId) return;
    window.open(`https://www.youtube.com/watch?v=${watchedVideoId}`, '_blank', 'noopener');
  });
}

if (testEmbedBtn) {
  testEmbedBtn.addEventListener('click', () => {
    if (!watchedVideoId) return;
    window.open(`https://www.youtube.com/embed/${watchedVideoId}`, '_blank', 'noopener');
  });
}

loadYouTubeApi();

// Nudge buttons
document.querySelectorAll('.nudge-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    let sec = timeToSeconds(target.value);
    sec += btn.dataset.dir === '+' ? 1 : -1;
    sec = Math.max(0, sec);
    target.value = secondsToTime(sec);
    if (btn.dataset.target === 'startTime' && player && typeof player.seekTo === 'function') {
      player.seekTo(sec, true);
    }
  });
});

// Keyboard controls
function togglePlayback() {
  if (!player || typeof player.getPlayerState !== 'function') return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
}

function seekPlayerBy(seconds) {
  if (!player || typeof player.seekTo !== 'function') return;
  const currentTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
  const duration = typeof player.getDuration === 'function' ? player.getDuration() : 0;
  const nextTime = Math.max(0, duration ? Math.min(duration, currentTime + seconds) : currentTime + seconds);
  player.seekTo(nextTime, true);
}

function seekPlayerToPercent(percent) {
  if (!player || typeof player.seekTo !== 'function' || typeof player.getDuration !== 'function') return;
  const duration = player.getDuration();
  if (duration > 0) player.seekTo(duration * percent / 10, true);
}

function adjustPlayerVolume(amount) {
  if (!player || typeof player.getVolume !== 'function' || typeof player.setVolume !== 'function') return;
  player.setVolume(Math.max(0, Math.min(100, player.getVolume() + amount)));
}

function togglePlayerMute() {
  if (!player) return;
  if (typeof player.isMuted === 'function' && player.isMuted()) player.unMute();
  else player.mute();
}

function toggleFullscreen() {
  const wrapper = document.getElementById('player-wrapper');
  if (!wrapper) return;

  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement) {
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFullscreen) {
      const result = exitFullscreen.call(document);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
    return;
  }

  const requestFullscreen = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
  if (requestFullscreen) {
    const result = requestFullscreen.call(wrapper);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  }
}

window.addEventListener('keydown', (e) => {
  const activeElement = document.activeElement;
  const activeTag = activeElement ? activeElement.tagName : '';
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeTag) || (activeElement && activeElement.isContentEditable) || activeElement === floatHandle || e.ctrlKey || e.metaKey || e.altKey) return;

  const startInput = document.getElementById('startTime');
  const endInput = document.getElementById('endTime');
  let startSec = timeToSeconds(startInput.value);
  let endSec = timeToSeconds(endInput.value);
  const key = e.key;
  const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';

  switch (key) {
    case '[':
      startSec = Math.max(0, startSec - 1);
      startInput.value = secondsToTime(startSec);
      if (player && typeof player.seekTo === 'function') player.seekTo(startSec, true);
      break;
    case ']':
      endSec += 1;
      endInput.value = secondsToTime(endSec);
      break;
    case ' ':
    case 'Spacebar':
      e.preventDefault();
      togglePlayback();
      break;
    case 'ArrowUp':
      e.preventDefault();
      adjustPlayerVolume(5);
      break;
    case 'ArrowDown':
      e.preventDefault();
      adjustPlayerVolume(-5);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      seekPlayerBy(-5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekPlayerBy(5);
      break;
    case 'Home':
      e.preventDefault();
      if (player && typeof player.seekTo === 'function') player.seekTo(0, true);
      break;
    case 'End':
      e.preventDefault();
      if (player && typeof player.getDuration === 'function' && typeof player.seekTo === 'function') {
        player.seekTo(Math.max(0, player.getDuration() - 0.1), true);
      }
      break;
    case '+':
    case '=':
      e.preventDefault();
      adjustPlayerVolume(5);
      break;
    case '-':
    case '_':
      e.preventDefault();
      adjustPlayerVolume(-5);
      break;
    default:
      if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        seekPlayerToPercent(Number(key));
      } else if (lowerKey === 'k') {
        e.preventDefault();
        togglePlayback();
      } else if (lowerKey === 'j') {
        e.preventDefault();
        seekPlayerBy(-10);
      } else if (lowerKey === 'l') {
        e.preventDefault();
        seekPlayerBy(10);
      } else if (lowerKey === 'm') {
        e.preventDefault();
        togglePlayerMute();
      } else if (lowerKey === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (lowerKey === 'b') {
        e.preventDefault();
        musicUnlocked = true;
        toggleMusic();
      }
      break;
  }
});

// Scroll-to-seek on time inputs
document.querySelectorAll('.time-input').forEach(input => {
  input.addEventListener('wheel', (e) => {
    e.preventDefault();
    let currentSec = timeToSeconds(input.value);
    currentSec += e.deltaY < 0 ? 1 : -1;
    currentSec = Math.max(0, currentSec);
    input.value = secondsToTime(currentSec);
  }, { passive: false });

  // Also re-seek when editing start time directly
  input.addEventListener('change', () => {
    if (input.id === 'startTime' && player && typeof player.seekTo === 'function') {
      player.seekTo(timeToSeconds(input.value), true);
    }
  });
});

// ---- Float Mode ----
const container = document.querySelector('.container');
const floatBtn = document.getElementById('floatBtn');
const floatHandle = document.getElementById('floatHandle');

function setFloatingPosition(left, top) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - rect.width);
  const maxTop = Math.max(0, window.innerHeight - rect.height);
  container.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
  container.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
}

function startFloatingDrag(event) {
  if (!isFloating || !container || !floatHandle) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const rect = container.getBoundingClientRect();
  floatDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  if (floatHandle.setPointerCapture) floatHandle.setPointerCapture(event.pointerId);
  floatHandle.classList.add('is-dragging');
  event.preventDefault();
}

function moveFloatingDrag(event) {
  if (!floatDrag || event.pointerId !== floatDrag.pointerId) return;
  setFloatingPosition(event.clientX - floatDrag.offsetX, event.clientY - floatDrag.offsetY);
}

function stopFloatingDrag(event) {
  if (!floatDrag || event.pointerId !== floatDrag.pointerId) return;
  if (floatHandle.hasPointerCapture && floatHandle.hasPointerCapture(event.pointerId)) {
    floatHandle.releasePointerCapture(event.pointerId);
  }
  floatDrag = null;
  floatHandle.classList.remove('is-dragging');
}

function toggleFloatingMode() {
  if (!container) return;
  isFloating = !isFloating;

  if (isFloating) {
    const rect = container.getBoundingClientRect();
    container.classList.add('floating-mode');
    setFloatingPosition(rect.left, rect.top);
  } else {
    container.classList.remove('floating-mode');
    container.style.left = '';
    container.style.top = '';
    container.style.right = '';
    container.style.bottom = '';
  }

  floatBtn.innerHTML = isFloating
    ? '<span class="btn-icon">&#128250;</span> DOCK MODE'
    : '<span class="btn-icon">&#128250;</span> FLOAT MODE';
  resizePlayer();
}

floatBtn.addEventListener('click', toggleFloatingMode);

if (floatHandle) {
  floatHandle.addEventListener('pointerdown', startFloatingDrag);
  floatHandle.addEventListener('pointermove', moveFloatingDrag);
  floatHandle.addEventListener('pointerup', stopFloatingDrag);
  floatHandle.addEventListener('pointercancel', stopFloatingDrag);
  floatHandle.addEventListener('keydown', (event) => {
    if (!isFloating || !container || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 12;
    if (event.key === 'ArrowUp') setFloatingPosition(rect.left, rect.top - step);
    if (event.key === 'ArrowDown') setFloatingPosition(rect.left, rect.top + step);
    if (event.key === 'ArrowLeft') setFloatingPosition(rect.left - step, rect.top);
    if (event.key === 'ArrowRight') setFloatingPosition(rect.left + step, rect.top);
  });
}

window.addEventListener('resize', () => {
  if (!isFloating || !container) return;
  setFloatingPosition(parseFloat(container.style.left) || 0, parseFloat(container.style.top) || 0);
});

// ---- Voice Commands ----
const voiceBtn = document.getElementById('voiceBtn');
const voiceStatus = document.getElementById('voiceStatus');
let recognition;
let voiceListening = false;
let voiceCommandArmed = false;
let voiceRestartTimer;
let voiceCommandTimer;
const voiceWakeWord = 'hey looper';
const voiceWakeLabel = voiceWakeWord.toUpperCase();
const voiceWakeLeadWords = new Set(['hey', 'hi', 'hello', 'okay', 'ok', 'yo']);
const voiceWakeWordAliases = ['looper', 'super', 'louper', 'luper', 'loper', 'loop', 'sleeper', 'souper', 'soup', 'blue', 'lupar', 'slooper'];
const voiceCommandTimeout = 5000;

function normalizeWakeToken(token) {
  return token.toLowerCase().replace(/[^a-z]/g, '');
}

function editDistance(first, second) {
  const row = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    let diagonal = row[0];
    row[0] = firstIndex + 1;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const above = row[secondIndex + 1];
      const cost = first[firstIndex] === second[secondIndex] ? 0 : 1;
      row[secondIndex + 1] = Math.min(row[secondIndex + 1] + 1, row[secondIndex] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[second.length];
}

function isWakeWord(token) {
  const normalizedToken = normalizeWakeToken(token);
  if (!normalizedToken) return false;
  return voiceWakeWordAliases.some(alias => {
    const threshold = alias.length >= 7 ? 2 : 1;
    return editDistance(normalizedToken, alias) <= threshold;
  });
}

function findWakePhraseEnd(speech) {
  const tokens = speech.split(' ');
  if (tokens.length === 1 && isWakeWord(tokens[0])) return tokens[0].length;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const leadWord = normalizeWakeToken(tokens[index]);
    if (voiceWakeLeadWords.has(leadWord) && isWakeWord(tokens[index + 1])) {
      return tokens.slice(0, index + 2).join(' ').length;
    }
  }
  return -1;
}

function setVoiceStatus(message, color) {
  voiceStatus.textContent = message;
  voiceStatus.style.color = color;
}

function executeVoiceCommand(speech) {
  let handled = false;

  if (speech.includes('play')) {
    if (player && typeof player.playVideo === 'function') player.playVideo();
    handled = true;
  } else if (speech.includes('pause') || speech.includes('stop')) {
    if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    handled = true;
  } else if (speech.includes('reset') || speech.includes('restart') || speech.includes('start')) {
    const startTime = timeToSeconds(document.getElementById('startTime').value);
    if (player && typeof player.seekTo === 'function') player.seekTo(startTime, true);
    handled = true;
  } else if (speech.includes('louder') || speech.includes('volume up')) {
    if (player && typeof player.setVolume === 'function') player.setVolume(Math.min(100, player.getVolume() + 10));
    handled = true;
  } else if (speech.includes('quieter') || speech.includes('volume down')) {
    if (player && typeof player.setVolume === 'function') player.setVolume(Math.max(0, player.getVolume() - 10));
    handled = true;
  } else if (speech.includes('unmute')) {
    if (player && typeof player.unMute === 'function') player.unMute();
    handled = true;
  } else if (speech.includes('mute')) {
    if (player && typeof player.mute === 'function') player.mute();
    handled = true;
  } else if (speech.includes('load') || speech.includes('go')) {
    loadNewVideo();
    handled = true;
  } else if (speech.includes('float')) {
    document.getElementById('floatBtn').click();
    handled = true;
  }

  return handled;
}

function setVoicePrompt() {
  if (voiceListening) setVoiceStatus(`Voice: SAY "${voiceWakeLabel}"`, 'var(--neon-purple)');
}

function scheduleVoiceCommandTimeout() {
  clearTimeout(voiceCommandTimer);
  voiceCommandTimer = setTimeout(() => {
    voiceCommandArmed = false;
    setVoicePrompt();
  }, voiceCommandTimeout);
}

function processVoiceSpeech(transcript) {
  const normalizedSpeech = transcript.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalizedSpeech) return;

  setVoiceStatus(`Heard: "${normalizedSpeech}"`, 'var(--neon-cyan)');
  let command = normalizedSpeech;

  if (!voiceCommandArmed) {
    const wakeEnd = findWakePhraseEnd(normalizedSpeech);
    if (wakeEnd === -1) return;
    voiceCommandArmed = true;
    command = normalizedSpeech.slice(wakeEnd).trim();
    if (!command) {
      setVoiceStatus('Voice: ACTIVATED — SPEAK COMMAND', 'var(--neon-purple)');
      scheduleVoiceCommandTimeout();
      return;
    }
  }

  const handled = executeVoiceCommand(command);
  voiceCommandArmed = false;
  clearTimeout(voiceCommandTimer);
  setVoiceStatus(handled ? 'Voice: COMMAND SENT' : 'Voice: COMMAND NOT RECOGNIZED', handled ? 'var(--neon-green)' : 'var(--neon-pink)');
  setTimeout(setVoicePrompt, 1800);
}

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    if (!voiceListening) {
      recognition.stop();
      return;
    }
    voiceBtn.classList.add('listening');
    setVoiceStatus(`Voice: SAY "${voiceWakeLabel}"`, 'var(--neon-purple)');
  };

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal && result[0]) processVoiceSpeech(result[0].transcript);
    }
  };

  recognition.onerror = (event) => {
    voiceBtn.classList.remove('listening');
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      voiceListening = false;
      setVoiceStatus('Voice: MICROPHONE BLOCKED', 'var(--neon-pink)');
      return;
    }
    setVoiceStatus('Voice: RETRYING...', 'var(--neon-pink)');
  };

  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
    if (voiceListening) {
      clearTimeout(voiceRestartTimer);
      voiceRestartTimer = setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          if (error.name !== 'InvalidStateError') setVoiceStatus('Voice: RETRYING...', 'var(--neon-pink)');
        }
      }, 300);
    } else {
      setVoiceStatus('Voice: OFF', 'var(--text-dim)');
    }
  };

  voiceBtn.addEventListener('click', () => {
    voiceListening = !voiceListening;
    voiceCommandArmed = false;
    clearTimeout(voiceCommandTimer);
    clearTimeout(voiceRestartTimer);

    if (!voiceListening) {
      recognition.stop();
      setVoiceStatus('Voice: OFF', 'var(--text-dim)');
      return;
    }

    setVoiceStatus('Voice: STARTING...', 'var(--neon-purple)');
    try {
      recognition.start();
    } catch (error) {
      if (error.name !== 'InvalidStateError') setVoiceStatus('Voice: ERROR', 'var(--neon-pink)');
    }
  });
} else {
  voiceBtn.style.display = 'none';
  voiceStatus.textContent = 'Voice: NOT SUPPORTED';
  voiceStatus.style.color = 'var(--neon-pink)';
}

// ---- Background Music (Interstellar Main Theme) ----
const musicBtn = document.getElementById('musicBtn');
const bgm = document.getElementById('bgm');
const MUSIC_STATE_KEY = 'oryares.bgm.enabled';
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE_IN = 1600;
const MUSIC_FADE_OUT = 350;
const MUSIC_RECONCILE_MS = 1500;
let musicEnabled = true;
let musicUnlocked = false;
let musicFadeFrame = null;
let musicFadeTarget = null;

function videoIsPlaying() {
  return !!player && typeof player.getPlayerState === 'function' && player.getPlayerState() === YT.PlayerState.PLAYING;
}

// Single source of truth: the theme may only sound while it is switched on,
// the tab is visible, the browser has let it start, and the video is not playing.
function musicShouldPlay() {
  return !!bgm && musicEnabled && musicUnlocked && !document.hidden && !videoIsPlaying();
}

function setMusicButtonState() {
  if (!musicBtn) return;
  const playing = musicShouldPlay() && !bgm.paused;
  musicBtn.classList.toggle('playing', playing);
  musicBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  const label = musicBtn.querySelector('.btn-label');
  if (label) label.textContent = musicEnabled ? 'MUSIC: ON' : 'MUSIC: OFF';
}

function fadeMusicTo(target, duration, onDone) {
  if (!bgm) return;
  if (musicFadeFrame) {
    cancelAnimationFrame(musicFadeFrame);
    musicFadeFrame = null;
  }
  musicFadeTarget = target;
  const from = bgm.volume;
  if (duration <= 0 || Math.abs(from - target) < 0.001) {
    bgm.volume = target;
    musicFadeTarget = null;
    if (onDone) onDone();
    return;
  }
  const startedAt = performance.now();
  const step = (now) => {
    // The rAF timestamp is the frame's start time, which can predate the moment
    // the fade was scheduled, so progress has to be clamped before it is used to
    // set volume: a negative value throws and would kill the fade outright.
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    bgm.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
    if (progress < 1) {
      musicFadeFrame = requestAnimationFrame(step);
    } else {
      musicFadeFrame = null;
      musicFadeTarget = null;
      if (onDone) onDone();
    }
  };
  musicFadeFrame = requestAnimationFrame(step);
}

// Every transition funnels through here, so a cancelled fade can never leave
// the track stranded: the video starting stops it, the video stopping brings
// it back, and the button only expresses a preference.
function syncMusic() {
  if (!bgm) return;
  setMusicButtonState();

  if (musicShouldPlay()) {
    if (bgm.paused) {
      const attempt = bgm.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => {
          if (!musicShouldPlay()) {
            bgm.pause();
            setMusicButtonState();
            return;
          }
          fadeMusicTo(MUSIC_VOLUME, MUSIC_FADE_IN, setMusicButtonState);
        }).catch(() => setMusicButtonState());
      }
    } else if (bgm.volume < 0.01 || musicFadeTarget !== MUSIC_VOLUME) {
      // Silent means "not really playing", whatever the fade bookkeeping thinks.
      fadeMusicTo(MUSIC_VOLUME, MUSIC_FADE_IN, setMusicButtonState);
    }
    return;
  }

  if (!bgm.paused) {
    // No point fading out for a tab nobody is looking at, and background tabs
    // throttle animation frames anyway, so cut straight to the pause.
    if (document.hidden) {
      bgm.pause();
      setMusicButtonState();
      return;
    }
    fadeMusicTo(0, MUSIC_FADE_OUT, () => {
      if (!musicShouldPlay()) bgm.pause();
      setMusicButtonState();
    });
  }
}

function toggleMusic(forceState) {
  if (!bgm) return;
  musicEnabled = typeof forceState === 'boolean' ? forceState : !musicEnabled;
  try {
    localStorage.setItem(MUSIC_STATE_KEY, musicEnabled ? '1' : '0');
  } catch (error) {}
  syncMusic();
}

if (bgm) {
  bgm.loop = true;
  bgm.volume = 0;
  try {
    if (localStorage.getItem(MUSIC_STATE_KEY) === '0') musicEnabled = false;
  } catch (error) {}

  // Chrome/Firefox block audible autoplay, so the first real click or keypress
  // marks the track as unlocked and lets it fade in.
  const unlockMusic = () => {
    if (musicUnlocked) return;
    musicUnlocked = true;
    window.removeEventListener('pointerdown', unlockMusic);
    window.removeEventListener('keydown', unlockMusic);
    syncMusic();
  };
  window.addEventListener('pointerdown', unlockMusic);
  window.addEventListener('keydown', unlockMusic);

  // Where autoplay is allowed outright, the theme starts without a gesture.
  const autoplay = bgm.play();
  if (autoplay && typeof autoplay.then === 'function') {
    autoplay.then(unlockMusic).catch(() => {});
  }

  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      musicUnlocked = true;
      toggleMusic();
    });
  }

  document.addEventListener('visibilitychange', syncMusic);

  ['playing', 'canplay', 'pause', 'ended', 'waiting', 'stalled'].forEach((eventName) => {
    bgm.addEventListener(eventName, syncMusic);
  });

  // Safety net: a play() request can be refused or interrupted around autoplay,
  // which would otherwise leave the track running in silence. If what the
  // element is doing disagrees with what should be happening, correct it.
  setInterval(() => {
    if (!bgm) return;
    const outOfSync = bgm.paused === musicShouldPlay() || (!bgm.paused && bgm.volume < 0.01);
    if (outOfSync) syncMusic();
  }, MUSIC_RECONCILE_MS);

  setMusicButtonState();
}
