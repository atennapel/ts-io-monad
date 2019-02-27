export default class IO<A, T> {

  constructor(
    public readonly run: (env: A, done: (val: T) => void) => void,
  ) {}

  static of<T>(val: T): IO<any, T> {
    return new IO((env, done) => done(val));
  }

  static ask<A>(): IO<A, A> {
    return new IO((env, done) => done(env));
  }

  map<R>(fn: (val: T) => R): IO<A, R> {
    return new IO((env, done) => this.run(env, (x: T) => done(fn(x))));
  }

  mapEnv<B>(fn: (val: B) => A): IO<B, T> {
    return new IO((env, done) => this.run(fn(env), done));
  }

  bind<B, R>(fn: (val: T) => IO<B, R>): IO<A & B, R> {
    return new IO((env, done) => this.run(env, (x: T) => fn(x).run(env, done)));
  }

  then<B, R>(that: IO<B, R>): IO<A & B, R> {
    return this.bind(() => that);
  }

}
