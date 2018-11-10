import AbortController, { AbortSignal, AbortError } from './AbortController';

/*
TODO:
  - error handling
  - Applicative instance
*/

/*
  An asynchonous computation that either:
  - results in a value of type T
  - results in an error of type E
  - is aborted, resulting in an error of type AbortError 
  - loops forever
  also can make progress reports of type P
*/
export type Task<T> = IO<Error, never, T>;
type Err<E> = E | AbortError;
export default class IO<E, P, T> {

  constructor(
    private readonly action: (
      resolve: (val: T) => void,
      reject: (err: Err<E>) => void,
      report: (progress: P) => void,
      signal: AbortSignal,
    ) => void
  ) { }

  static of<T>(val: T): IO<never, never, T> {
    return new IO((resolve, reject, report, signal) => resolve(val));
  }
  static error<E>(err: Err<E>): IO<E, never, never> {
    return new IO((resolve, reject, report, signal) => reject(err));
  }

  /* Various ways to unleash the effects within */
  run(
    resolve: (val: T) => void = () => { },
    reject: (err: Err<E>) => void = err => { throw err },
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController(),
  ): AbortController {
    const signal = controller.signal;
    this.action(
      (val: T) => {
        if (signal.aborted) return reject(new AbortError());
        return resolve(val);
      },
      (err: Err<E>) => {
        if (signal.aborted) return reject(new AbortError());
        return reject(err);
      },
      (progress: P) => {
        if (signal.aborted) return;
        report(progress);
      }, signal);
    return controller;
  }
  runImmediate(
    resolve: (val: T) => void = () => { },
    reject: (err: Err<E>) => void = err => { throw err },
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController(),
  ): AbortController {
    setImmediate(() => this.run(resolve, reject, report, controller));
    return controller;
  }
  runTimeout(
    time: number = 0,
    resolve: (val: T) => void = () => { },
    reject: (err: Err<E>) => void = err => { throw err },
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController(),
  ): AbortController {
    setTimeout(() => this.run(resolve, reject, report, controller), time);
    return controller;
  }

  /* Convert to a promise */
  toPromise(
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController()
  ): Promise<T> {
    return new Promise((resolve, reject) => this.run(resolve, reject, report, controller));
  }
  toPromiseImmediate(
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController()
  ): Promise<T> {
    return new Promise((resolve, reject) => this.runImmediate(resolve, reject, report, controller));
  }
  toPromiseTimeout(
    time: number = 0,
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController()
  ): Promise<T> {
    return new Promise((resolve, reject) => this.runTimeout(time, resolve, reject, report, controller));
  }

  map<R>(fn: (val: T) => R): IO<E, P, R> {
    return new IO((resolve, reject, report, signal) => {
      if (signal.aborted) return reject(new AbortError());
      return this.action(
        (val: T) => {
          if (signal.aborted) return reject(new AbortError());
          return resolve(fn(val));
        },
        reject,
        report,
        signal,
      )
    });
  }
  mapError<F>(fn: (err: Err<E>) => Err<F>): IO<F, P, T> {
    return new IO((resolve, reject, report, signal) => {
      if (signal.aborted) return reject(new AbortError());
      return this.action(
        resolve,
        (err: Err<E>) => {
          if (signal.aborted) return reject(new AbortError());
          return reject(fn(err));
        },
        report,
        signal,
      )
    });
  }
  mapProgress<Q>(fn: (progress: P) => Q): IO<E, Q, T> {
    return new IO((resolve, reject, report, signal) => {
      if (signal.aborted) return reject(new AbortError());
      return this.action(
        resolve,
        reject,
        (progress: P) => {
          if (signal.aborted) return reject(new AbortError());
          return report(fn(progress));
        },
        signal,
      )
    });
  }

  chain<F, Q, R>(fn: (val: T) => IO<F, Q, R>): IO<E|F, P|Q, R> {
    return new IO((resolve, reject, report, signal) => {
      if (signal.aborted) return reject(new AbortError());
      return this.action(
        (val: T) => {
          if (signal.aborted) return reject(new AbortError());
          return fn(val).action(resolve, reject, report, signal);
        },
        reject,
        report,
        signal,
      )
    });
  }
  then<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, R> {
    return this.chain(() => that);
  }
  after<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, T> {
    return that.chain(() => this);
  }

  apSeq<F, Q, R>(that: IO<F, Q, (val: T) => R>): IO<E|F, P|Q, R> {
    return that.chain(fn => this.map(val => fn(val)));
  }
  bothSeq<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, [T, R]> {
    return this.chain(t => that.map(r => [t, r] as [T, R]));
  }

}

// utilities
export const log = (msg: any) => new IO<never, never, void>((resolve, reject, report, signal) => {
  if (signal.aborted) return reject(new AbortError());
  console.log(msg);
  resolve(undefined);
});

export const timeout = (time: number) => new IO<never, never, void>((resolve, reject, report, signal) => {
  if (signal.aborted) return reject(new AbortError());
  const id = setTimeout(
    () => {
      if (signal.aborted) return reject(new AbortError());
      resolve(undefined);
    },
    time
  );
  signal.addEventListener('abort', () => {
    clearTimeout(id);
    return reject(new AbortError());
  });
});

export const timeoutWithProgress = (time: number, interval: number = 1000) =>
  new IO<never, number, number>((resolve, reject, report, signal) => {
    if (signal.aborted) return reject(new AbortError());
    const start = Date.now();
    let current = start;
    let id: any = null;
    const fn = () => {
      if (signal.aborted) return reject(new AbortError());
      const now = Date.now();
      const diffFromStart = now - start;
      if (now - start >= time) {
        resolve(diffFromStart);
      } else {
        report(now - current);
        current = now;
        id = setTimeout(fn, interval);
      }
    };
    id = setTimeout(fn, interval);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      return reject(new AbortError());
    });
  });
