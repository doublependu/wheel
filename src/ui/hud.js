// DOM HUD and screen overlays (loaders, title, pause, game over) plus credits.
const $ = (id) => document.getElementById(id);

const HI_KEY = 'wheel.hi';

export function loadHiScore() {
  try {
    return Number(localStorage.getItem(HI_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveHiScore(v) {
  try {
    localStorage.setItem(HI_KEY, String(v));
  } catch {
    // storage unavailable (private mode): keep it for this session only
  }
}

const pad = (n) => String(n).padStart(5, '0');
const SCREENS = ['preload', 'loading', 'decay', 'title', 'run', 'paused', 'over'];

export class Hud {
  constructor() {
    this.body = document.body;
    this.score = $('score');
    this.prompt = $('prompt');
    this.result = $('result');
    this.title = $('title');
    this.muteBtn = $('mute-btn');
    this.pauseBtn = $('pause-btn');
    this.lastScore = -1;
    this.hi = loadHiScore();
    $('credits-btn').addEventListener('click', () => ($('credits').hidden = false));
    $('credits-close').addEventListener('click', () => ($('credits').hidden = true));
  }

  setScreen(name) {
    for (const s of SCREENS) this.body.classList.remove(`screen-${s}`);
    this.body.classList.add(`screen-${name}`);
    if (name === 'paused') {
      this.title.textContent = 'PAUSED';
      this.result.textContent = '';
      this.prompt.textContent = 'Tap or press Space to resume';
    } else if (name === 'title') {
      this.title.textContent = 'WHEEL';
    }
  }

  setReady(text) {
    this.prompt.textContent = text;
    this.body.classList.add('ready');
  }

  setEra(era) {
    for (let i = 1; i <= 7; i++) this.body.classList.toggle(`era-${i}`, i === era);
  }

  setScore(score) {
    if (score === this.lastScore) return;
    this.lastScore = score;
    this.score.innerHTML = `${this.hi ? `<span class="hi">HI ${pad(this.hi)}</span>` : ''}${pad(score)}`;
  }

  gameOver(score) {
    const best = score > this.hi;
    if (best) {
      this.hi = score;
      saveHiScore(score);
    }
    this.lastScore = -1;
    this.setScore(score);
    this.title.textContent = 'GAME OVER';
    this.result.textContent = `${best ? 'New best! ' : ''}Score ${pad(score)}`;
    this.prompt.textContent = 'Tap or press Space to run again';
  }

  setMuted(muted) {
    this.muteBtn.textContent = muted ? '×♪' : '♪';
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  setCredits(items) {
    const list = $('credits-list');
    list.innerHTML = '';
    for (const c of items) {
      const p = document.createElement('p');
      p.innerHTML = c;
      list.appendChild(p);
    }
  }
}
