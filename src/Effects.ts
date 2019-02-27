import IO from './IO';

export interface Console {
  log(msg: string): IO<any, void>;
}

export const log = (msg: string): IO<Console, void> =>
  IO.ask<Console>().bind(c => c.log(msg));

export const NativeConsole: Console = {
  log: msg => new IO((env, done) => { console.log(msg); return done() }),
};

export interface Sleep {
  sleep(ms: number): IO<any, void>;
}

export const sleep = (ms: number): IO<Sleep, void> =>
  IO.ask<Sleep>().bind(s => s.sleep(ms));

export const NativeSleep: Sleep = {
  sleep: ms => new IO((env, done) => { setTimeout(() => done(), ms) }),
};
