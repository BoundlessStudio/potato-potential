import { afterEach, expect, it, vi } from "vitest";
import { Agent37, Inkbox } from "../services/control-plane/src/providers";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each(["health", "exec", "start"])(
  "allows a two-minute cold wake for Agent37 %s and still bounds a hung request",
  async (operation) => {
    vi.useFakeTimers();
    let delay = 120_000;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve(
                  Response.json({
                    healthy: true,
                    stdout: "done",
                    stderr: "",
                    exit_code: 0,
                  }),
                ),
              delay,
            );
            init.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const provider = new Agent37("test-admin-key");
    const invoke = () =>
      operation === "health"
        ? provider.healthy("abcdefghij")
        : operation === "exec"
          ? provider.exec("abcdefghij", "true")
          : provider.start("abcdefghij");
    const outcome = invoke().then(
      () => "completed",
      (error) => error.name,
    );
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await outcome).toBe("completed");
    delay = 250_000;
    const hung = invoke().then(
      () => "completed",
      (error) => error.name,
    );
    await vi.advanceTimersByTimeAsync(200_001);
    expect(await hung).toBe("AbortError");
  },
);
it("uses hosting auth, managed cap contract, and an owner desktop token lasting 60 seconds", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ monthly_cap_micros: 5_000_000 }))
    .mockResolvedValueOnce(
      Response.json({
        url: "https://abcdefghij-6901.agent37.app/?a37_token=owner-token",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const a37 = new Agent37("admin-key");
  await a37.budget("abcdefghij", 5_000_000);
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-key");
  expect(fetch.mock.calls[0][1].method).toBe("PATCH");
  expect(await a37.desktop("abcdefghij")).toEqual({
    ws: "wss://abcdefghij-6901.agent37.app/websockify?a37_token=owner-token",
  });
  expect(JSON.parse(fetch.mock.calls[1][1].body).ttl_seconds).toBe(60);
});
it("accepts only the exact owner inbound 1:1 verification from Inkbox records", async () => {
  const messages = [
    {
      direction: "outbound",
      remote_number: "+14165550123",
      content: "VERIFY ABC",
    },
    {
      direction: "inbound",
      remote_number: "+14165550999",
      content: "VERIFY ABC",
    },
    {
      direction: "inbound",
      remote_number: "+14165550123",
      content: "VERIFY ABC",
      is_group: true,
    },
    {
      direction: "inbound",
      remote_number: "+14165550123",
      content: "VERIFY ABC",
      is_blocked: true,
    },
  ];
  const fetch = vi.fn().mockImplementation(async () => Response.json(messages));
  vi.stubGlobal("fetch", fetch);
  const provider = new Inkbox("admin");
  expect(
    await provider.findConfirmation(
      "own-identity",
      "+14165550123",
      "VERIFY ABC",
    ),
  ).toBe(false);
  messages.push({
    direction: "inbound",
    remote_number: "+14165550123",
    content: "VERIFY ABC",
  });
  expect(
    await provider.findConfirmation(
      "own-identity",
      "+14165550123",
      "VERIFY ABC",
    ),
  ).toBe(true);
  expect(fetch.mock.calls[0][0]).toContain("agent_identity_id=own-identity");
});
it("sends exact fractional modification-time guards and keeps the catalog unfiltered", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetch);
  const a37 = new Agent37("admin");
  await a37.writeFile("abcdefghij", "~/.hermes/SOUL.md", "persona", 123.456);
  expect(fetch.mock.calls[0][1].headers["X-Expected-Mtime"]).toBe("123.456");
  expect(fetch.mock.calls[0][1].headers["X-Agent37-Key"]).toBe("admin");
  await a37.toolkits("abcdefghij", "", "page-two");
  expect(fetch.mock.calls[1][0]).toContain("cursor=page-two");
  expect(fetch.mock.calls[1][0]).not.toContain("enabled=");
  expect(new URL(fetch.mock.calls[1][0]).searchParams.has("search")).toBe(
    false,
  );
});
it("maps the real catalog items contract and passes opaque pagination cursors unchanged", async () => {
  const toolkit = {
    slug: "gmail",
    name: "Gmail",
    description: "Email",
    enabled: false,
    isNoAuth: false,
    authSchemes: ["OAUTH2"],
  };
  const cursor = "next+/page=?";
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ items: [toolkit], nextCursor: cursor, totalItems: 2 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        items: [{ ...toolkit, slug: "slack", name: "Slack" }],
        nextCursor: null,
        totalItems: 2,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const provider = new Agent37("admin");
  expect(await provider.toolkits("abcdefghij", "  gmail  ")).toEqual({
    toolkits: [toolkit],
    nextCursor: cursor,
  });
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get("search")).toBe(
    "gmail",
  );
  expect(
    (await provider.toolkits("abcdefghij", "gmail", cursor)).toolkits[0].slug,
  ).toBe("slack");
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get("cursor")).toBe(
    cursor,
  );
});
it("reports malformed catalogs as a provider error instead of an empty result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ nextCursor: "more" })),
  );
  await expect(
    new Agent37("admin").toolkits("abcdefghij", ""),
  ).rejects.toMatchObject({ status: 502, code: "invalid_catalog" });
});
it("opens an empty, guarded native memory file when its parent is absent", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ error: "not_found" }, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  expect(
    await new Agent37("admin").readFile(
      "abcdefghij",
      "~/.hermes/memories/MEMORY.md",
    ),
  ).toEqual({ content: "", modified: 0 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("requires recipient-initiated SMS consent and the owner verification code", async () => {
  const texts = [
    {
      direction: "outbound",
      remote_phone_number: "+14165550123",
      text: "START",
    },
    {
      direction: "inbound",
      remote_phone_number: "+14165550999",
      text: "START",
    },
    {
      direction: "inbound",
      remote_phone_number: "+14165550123",
      text: "VERIFY ABC",
    },
  ];
  const fetch = vi
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json(url.includes("/texts") ? texts : []),
    );
  vi.stubGlobal("fetch", fetch);
  const inkbox = new Inkbox("admin");
  expect(
    await inkbox.findConfirmation(
      "identity",
      "+14165550123",
      "VERIFY ABC",
      "own-number",
    ),
  ).toBe(false);
  texts.push({
    direction: "inbound",
    remote_phone_number: "+14165550123",
    text: "START",
  });
  expect(
    await inkbox.findConfirmation(
      "identity",
      "+14165550123",
      "VERIFY ABC",
      "own-number",
    ),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(([url]) =>
      url.includes("/phone/numbers/own-number/texts"),
    ),
  ).toBe(true);
});
