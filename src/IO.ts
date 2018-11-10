/*
  TODO:
    error handling
    or
    either
    orSeq
    eitherSeq
*/
export class CancelledError extends Error {
  
  constructor() {
    super('Cancelled');
  }

}

enum ApStateTag {
  ApStateNothing,
  ApStateCancelled,
  ApStateError,
  ApStateValDone,
  ApStateFnDone,
}
type ApState<T, R> =
  { tag: ApStateTag.ApStateNothing } |
  { tag: ApStateTag.ApStateCancelled } |
  { tag: ApStateTag.ApStateError } |
  { tag: ApStateTag.ApStateValDone, val: T } |
  { tag: ApStateTag.ApStateFnDone, fn: (val: T) => R };

export type IOError<T> = IO<Error, T>;

export default class IO<E, T> {

  constructor(
    private readonly action: (
      resolve: (val: T) => void,
      reject: (err: E) => void,
      cancel: () => void,
      token: AbortSignal,
    ) => void,
  ) { }

  static of<E, T>(val: T): IO<E, T> {
    return new IO((resolve, reject, cancel, token) => {
      if(token.aborted) return cancel();
      return resolve(val);
    });
  }
  static error<E, T>(err: E): IO<E, T> {
    return new IO((resolve, reject, cancel, token) => {
      if(token.aborted) return cancel();
      return reject(err);
    });
  }

  run(
    resolve: (val: T) => void,
    reject: (err: E) => void,
    cancel: () => void,
    token: AbortController = new AbortController(),
  ): AbortController {
    if(token.signal.aborted) {
      cancel();
      return token;
    }
    this.action(resolve, reject, cancel, token.signal);
    return token;
  }

  map<R>(fn: (val: T) => R): IO<E, R> {
    return new IO<E, R>((resolve, reject, cancel, token) => {
      if(token.aborted) return cancel();
      return this.action(val => {
        if(token.aborted) return cancel();
        return resolve(fn(val));
      }, reject, cancel, token);
    });
  }

  ap<F, R>(fn: IO<F, (val: T) => R>): IO<E | F, R> {
    return new IO<E | F, R>((resolve, reject, cancel, token) => {
      if(token.aborted) return cancel();
      let state: ApState<T, R> = { tag: ApStateTag.ApStateNothing };
      const cancelIf = () => {
        if(token.aborted) {
          state = { tag: ApStateTag.ApStateCancelled };
          cancel();
          return true;
        }
        return false;
      };
      const cancelAll = () => {
        state = { tag: ApStateTag.ApStateCancelled };
        cancel();
      };
      fn.action(
        (fn: (val: T) => R) => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              state = { tag: ApStateTag.ApStateFnDone, fn };
              break;
            case ApStateTag.ApStateValDone:
              if(cancelIf()) return;
              resolve(fn(state.val)); break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              cancelAll();
              break;
          }
        },
        (err: F) => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              state = { tag: ApStateTag.ApStateError };
              reject(err);
              break;
            case ApStateTag.ApStateError:
              break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              reject(err);
              break;
          }
        },
        () => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              cancelAll();
              break;
            case ApStateTag.ApStateError:
              break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              cancelAll();
              break;
          }
        },
        token,
      );
      this.action(
        (val: T) => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              state = { tag: ApStateTag.ApStateValDone, val };
              break;
            case ApStateTag.ApStateFnDone:
              if(cancelIf()) return;
              resolve(state.fn(val)); break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              cancelAll();
              break;
          }
        },
        (err: E) => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              state = { tag: ApStateTag.ApStateError };
              reject(err);
              break;
            case ApStateTag.ApStateError:
              break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              reject(err);
              break;
          }
        },
        () => {
          switch(state.tag) {
            case ApStateTag.ApStateNothing:
              if(cancelIf()) return;
              cancelAll();
              break;
            case ApStateTag.ApStateError:
              break;
            case ApStateTag.ApStateCancelled:
              break;
            default:
              if(cancelIf()) return;
              cancelAll();
              break;
          }
        },
        token,
      );
    });
  }
  both<F, R>(that: IO<F, R>): IO<E | F, [T, R]> {
    return that.ap(this.map((t: T) => (r: R) => [t, r] as [T, R]));
  }

  chain<F, R>(fn: (val: T) => IO<F, R>): IO<E | F, R> {
    return new IO<E | F, R>((resolve, reject, cancel, token) => {
      if(token.aborted) return cancel();
      return this.action(val => {
        if(token.aborted) return cancel();
        fn(val).action(val => {
          if(token.aborted) return cancel();
          resolve(val);
        }, reject, cancel, token);
      }, reject, cancel, token);
    });
  }
  then<F, R>(that: IO<F, R>): IO<E | F, R> {
    return this.chain(() => that);
  }
  after<F, R>(that: IO<F, R>): IO<E | F, T> {
    return that.chain(() => this);
  }

  apSeq<F, R>(fn: IO<F, (val: T) => R>): IO<E | F, R> {
    return fn.chain(fn => this.map(v => fn(v)));
  }
  bothSeq<F, R>(that: IO<F, R>): IO<E | F, [T, R]> {
    return this.chain(t => that.map(r => [t, r] as [T, R]));
  }

  doWhile(fn: (val: T) => boolean): IO<E, T> {
    return this.chain(val => fn(val)? this.doWhile(fn): IO.of(val));
  }
  doUntil(fn: (val: T) => boolean): IO<E, T> {
    return this.doWhile(val => !fn(val));
  }
  loop(): IO<E, never> {
    return this.doWhile(() => true) as IO<E, never>;
  }

}
