import AbortController, { AbortSignal, AbortError } from './AbortController';

/*
TODO:
  - chain2, chain2seq
  - MonadPlus, or
  - all, any, both3, map3 ...and seq versions
  - looping, retries, loop with state
  - figure out how to handle exceptions
  - fetch/xmlhttprequest wrapping
  - foldable, traversable, sequence, foldMap?
  - maybe rethink bracket
*/

export type Task<T> = IO<Error, never, T>;
type Err<E> = E | AbortError;

// State of concurrent execution of two computations
type CState<A, B> =
  { tag: 'Waiting' } |
  { tag: 'Error' } |
  { tag: 'LeftDone', val: A } |
  { tag: 'RightDone', val: B };

/*
  An asynchonous computation that either:
  - results in a value of type T
  - results in an error of type E
  - is aborted, resulting in an error of type AbortError 
  - loops forever
  also can make progress reports of type P
*/
export default class IO<E, P, T> {

  constructor(
    private readonly action: (
      resolve: (val: T) => void,
      reject: (err: Err<E>) => void,
      report: (progress: P) => void,
      controller: AbortController,
    ) => void
  ) { }

  static of<T>(val: T): IO<never, never, T> {
    return new IO((resolve, reject, report, controller) => resolve(val));
  }
  static error<E>(err: Err<E>): IO<E, never, never> {
    return new IO((resolve, reject, report, controller) => reject(err));
  }

