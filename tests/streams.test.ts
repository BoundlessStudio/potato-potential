import { expect, it, vi } from "vitest";
import { parseSse } from "@boundless/shared";
import { boundedSse } from "../services/control-plane/src/streams";

it("rotates an idle stream within its deadline and releases only the viewer connection", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          'event: response.created\ndata: {"id":"response"}\n\n',
        ),
      );
    },
    cancel,
  });
  const events = [];
  for await (const e of parseSse(
    boundedSse(body, 25, new AbortController().signal),
  ))
    events.push(e.event);
  expect(events).toEqual(["response.created", "connection.rotate"]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
it("releases a disconnected viewer promptly without a reconnect event", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const abort = new AbortController();
  const read = boundedSse(body, 10_000, abort.signal).getReader();
  abort.abort();
  expect(await read.read()).toEqual({ done: true, value: undefined });
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
});
