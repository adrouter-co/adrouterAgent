export interface BoundedResponseOptions {
  maxBytes: number;
  idleTimeoutMs: number;
  overallTimeoutMs: number;
  signal?: AbortSignal;
  label?: string;
}

export class RouterResponseLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RouterResponseLimitError';
  }
}

const readWithDeadlines = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: BoundedResponseOptions,
  startedAt: number
): Promise<ReadableStreamReadResult<Uint8Array>> => {
  const label = options.label ?? 'Router response';
  const remaining = options.overallTimeoutMs - (Date.now() - startedAt);
  if (remaining <= 0) {
    return Promise.reject(new RouterResponseLimitError(`${label} exceeded its overall timeout.`));
  }
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void =>
      finish(() => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new RouterResponseLimitError(`${label} exceeded its response-body timeout.`))
        ),
      Math.min(options.idleTimeoutMs, remaining)
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error))
    );
  });
};

export async function* iterateBoundedResponse(
  response: Response,
  options: BoundedResponseOptions
): AsyncGenerator<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  const label = options.label ?? 'Router response';
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RouterResponseLimitError(`${label} exceeds the ${options.maxBytes}-byte limit.`);
  }
  if (!response.body) return;

  const reader = response.body.getReader();
  const startedAt = Date.now();
  let bytes = 0;
  let completed = false;
  try {
    while (true) {
      const result = await readWithDeadlines(reader, options, startedAt);
      if (result.done) {
        completed = true;
        return;
      }
      if (!result.value) continue;
      bytes += result.value.byteLength;
      if (bytes > options.maxBytes) {
        throw new RouterResponseLimitError(`${label} exceeds the ${options.maxBytes}-byte limit.`);
      }
      yield result.value;
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export const readBoundedResponseText = async (
  response: Response,
  options: BoundedResponseOptions
): Promise<string> => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of iterateBoundedResponse(response, options)) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
};

export const readBoundedResponseJson = async (
  response: Response,
  options: BoundedResponseOptions
): Promise<unknown> => JSON.parse(await readBoundedResponseText(response, options));
