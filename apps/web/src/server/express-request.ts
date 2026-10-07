import type { IncomingMessage } from "node:http";

export function prepareExpressRequest(req: IncomingMessage) {
  // Keep Next's catch-all route parameters out of Express's query object.
  // The catch-all itself is named `route` to preserve the Files API's `path`.
  delete (req as IncomingMessage & { query?: unknown }).query;
}
