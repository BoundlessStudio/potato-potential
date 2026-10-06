import { loadConfig } from "./config";
import { Agent37, Inkbox } from "./providers";
import { SupabaseRepository } from "./repository";
import { Lifecycle } from "./lifecycle";
import type { Dependencies, Queue } from "./app";

// Called within workflow steps and API requests, never at build time.
export function liveDependencies(queue: Queue): Dependencies {
  const config = loadConfig();
  if (config.demo)
    throw new Error("Live functions cannot use preview authentication.");
  const repo = new SupabaseRepository(config.supabaseUrl, config.supabaseKey);
  const a37 = new Agent37(config.agent37Key);
  const inkbox = new Inkbox(config.inkboxKey);
  return {
    config,
    repo,
    a37,
    inkbox,
    queue,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
  };
}
