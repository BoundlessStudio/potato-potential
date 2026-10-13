import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { assistantModelScript } from "../services/control-plane/src/assistant-model-config";

const python = process.platform === "win32" ? "python" : "python3";
const available = spawnSync(python, ["-c", "import yaml"], { timeout: 5000 });

// Python/PyYAML ship in the Hermes image; they are optional on web developers'
// machines. The API recovery tests always run, even without that runtime.
it.skipIf(available.status !== 0)(
  "restores native Hermes routing and removes all model override files and hooks when cleared",
  () => {
    const result = spawnSync(
      python,
      [
        fileURLToPath(
          new URL("./fixtures/assistant-model-config.py", import.meta.url),
        ),
      ],
      {
        input: assistantModelScript,
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Assistant model config QA passed");
  },
);
