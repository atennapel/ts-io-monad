import IO, { log, timeout, timeoutWithProgress } from './IO';

const program = timeoutWithProgress(5000);

const controller = program.run(
  val => console.log('resolve', val),
  err => console.log('error', ''+err.message),
  progress => console.log('progress', progress),
);

// controller.abort();
