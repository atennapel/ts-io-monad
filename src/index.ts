import IO, { log, timeout, timeoutWithProgress } from './IO';

const program =
  IO.bracket(
    IO.of(2),
    val => timeoutWithProgress(3000).map(() => val),
    val => console.log('release', val),
  );

const controller = program.run(
  val => console.log('resolve', val),
  err => console.log('error', ''+err),
  progress => console.log('progress', progress),
);

controller.abort();
