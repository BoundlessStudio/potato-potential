"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import type { Profile, PublicAgent } from "@boundless/shared";
import { api, demo } from "@/lib/client";

export function PhoneConnection({
  profile,
  agent,
  onChange,
}: {
  profile: Profile | null;
  agent: PublicAgent;
  onChange: (agent: PublicAgent) => void;
}) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false,
      checking = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      if (cancelled || checking) return;
      clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        timer = setTimeout(check, 4000);
        return;
      }
      checking = true;
      try {
        const result = await api("/onboarding/phone-connection", "POST");
        if (cancelled) return;
        if (!result.agent || result.agent.ownerId !== agent.ownerId)
          throw new Error("Connection status unavailable.");
        setUnavailable(false);
        onChange(result.agent);
        if (result.agent.status !== "awaiting_phone") return;
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        checking = false;
      }
      if (!cancelled) timer = setTimeout(check, 4000);
    }
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [agent.ownerId, onChange]);

  const status = unavailable ? "unavailable" : agent.phoneLink?.status;
  const connected = status === "waiting_message";
  const name = profile?.agentName || "your agent";
  return (
    <div className="phone-verification">
      <h3>Say hello in Messages.</h3>
      <div className="phone-connection-status" role="status" aria-live="polite">
        <Loader2 className="spin" size={16} aria-hidden="true" />
        {status === "unavailable"
          ? "Connection check interrupted. We’ll retry automatically."
          : connected
            ? "Connected; send Hi"
            : "Waiting for connection"}
      </div>
      <p>
        <strong>1. Connect your phone.</strong> Send the prefilled message to
        connect with {name}.
      </p>
      {agent.connect?.qr && (
        <img
          alt="Scan to connect your phone"
          src={agent.connect.qr}
          width={156}
          height={156}
        />
      )}
      <a className="button button-secondary" href={agent.connect?.smsLink}>
        Connect in Messages <ArrowRight size={15} />
      </a>
      <p>
        Or send <code>{agent.connect?.command}</code> to {agent.connect?.number}
        .
      </p>
      <p>
        <strong>2. Send Hi to {name}.</strong> Open the new agent contact Inkbox
        sends back and send <strong>Hi</strong> in that conversation.
      </p>
      <p>
        Keep this page open. We’ll confirm your phone and finish setup
        automatically.
      </p>
      {agent.sms && (
        <p>
          Prefer SMS? From {profile?.phone}, text <strong>START</strong>, then{" "}
          <strong>Hi</strong>, to{" "}
          <a href={`sms:${agent.sms.number}`}>{agent.sms.number}</a>. SMS
          readiness: {agent.sms.status}.
        </p>
      )}
      {demo && (
        <p className="fine-print">
          Preview: phone confirmation is simulated. No message is sent.
        </p>
      )}
      <details className="phone-connection-help">
        <summary>Not connecting?</summary>
        <p>
          Use the phone number saved on your account:{" "}
          <strong>{profile?.phone}</strong>. In Messages → Send &amp; Receive,
          choose this phone number as the sender. An Apple ID email or a
          different SIM won’t match.
        </p>
        <p>
          Send Hi in the new {name} conversation after connecting. If the saved
          number is wrong, contact support to update it. You can return to this
          page to continue setup.
        </p>
      </details>
    </div>
  );
}
