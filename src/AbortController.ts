/*
  Incomplete implementation of AbortController for testing purposes
*/

export class AbortError extends Error {

  constructor() {
    super('Aborted');
  }

}

export class AbortSignal {

  private _aborted: boolean = false;
  private _handlers: (() => void)[] = [];

  contructor() { }

  _abort() {
    this._aborted = true;
    for (let i = 0; i < this._handlers.length; i++) {
      this._handlers[i]();
    }
    this._handlers = [];
  }

  get aborted() { return this._aborted }

  addEventListener(_event: 'abort', fn: () => void) {
    if(this._aborted) {
      fn();
    } else {
      this._handlers.push(fn);
    }
  }

}

export default class AbortController {

  public readonly signal: AbortSignal;

  constructor() {
    this.signal = new AbortSignal();
  }

  abort(): void {
    this.signal._abort();
  }

}
