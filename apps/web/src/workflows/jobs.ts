import { sleep } from "workflow";
import { runSlice, exhaustJob } from "./steps";

export async function applicationJob(id: string, worker: string) {
  "use workflow";
  for (let slice = 0; slice < 128; slice++) {
    const state = await runSlice(id, worker);
    if (state === "complete") return;
    if (state === "busy") await sleep("1m");
    if (state === "retry") await sleep("45s");
    if (state === "continue") await sleep("5s");
  }
  await exhaustJob(id, worker);
}
