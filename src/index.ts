import IO, { log, timeout, timeoutWithProgress } from './IO';

const program =
  timeout(2000).then(log('a'))
  .map3(
    (a, b, c) => 42,
    timeout(1000).then(log('b')).error('whaaa'),
    log('c'),
  );

const controller = program.run(
  val => console.log('resolve', val),
  err => console.log('error', ''+err),
  progress => console.log('progress', progress),
);

//controller.abort();
