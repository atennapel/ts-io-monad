import IO from "./IO";

export const log = <E>(msg: any) => new IO<E, void>((resolve, reject, cancel, token) => {
  if(token.aborted) return cancel();
  console.log(msg);
  resolve(undefined);
});

export const timeout = <E>(time: number) => new IO<E, void>((resolve, reject, cancel, token) => {
  if (token.aborted) return cancel();
  const id = setTimeout(
    () => {
      if (token.aborted) {
        clearTimeout(id);
        return cancel();
      }
      resolve(undefined);
    },
    time
  );
  token.addEventListener('abort', () => {
    clearTimeout(id);
    return cancel();
  });
});
