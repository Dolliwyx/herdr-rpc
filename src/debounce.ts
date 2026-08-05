export interface TimerApi {
  setTimeout(callback: () => void, delay?: number): unknown;
  clearTimeout(timer: unknown): void;
}

export class Debouncer {
  #timer: unknown;
  readonly delayMs: number;
  readonly callback: () => void;
  readonly timers: TimerApi;

  constructor(
    delayMs: number,
    callback: () => void,
    timers: TimerApi = globalThis,
  ) {
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
