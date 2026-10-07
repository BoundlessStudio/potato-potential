import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { SupabaseRepository } from "../services/control-plane/src/repository";

let server: Server, repo: SupabaseRepository, owner: string, authStatus: number;
let authExists: boolean;
let customer: { id: string; email: string } | null;
let agent: {
  ownerId: string;
  deletion: { instance: boolean; identity: boolean };
} | null;
let requests: string[];

beforeEach(async () => {
  owner = randomUUID();
  authStatus = 200;
  authExists = true;
  customer = { id: owner, email: "closing@example.com" };
  agent = { ownerId: owner, deletion: { instance: true, identity: true } };
  requests = [];
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    res.setHeader("Content-Type", "application/json");
    if (
      req.method === "DELETE" &&
      url.pathname === `/auth/v1/admin/users/${owner}`
    ) {
      res.statusCode = authStatus;
      if (authStatus === 200) {
        authExists = false;
        res.end(JSON.stringify({ id: owner, email: "closing@example.com" }));
      } else {
        res.end(
          JSON.stringify({
            message: "Auth deletion failed",
            code: "auth_failure",
          }),
        );
      }
    } else if (
      req.method === "DELETE" &&
      url.pathname === "/rest/v1/customers" &&
      url.searchParams.get("id") === `eq.${owner}`
    ) {
      customer = null;
      agent = null;
      res.statusCode = 204;
      res.end();
    } else {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: "Unexpected fixture request" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  repo = new SupabaseRepository(`http://127.0.0.1:${port}`, "test-service-key");
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it.each([401, 403, 500, 503])(
  "retains customer and ownership records when Supabase Auth deletion returns %s",
  async (status) => {
    authStatus = status;
    const originalCustomer = structuredClone(customer);
    const originalAgent = structuredClone(agent);
    await expect(repo.removeCustomer(owner)).rejects.toMatchObject({
      status: 500,
      code: "auth_cleanup_failed",
    });
    expect(authExists).toBe(true);
    expect(customer).toEqual(originalCustomer);
    expect(agent).toEqual(originalAgent);
    expect(requests).toEqual([`DELETE /auth/v1/admin/users/${owner}`]);
  },
);

it("retries Auth erasure successfully without deleting ownership records on the failed attempt", async () => {
  authStatus = 500;
  await expect(repo.removeCustomer(owner)).rejects.toMatchObject({
    code: "auth_cleanup_failed",
  });
  expect(customer?.id).toBe(owner);
  expect(agent?.ownerId).toBe(owner);
  authStatus = 200;
  await repo.removeCustomer(owner);
  expect(authExists).toBe(false);
  expect(customer).toBeNull();
  expect(agent).toBeNull();
  expect(requests).toEqual([
    `DELETE /auth/v1/admin/users/${owner}`,
    `DELETE /auth/v1/admin/users/${owner}`,
    `DELETE /rest/v1/customers?id=eq.${owner}`,
  ]);
});

it("allows an idempotent retry after Auth and its cascaded customer are already gone", async () => {
  authStatus = 404;
  authExists = false;
  customer = null;
  agent = null;
  await repo.removeCustomer(owner);
  expect(requests).toEqual([
    `DELETE /auth/v1/admin/users/${owner}`,
    `DELETE /rest/v1/customers?id=eq.${owner}`,
  ]);
});
