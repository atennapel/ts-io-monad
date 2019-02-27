import IO from './IO';
import { log, Console, NativeConsole, Sleep, sleep, NativeSleep } from './Effects';

export const TestConsole: Console = {
  log: msg => new IO((env, done) => { console.log('TEST!: ' + msg); return done() }),
};

export const TestSleep: Sleep = {
  sleep: ms => new IO((env, done) => done()),
};

const program =
  log('a')
    .then(sleep(1000))
    .then(log('b'))
    .then(sleep(1000))
    .then(log('c'));

program.run(
  {
    ...NativeConsole,
    ...TestSleep,
  },
  () => { console.log('program done!') },
);
