/** Detach the HTTP viewer without cancelling the persistent Agent37 response. */
export function boundedSse(
  body: ReadableStream<Uint8Array>,
  milliseconds: number,
  signal: AbortSignal,
) {
  const reader = body.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (rotate: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (rotate)
          controller.enqueue(
            new TextEncoder().encode("event: connection.rotate\ndata: {}\n\n"),
          );
        controller.close();
        void reader.cancel().catch(() => {});
      };
      abort = () => finish(false);
      timer = setTimeout(() => finish(true), milliseconds);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void (async () => {
        try {
          while (!finished) {
            const { done, value } = await reader.read();
            if (finished) break;
            if (done) {
              finish(false);
              break;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          if (!finished) {
            finished = true;
            controller.error(error);
          }
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reader.releaseLock();
        }
      })();
    },
    async cancel() {
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      await reader.cancel();
    },
  });
}
