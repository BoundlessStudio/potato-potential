"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/client";
import { Brand } from "@/components/companion";
export default function Connected() {
  const [state, setState] = useState("Checking your connection…");
  useEffect(() => {
    let stopped = false;
    let count = 0;
    const toolkit = new URL(window.location.href).searchParams.get("toolkit");
    async function check() {
      try {
        const data = await api("/apps/connections");
        if (
          toolkit &&
          data.connections.some(
            (row: any) =>
              row.toolkitSlug === toolkit && row.status === "ACTIVE",
          )
        ) {
          if (!stopped) {
            setState("Your connected apps are ready.");
            window.opener?.postMessage(
              { type: "boundless-connected" },
              window.location.origin,
            );
          }
        } else if (++count < 12) {
          if (!stopped) setTimeout(check, 1500);
        } else if (!stopped)
          setState(
            "The connection is still pending. Return to Apps to check its status.",
          );
      } catch {
        if (!stopped) setState("Return to Apps to check your connection.");
      }
    }
    void check();
    return () => {
      stopped = true;
    };
  }, []);
  return (
    <main className="standalone">
      <Brand />
      <div className="connection-result">
        {state.includes("ready") ? (
          <CheckCircle2 size={42} />
        ) : (
          <Loader2 size={42} />
        )}
        <h1>{state}</h1>
        <p>You can return to your companion whenever you’re ready.</p>
        <a className="button button-primary" href="/">
          Back to Boundless
        </a>
      </div>
    </main>
  );
}
