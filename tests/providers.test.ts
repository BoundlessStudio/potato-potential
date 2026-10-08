import { afterEach, expect, it, vi } from "vitest";
import { Agent37, Inkbox } from "../services/control-plane/src/providers";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("uses native remote directory listings while excluding files, links and unsafe destinations", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        exit_code: 0,
        stdout: JSON.stringify({ path: "/home/node" }),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        path: "/home/node",
        parentPath: "/home",
        truncated: true,
        entries: [
          {
            name: "客户",
            path: "/home/node/客户",
            type: "directory",
            hidden: false,
          },
          {
            name: ".hermes",
            path: "/home/node/.hermes",
            type: "directory",
            hidden: true,
          },
          {
            name: "file.txt",
            path: "/home/node/file.txt",
            type: "file",
            hidden: false,
          },
          {
            name: "alias",
            path: "/home/node/alias",
            type: "symlink",
            hidden: false,
          },
          { name: "escape", path: "/etc", type: "directory", hidden: false },
          {
            name: "..",
            path: "/home/node/..",
            type: "directory",
            hidden: true,
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        exit_code: 1,
        stdout: JSON.stringify({
          code: "invalid_directory",
          error: "Symbolic link.",
        }),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        exit_code: 1,
        stdout: JSON.stringify({
          code: "directory_not_found",
          error: "Missing folder.",
        }),
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const provider = new Agent37("server-only-key");
  expect(await provider.listDirectories("abcdefghij", "~/")).toEqual({
    path: "/home/node",
    parentPath: null,
    truncated: true,
    directories: [
      { name: "客户", path: "/home/node/客户", hidden: false },
      { name: ".hermes", path: "/home/node/.hermes", hidden: true },
    ],
  });
  expect(fetch.mock.calls[1][0]).toBe(
    "https://abcdefghij.agent37.app/v1/files?path=%2Fhome%2Fnode",
  );
  expect(fetch.mock.calls[1][1].headers["X-Agent37-Key"]).toBe(
    "server-only-key",
  );
  await expect(
    provider.listDirectories("abcdefghij", "/home/node/alias"),
  ).rejects.toMatchObject({ status: 400, code: "invalid_directory" });
  await expect(
    provider.listDirectories("abcdefghij", "/home/node/missing"),
  ).rejects.toMatchObject({ status: 404, code: "directory_not_found" });
  expect(fetch).toHaveBeenCalledTimes(4);
  await expect(
    provider.listDirectories("abcdefghij", "/etc"),
  ).rejects.toMatchObject({ code: "invalid_directory" });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("requires Agent37 to confirm deletion of the requested instance", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: "abcdefghij", deleted: true }))
    .mockResolvedValueOnce(Response.json({ id: "abcdefghij", deleted: false }))
    .mockResolvedValueOnce(Response.json({ id: "other12345", deleted: true }))
    .mockResolvedValueOnce(
      Response.json({ error: "not_found" }, { status: 404 }),
    );
  vi.stubGlobal("fetch", fetch);
  const provider = new Agent37("admin");
  await provider.removeInstance("abcdefghij");
  await expect(provider.removeInstance("abcdefghij")).rejects.toMatchObject({
    code: "instance_deletion_unconfirmed",
  });
  await expect(provider.removeInstance("abcdefghij")).rejects.toMatchObject({
    code: "instance_deletion_unconfirmed",
  });
  await expect(provider.removeInstance("abcdefghij")).rejects.toMatchObject({
    status: 404,
  });
});
it("requires Inkbox's completed cascade and preserves carrier-release failures for retries", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      Response.json({ error: "carrier_release_failed" }, { status: 502 }),
    )
    .mockResolvedValueOnce(Response.json({ queued: true }));
  vi.stubGlobal("fetch", fetch);
  const provider = new Inkbox("admin");
  await provider.removeIdentity("own-identity");
  await expect(provider.removeIdentity("own-identity")).rejects.toMatchObject({
    status: 502,
  });
  await expect(provider.removeIdentity("own-identity")).rejects.toMatchObject({
    code: "identity_deletion_unconfirmed",
  });
  expect(
    fetch.mock.calls.every(
      ([url, init]) =>
        url.endsWith("/identities/own-identity") && init.method === "DELETE",
    ),
  ).toBe(true);
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
        port: 6901,
        expires_at: Math.floor(Date.now() / 1000) + 60,
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
it("reads and validates the hosting budget without exposing provider credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        monthly_cap_micros: 5_000_000,
        monthly_consumed_micros: 1_250_000,
        monthly_remaining_micros: 3_750_000,
        monthly_period: "2026-10",
        credit_remaining_micros: 250_000,
        updated_at: 123,
        private_key: "do-not-return",
      }),
    )
    .mockResolvedValueOnce(Response.json({ monthly_cap_micros: -1 }));
  vi.stubGlobal("fetch", fetch);
  const provider = new Agent37("hosting-secret");
  expect(await provider.getBudget("abcdefghij")).toEqual({
    monthlyCapMicros: 5_000_000,
    monthlyConsumedMicros: 1_250_000,
    monthlyRemainingMicros: 3_750_000,
    monthlyPeriod: "2026-10",
    creditRemainingMicros: 250_000,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.agent37.com/v1/instances/abcdefghij/budget",
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer hosting-secret",
  );
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
  await expect(provider.getBudget("abcdefghij")).rejects.toMatchObject({
    status: 502,
    code: "invalid_budget",
  });
});
it("uses the hosting contracts for metrics, signed services and public creation/removal", async () => {
  const points = [[Math.floor(Date.now() / 1000), 0.5]];
  const metrics = {
    series: { cpu_cores: points, memory_bytes: points, disk_bytes: points },
    limits: { cpu_cores: 2, memory_bytes: 4e9, disk_bytes: 20e9 },
    hours: 24,
    step_seconds: 60,
    fetched_at: Math.floor(Date.now() / 1000),
  };
  const entry = {
    port: 8788,
    url: "https://01234567890123456789.agent37.app",
    label: "Preview",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(metrics))
    .mockResolvedValueOnce(
      Response.json({
        port: 8788,
        url: "https://abcdefghij-8788.agent37.app/?a37_token=preview-token",
        expires_at: Math.floor(Date.now() / 1000) + 604800,
      }),
    )
    .mockResolvedValueOnce(Response.json(entry))
    .mockResolvedValueOnce(Response.json({ data: [entry] }))
    .mockResolvedValueOnce(Response.json({ port: 8788, deleted: true }));
  vi.stubGlobal("fetch", fetch);
  const provider = new Agent37("hosting-secret");
  expect(await provider.metrics("abcdefghij")).toEqual(metrics);
  expect((await provider.signedUrl("abcdefghij", 8788, 604800)).port).toBe(
    8788,
  );
  await provider.createPublicPort("abcdefghij", 8788, "Preview");
  await provider.publicPorts("abcdefghij");
  await provider.removePublicPort("abcdefghij", 8788);
  expect(
    fetch.mock.calls.map(
      ([url]) => new URL(url).pathname + new URL(url).search,
    ),
  ).toEqual([
    "/v1/instances/abcdefghij/metrics?hours=24",
    "/v1/instances/abcdefghij/signed-url",
    "/v1/instances/abcdefghij/public-ports",
    "/v1/instances/abcdefghij/public-ports",
    "/v1/instances/abcdefghij/public-ports/8788",
  ]);
  expect(
    fetch.mock.calls.every(
      ([, init]) => init.headers.Authorization === "Bearer hosting-secret",
    ),
  ).toBe(true);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    port: 8788,
    ttl_seconds: 604800,
  });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    port: 8788,
    label: "Preview",
  });
});
it.each([
  "http://abcdefghij-8788.agent37.app/?a37_token=x",
  "https://abcdefghij-8788.agent37.app.evil.test/?a37_token=x",
  "https://other12345-8788.agent37.app/?a37_token=x",
  "https://user:password@abcdefghij-8788.agent37.app/?a37_token=x",
  "https://abcdefghij-8788.agent37.app/",
])("rejects an unsafe or foreign signed service address %s", async (url) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        url,
        port: 8788,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    ),
  );
  await expect(
    new Agent37("secret").signedUrl("abcdefghij", 8788, 3600),
  ).rejects.toThrow();
});
it("does not treat unconfirmed public removal or malformed metrics as successful", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ port: 8790, deleted: true }))
      .mockResolvedValueOnce(
        Response.json({ series: { cpu_cores: [[1, -1]] }, limits: {} }),
      ),
  );
  const provider = new Agent37("secret");
  await expect(
    provider.removePublicPort("abcdefghij", 8788),
  ).rejects.toMatchObject({ code: "public_removal_unconfirmed" });
  await expect(provider.metrics("abcdefghij")).rejects.toThrow();
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
