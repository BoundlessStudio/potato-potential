import type { NextApiRequest, NextApiResponse } from "next";
import { createApp } from "@boundless/control-plane/app";
import { liveDependencies } from "@boundless/control-plane/runtime";
import { productionQueue } from "@/server/queue";

export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
  maxDuration: 300,
};
let app: ReturnType<typeof createApp> | undefined;
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  app ||= createApp(liveDependencies(productionQueue()));
  await new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    app!(
      req as unknown as Parameters<NonNullable<typeof app>>[0],
      res as unknown as Parameters<NonNullable<typeof app>>[1],
      reject,
    );
  });
}
