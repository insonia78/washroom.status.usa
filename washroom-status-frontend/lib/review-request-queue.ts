type Job = {start: () => void; cancel: () => void};
const queue: Job[] = [];
const concurrency = 4;
let active = 0;

function drain() {
  while (active < concurrency && queue.length) queue.shift()!.start();
}

export function fetchLatestReview(url: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {reject(signal.reason);return;}
    let started = false;
    const job: Job = {
      start() {
        started = true;
        signal.removeEventListener('abort', job.cancel);
        active++;
        void fetch(url, {signal, cache: 'no-store'})
          .then(async response => {
            const data: unknown = await response.json();
            if (!response.ok) {
              const message = typeof data === 'object' && data !== null &&
                'error' in data && typeof data.error === 'string' ? data.error : 'Could not load the latest review.';
              throw new Error(message);
            }
            return data;
          }).then(resolve, reject).finally(() => {active--;drain();});
      },
      cancel() {
        if (started) return;
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        signal.removeEventListener('abort', job.cancel);
        reject(signal.reason);
      },
    };
    signal.addEventListener('abort', job.cancel, {once: true});
    queue.push(job);
    drain();
  });
}
