import IO from './IO';
import { log, timeout } from './util';

const program =
  timeout(2000).then(log('a')).map(() => 1)
    .both(log('b').then(IO.error('fail')));

const control = program.run(
  val => console.log('done', val),
  val => console.log('error', val),
  () => console.log('cancel')
);

control.abort();
