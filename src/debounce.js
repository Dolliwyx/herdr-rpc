export class Debouncer {
  #timer;

  constructor(delayMs, callback, timers = globalThis) {
    this.delayMs = delayMs;
    this.callback = callback;
    this.timers = timers;
  }

  trigger() {
    this.timers.clearTimeout(this.#timer);
    this.#timer = this.timers.setTimeout(() => {
      this.#timer = undefined;
      this.callback();
    }, this.delayMs);
  }

  cancel() {
    this.timers.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
