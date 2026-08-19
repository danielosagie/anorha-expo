export function createConcurrencyLimiter(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`Concurrency limit must be a positive integer; received ${limit}`);
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    while (activeCount < limit && queue.length > 0) {
      const start = queue.shift();
      if (!start) return;
      activeCount += 1;
      start();
    }
  };

  return function runWithLimit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      });
      runNext();
    });
  };
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const runWithLimit = createConcurrencyLimiter(limit);
  return Promise.all(values.map((value, index) => runWithLimit(() => mapper(value, index))));
}