  /* Various ways to unleash the effects within */
  run(
    resolve: (val: T) => void = () => { },
    reject: (err: Err<E>) => void = err => { throw err },
    report: (progress: P) => void = () => { },
    controller: AbortController = new AbortController(),
  ): AbortController {
    const signal = controller.signal;
    let alreadyDone = false;
    let alreadyError = false;
    const abort = () => {
      if (alreadyDone) throw new Error('abort called after resolve');
      if (alreadyError) throw new Error('abort called after reject');
      alreadyError = true;
      reject(new AbortError());
    };
    this.action(
      (val: T) => {
        if (signal.aborted) return abort();
        if (alreadyDone) throw new Error('resolve called more than once');
        if (alreadyError) throw new Error('resolve called after reject');
        alreadyDone = true;
        return resolve(val);
      },
      (err: Err<E>) => {
        if (signal.aborted) return abort();
        if (alreadyDone) throw new Error('reject called after resolve');
        if (alreadyError) throw new Error('reject called more than once');
        alreadyError = true;
        return reject(err);
      },
      (progress: P) => {
        if (signal.aborted) return abort();
        if (alreadyDone) throw new Error('report called after resolve');
        if (alreadyError) throw new Error('report called more than once');
        report(progress);
      }, controller);
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
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      return this.action(
        (val: T) => {
          if (controller.signal.aborted) return reject(new AbortError());
          return resolve(fn(val));
        },
        reject,
        report,
        controller,
      )
    });
  }
  mapError<F>(fn: (err: Err<E>) => Err<F>): IO<F, P, T> {
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      return this.action(
        resolve,
        (err: Err<E>) => {
          if (controller.signal.aborted) return reject(new AbortError());
          return reject(fn(err));
        },
        report,
        controller,
      )
    });
  }
  mapProgress<Q>(fn: (progress: P) => Q): IO<E, Q, T> {
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      return this.action(
        resolve,
        reject,
        (progress: P) => {
          if (controller.signal.aborted) return reject(new AbortError());
          return report(fn(progress));
        },
        controller,
      )
    });
  }

  map2<F, Q, R, S>(fn: (a: T, b: R) => S, that: IO<F, Q, R>): IO<E|F, P|Q, S> {
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      let state: CState<T, R> = { tag: 'Waiting' };

      const ifAborted = () => {
        if (state.tag !== 'Error' && controller.signal.aborted) {
          state = { tag: 'Error' };
          reject(new AbortError());
          return true;
        }
        return false;
      };
      const onError = (err: Err<E | F>) => {
        switch(state.tag) {
          case 'Error': return;
          case 'LeftDone':
          case 'RightDone':
          case 'Waiting':
            if (ifAborted()) return;  
            state = { tag: 'Error' };
            reject(err);
            controller.abort();
            return;
        }
      };

      this.action(
        val => {
          switch(state.tag) {
            case 'Waiting':
              if (ifAborted()) return;
              state = { tag: 'LeftDone', val };
              return;
            case 'Error': return;
            case 'LeftDone':
              ifAborted();
              return;
            case 'RightDone':
              if (ifAborted()) return;
              return resolve(fn(val, state.val));
          }
        },
        onError,
        prog => {
          switch(state.tag) {
            case 'Error': return;
            case 'LeftDone': 
              ifAborted()
              return;
            case 'RightDone':
            case 'Waiting':
              if (ifAborted()) return;
              return report(prog);
          }
        },
        controller,
      );
      that.action(
        val => {
          switch(state.tag) {
            case 'Waiting':
              if (ifAborted()) return;
              state = { tag: 'RightDone', val };
              return;
            case 'Error': return;
            case 'RightDone':
              ifAborted();
              return;
            case 'LeftDone':
              if (ifAborted()) return;
              return resolve(fn(state.val, val));
          }
        },
        onError,
        prog => {
          switch(state.tag) {
            case 'Error': return;
            case 'RightDone': 
              ifAborted()
              return;
            case 'LeftDone':
            case 'Waiting':
              if (ifAborted()) return;
              return report(prog);
          }
        },
        controller,
      );
    });
  }
  ap<F, Q, R>(that: IO<F, Q, (val: T) => R>): IO<E|F, P|Q, R> {
    return this.map2((val, fn) => fn(val), that);
  }
  both<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, [T, R]> {
    return this.map2((a, b) => [a, b] as [T, R], that);
  }

  chain<F, Q, R>(fn: (val: T) => IO<F, Q, R>): IO<E|F, P|Q, R> {
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      return this.action(
        (val: T) => {
          if (controller.signal.aborted) return reject(new AbortError());
          return fn(val).action(resolve, reject, report, controller);
        },
        reject,
        report,
        controller,
      )
    });
  }
  static join<E, F, P, Q, T>(action: IO<E, P, IO<F, Q, T>>): IO<E|F, P|Q, T> {
    return action.chain(x => x);
  }
  then<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, R> {
    return this.chain(() => that);
  }
  after<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, T> {
    return that.chain(() => this);
  }
  error<F>(err: F): IO<E|F, P, never> {
    return this.then(IO.error(err));
  }

  map2Seq<F, Q, R, S>(fn: (a: T, b: R) => S, that: IO<F, Q, R>): IO<E|F, P|Q, S> {
    return this.chain(a => that.map(b => fn(a, b)));
  }
  apSeq<F, Q, R>(that: IO<F, Q, (val: T) => R>): IO<E|F, P|Q, R> {
    return this.map2Seq((val, fn) => fn(val), that);
  }
  bothSeq<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, [T, R]> {
    return this.map2Seq((a, b) => [a, b] as [T, R], that);
  }

  doWhile(fn: (val: T) => boolean): IO<E, P, T> {
    return this.chain(val => fn(val) ? this.doWhile(fn) : IO.of(val));
  }
  doUntil(fn: (val: T) => boolean) {
    return this.doWhile(val => !fn(val));
  }
  loop(): IO<E, P, never> {
    return this.doWhile(() => true) as IO<E, P, never>;
  }

  catch<F, Q, R>(fn: (err: Err<E>) => IO<F, Q, R>): IO<E|F, P|Q, T|R> {
    return new IO((resolve, reject, report, controller) => {
      if (controller.signal.aborted) return reject(new AbortError());
      return this.action(
        resolve,
        (err: Err<E>) => {
          if (controller.signal.aborted) return reject(new AbortError());
          return fn(err).action(resolve, reject, report, controller);
        },
        report,
        controller,
      );
    });
  }
  static tryCatch<E, F, P, Q, T, R>(tr: IO<E, P, T>, onError: (err: Err<E>) => IO<F, Q, R>): IO<E|F, P|Q, T|R> {
    return tr.catch(onError);
  }
  catchThen<F, Q, R>(that: IO<F, Q, R>): IO<E|F, P|Q, T|R> {
    return this.catch(() => that);
  }
  catchMap<R>(then: R): IO<E, P, T|R> {
    return this.catch(() => IO.of(then));
  }

  static bracket<E, F, P, Q, T, R>(
    acquire: IO<E, P, T>, 
    use: (val: T) => IO<F, Q, R>,
    release: (val: T) => void,
  ): IO<E|F, P|Q, R> {
    return acquire.chain(val => new IO((resolve, reject, report, controller) => {
      return use(val).action(
        ret => { resolve(ret); release(val) },
        err => { reject(err); release(val) },
        report,
        controller,
      );
    }));
  }

}

// utilities
export const log = (msg: any) => new IO<never, never, void>((resolve, reject, report, controller) => {
  if (controller.signal.aborted) return reject(new AbortError());
  console.log(msg);
  resolve(undefined);
});

export const timeout = (time: number) => new IO<never, never, void>((resolve, reject, report, controller) => {
  if (controller.signal.aborted) return reject(new AbortError());
  const id = setTimeout(
    () => {
      if (controller.signal.aborted) return reject(new AbortError());
      resolve(undefined);
    },
    time
  );
  controller.signal.addEventListener('abort', () => {
    clearTimeout(id);
    return reject(new AbortError());
  });
});

export const timeoutWithProgress = (time: number, interval: number = 1000) =>
  new IO<never, number, number>((resolve, reject, report, controller) => {
    if (controller.signal.aborted) return reject(new AbortError());
    const start = Date.now();
    let current = start;
    let id: any = null;
    const fn = () => {
      if (controller.signal.aborted) return reject(new AbortError());
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
    controller.signal.addEventListener('abort', () => {
      clearTimeout(id);
      return reject(new AbortError());
    });
  });
