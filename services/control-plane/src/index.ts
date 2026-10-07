import "dotenv/config";
import { loadConfig } from "./config";
import { MemoryRepository } from "./repository";
import { DemoAgent37, DemoInkbox, seedDemo } from "./demo";
import { Lifecycle } from "./lifecycle";
import { createApp, reconcile, type Dependencies, type Queue } from "./app";
import { maintainComputer } from "./computer-maintenance";

// The separate listener exists only for local preview. Live APIs and durable jobs run in Next.js.
const config = loadConfig();
if (!config.demo)
  throw new Error(
    "For live development run npm run dev -w @boundless/web. Production runs on Vercel.",
  );
const repo = new MemoryRepository();
const a37 = new DemoAgent37();
const inkbox = new DemoInkbox();
await seedDemo(repo, a37, inkbox);
const lifecycle = new Lifecycle(config, repo, a37, inkbox);
const queue: Queue = {
  async send(kind, ownerId) {
    setTimeout(() => {
      const job =
        kind === "provision"
          ? lifecycle.provision(ownerId)
          : kind === "cleanup"
            ? lifecycle.cleanup(ownerId)
            : kind === "maintenance"
              ? maintainComputer(dep, ownerId)
              : reconcile(dep, ownerId);
      if (kind === "maintenance" || kind === "reconcile")
        void job
          .then((more) => {
            if (more) setTimeout(() => void queue.send(kind, ownerId), 100);
          })
          .catch(() => {});
      void job.catch(() => console.error("Preview job interrupted."));
    }, 0);
  },
};
const dep: Dependencies = { config, repo, a37, inkbox, lifecycle, queue };
const server = createApp(dep).listen(config.port, "127.0.0.1", () =>
  console.log("Local preview API listening on " + config.port + "."),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
