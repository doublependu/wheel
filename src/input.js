// Single-button input: Space / ArrowUp / W or a pointer press anywhere on the game.
// Esc / P pause and M mute are extra keyboard shortcuts, not gameplay controls.
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);

export class Input {
  constructor(target = window) {
    this.presses = 0;
    this.keysDown = new Set();
    this.pointers = new Set();
    this.onPress = null; // (source) => void, fires on every button-down edge
    this.onKey = null; // (code) => void for Esc / P / M

    target.addEventListener('keydown', (e) => {
      if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        if (e.repeat || this.keysDown.has(e.code)) return;
        const wasHeld = this.held;
        this.keysDown.add(e.code);
        if (!wasHeld) this.#press('key');
      } else if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'KeyM' || e.code === 'Enter')) {
        this.onKey?.(e.code);
      }
    });
    target.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.pointers.clear();
    });

    target.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('a, button, #credits')) return;
      if (e.button > 0) return;
      e.preventDefault();
      const wasHeld = this.held;
      this.pointers.add(e.pointerId);
      if (!wasHeld) this.#press('pointer');
    }, { passive: false });
    const up = (e) => this.pointers.delete(e.pointerId);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get held() {
    return this.keysDown.size > 0 || this.pointers.size > 0;
  }

  #press(source) {
    this.presses++;
    this.onPress?.(source);
  }

  takePress() {
    if (this.presses > 0) {
      this.presses--;
      return true;
    }
    return false;
  }

  clear() {
    this.presses = 0;
  }
}
