export async function executeWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();
  const limit = Math.max(1, concurrency);

  for (let i = 0; i < tasks.length; i++) {
    const index = i;
    const promise = tasks[index]().then((result) => {
      results[index] = result;
    });
    const wrapped = promise.then(() => {
      executing.delete(wrapped);
    });

    executing.add(wrapped);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
