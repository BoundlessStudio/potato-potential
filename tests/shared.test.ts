import { describe, expect, it } from "vitest";
import {
  isFiredOneTime,
  mergePersona,
  parseSse,
  personaEnd,
  personaStart,
  phoneSchema,
  publicAgent,
  visibleMessage,
  type Cron,
} from "@boundless/shared";
import {
  hash,
  matchesHash,
  seal,
  shellQuote,
  unseal,
} from "../services/control-plane/src/security";
import { loadConfig } from "../services/control-plane/src/config";

describe("shared contracts", () => {
  it("normalizes formatted international numbers without guessing their country", () => {
    expect(phoneSchema.parse(" +1 (519) 555-0123 ")).toBe("+15195550123");
    expect(phoneSchema.parse("+44 7700 900123")).toBe("+447700900123");
    expect(phoneSchema.parse("+33 6 12 34 56 78")).toBe("+33612345678");
  });
  it.each([
    "5195550123",
    "+1519555",
    "+151955501234",
    "+999123456789",
    "+15195550123 ext. 9",
    "Call +15195550123",
    "",
  ])("rejects ambiguous, incomplete or extended phone input: %s", (value) => {
    expect(phoneSchema.safeParse(value).success).toBe(false);
  });
  it("replaces only application persona content and preserves native instructions", () => {
    const original =
      "A native rule.\n" +
      personaStart +
      "\nOld persona\n" +
      personaEnd +
      "\nA memory note.";
    const result = mergePersona(original, "New persona");
    expect(result).toContain("A native rule.");
    expect(result).toContain("A memory note.");
    expect(result).not.toContain("Old persona");
    expect(mergePersona(result, "New persona")).toBe(result);
    expect(() => mergePersona(personaStart, "new")).toThrow("damaged");
  });
  it("parses byte-split UTF-8, CRLF, comments and multiline SSE JSON", async () => {
    const bytes = new TextEncoder().encode(
      ':keepalive\r\n\r\nevent: response.created\r\ndata: {"id":"one",\r\ndata: "text":"🌱"}\r\n\r\nevent: response.completed\ndata: {"output_text":"done"}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSse(stream)) events.push(event);
    expect(events).toEqual([
      { event: "response.created", data: { id: "one", text: "🌱" } },
      { event: "response.completed", data: { output_text: "done" } },
    ]);
  });
  it("never labels an untriggered or explicitly yearly cron as fired once", () => {
    const cron = {
      schedule: "30 9 6 10 *",
      last_run: null,
      name: "Dentist",
    } as Cron;
    expect(isFiredOneTime(cron)).toBe(false);
    expect(isFiredOneTime({ ...cron, last_run: 1 })).toBe(true);
    expect(
      isFiredOneTime({ ...cron, last_run: 1, name: "Yearly birthday" }),
    ).toBe(false);
    expect(
      isFiredOneTime({ ...cron, last_run: 1, schedule: "30 9 * * 1-5" }),
    ).toBe(false);
  });
  it("withholds runtime credentials and hides app-only context", () => {
    const safe = publicAgent({
      callbackHash: "secret",
      callbackSecretBox: "secret",
      runtimeKeyBox: "secret",
      runtimeKeyId: "secret",
      phoneChallengeBox: "secret",
    } as any);
    expect(JSON.stringify(safe)).not.toContain("secret");
    expect(
      visibleMessage(
        "App context (from Boundless): hi\nEnd of app context.\n\nMy message",
      ),
    ).toBe("My message");
    expect(visibleMessage("App context (from Boundless): hidden")).toBeNull();
  });
  it("encrypts resumable credentials with authenticated encryption", () => {
    const key = "ab".repeat(32);
    const box = seal("sensitive", key);
    expect(box).not.toContain("sensitive");
    expect(unseal(box, key)).toBe("sensitive");
    expect(() => unseal(box, "cd".repeat(32))).toThrow();
    expect(matchesHash("token", hash("token"))).toBe(true);
    expect(matchesHash("wrong", hash("token"))).toBe(false);
    expect(shellQuote("a'b$(touch /tmp/no)")).toBe("'a'\\''b$(touch /tmp/no)'");
  });
  it("forbids preview authentication in production and unpinned live images", () => {
    expect(() =>
      loadConfig({ DEMO_MODE: "true", NODE_ENV: "production" }),
    ).toThrow("local-only");
    expect(loadConfig({ DEMO_MODE: "true" }).budget).toBe(5_000_000);
  });
});
