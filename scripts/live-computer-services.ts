import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Agent37 } from "../services/control-plane/src/providers";
import { shellQuote } from "../services/control-plane/src/security";

// Isolated provider user, one temporary computer, zero managed-model budget, no messages.
if (!process.env.AGENT37_API_KEY)
  throw new Error("AGENT37_API_KEY is required.");
const provider = new Agent37(process.env.AGENT37_API_KEY);
const user = `computer-services-test-${randomUUID()}`;
let instanceId: string | undefined;
await mkdir(".cache", { recursive: true });
const receipt = (phase: string) =>
  writeFile(
    ".cache/live-computer-services.json",
    JSON.stringify({ user, instanceId, phase }),
  );
await receipt("creating");
try {
  const instance = await provider.createInstance({
    template: process.env.DESKTOP_TEMPLATE || "boundless-hermes-desktop@4",
    user,
    name: "Temporary service publication validation",
    budget: { monthly_cap_micros: 0 },
    auto_sleep: true,
    idle_timeout_seconds: 600,
  });
  instanceId = instance.id;
  await receipt("checking");
  const code =
    "require('node:http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('computer-service-fixture')}).listen(8788,'0.0.0.0')";
  const started = await provider.exec(
    instanceId!,
    `nohup node -e ${shellQuote(code)} > /tmp/computer-service-fixture.log 2>&1 < /dev/null &`,
  );
  if (started.exit_code) throw new Error("Fixture failed to start.");
  let running = false;
  for (let i = 0; i < 15; i++) {
    running = await provider.checkService(instanceId!, 8788);
    if (running) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!running) throw new Error("HTTP service probe failed.");
  const signed = await provider.signedUrl(instanceId!, 8788, 900);
  const signedResponse = await fetch(signed.url, {
    redirect: "manual",
    signal: AbortSignal.timeout(200000),
  });
  if (
    !signedResponse.ok ||
    (await signedResponse.text()) !== "computer-service-fixture"
  )
    throw new Error("Signed browser URL failed.");
  const publicLink = await provider.createPublicPort(
    instanceId!,
    8788,
    "Temporary fixture",
  );
  if (
    !(await provider.publicPorts(instanceId!)).some((row) => row.port === 8788)
  )
    throw new Error("Public route missing.");
  const publicResponse = await fetch(publicLink.url, {
    signal: AbortSignal.timeout(200000),
  });
  if (
    !publicResponse.ok ||
    (await publicResponse.text()) !== "computer-service-fixture"
  )
    throw new Error("Public browser URL failed.");
  const metrics = await provider.metrics(instanceId!);
  if (metrics.hours !== 24) throw new Error("Metrics contract failed.");
  await provider.removePublicPort(instanceId!, 8788);
  if (
    (await provider.publicPorts(instanceId!)).some((row) => row.port === 8788)
  )
    throw new Error("Public removal failed.");
  let revoked = false;
  for (let i = 0; i < 15; i++) {
    const response = await fetch(publicLink.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    await response.body?.cancel();
    if (!response.ok) {
      revoked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!revoked) throw new Error("Public edge access remained enabled.");
  const independent = await fetch(signed.url, {
    signal: AbortSignal.timeout(200000),
  });
  if (
    !independent.ok ||
    (await independent.text()) !== "computer-service-fixture"
  )
    throw new Error("Public removal affected signed access.");
  await receipt("passed");
  console.log(
    "PASS: HTTP probe, signed browser access, public creation/removal, independent signed access, and metrics.",
  );
} finally {
  if (instanceId) {
    await provider.removeInstance(instanceId);
    await receipt("deleted");
    console.log("Temporary computer deleted.");
  }
}
