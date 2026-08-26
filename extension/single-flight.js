export function createSingleFlight() {
  const pending = new Map();

  return function run(key, operation) {
    const current = pending.get(key);
    if (current) return current;

    const promise = Promise.resolve().then(operation);
    pending.set(key, promise);
    return promise.finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  };
}
