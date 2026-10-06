"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Eye, MousePointer2, RefreshCw, X } from "lucide-react";
import { api, demo } from "@/lib/client";
import { Companion } from "./companion";
import type { Profile } from "@boundless/shared";

export function Computer({
  profile,
  onClose,
  onReturn,
  onError,
}: {
  profile: Profile;
  onClose: () => void;
  onReturn: () => void;
  onError: (message: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const rfb = useRef<any>(null);
  const [control, setControl] = useState(false);
  const [state, setState] = useState("Connecting");
  const [retry, setRetry] = useState(0);
  const [screen, setScreen] = useState({ width: 540, height: 1140 });
  useEffect(() => {
    if (demo) {
      setState("Preview computer");
      return;
    }
    let disposed = false;
    let connecting = false;
    async function connect() {
      if (
        disposed ||
        document.hidden ||
        connecting ||
        rfb.current ||
        !target.current
      )
        return;
      connecting = true;
      setState("Connecting");
      try {
        const [{ ws, screen: remoteScreen }, module] = await Promise.all([
          api("/computer", "POST"),
          import("@novnc/novnc"),
        ]);
        if (disposed || document.hidden || !target.current) return;
        if (remoteScreen) setScreen(remoteScreen);
        const instance = new module.default(target.current, ws);
        rfb.current = instance;
        instance.viewOnly = true;
        instance.scaleViewport = true;
        instance.resizeSession = false;
        instance.addEventListener("connect", () => setState("Connected"));
        instance.addEventListener("disconnect", () => {
          if (rfb.current === instance) {
            rfb.current = null;
            setControl(false);
          }
          if (!disposed && !document.hidden && !rfb.current)
            setState("Disconnected — reconnect when you’re ready");
        });
        instance.addEventListener("securityfailure", () =>
          onError(
            "The desktop connection could not be authenticated. Reconnect for a fresh token.",
          ),
        );
      } catch (error) {
        if (!disposed) {
          setState("Connection interrupted");
          onError(
            error instanceof Error
              ? error.message
              : "Desktop connection failed.",
          );
        }
      } finally {
        connecting = false;
      }
    }
    function visibility() {
      if (document.hidden) {
        rfb.current?.disconnect();
        rfb.current = null;
        setControl(false);
        setState("Paused while this tab is hidden");
      } else void connect();
    }
    document.addEventListener("visibilitychange", visibility);
    void connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      rfb.current?.disconnect();
      rfb.current = null;
    };
  }, [retry, onError]);
  async function toggle() {
    try {
      if (!control) {
        await api("/computer/takeover", "POST");
        if (rfb.current) rfb.current.viewOnly = false;
        setControl(true);
      } else {
        if (rfb.current) rfb.current.viewOnly = true;
        setControl(false);
        onReturn();
      }
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Could not change control.",
      );
    }
  }
  return (
    <div className="computer-panel">
      <div className="computer-heading">
        <div>
          <span className="eyebrow">A window into their world</span>
          <h3>{profile.agentName}’s computer</h3>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close computer"
        >
          <X size={18} />
        </button>
      </div>
      <div className="computer-browser">
        <div className="browser-chrome">
          <span />
          <span />
          <span />
          <div>your agent’s space</div>
          <ArrowUpRight size={13} />
        </div>
        {demo ? (
          <div className="preview-desktop">
            <span className="preview-screen-label">Local computer preview</span>
            <Companion
              avatar={profile.avatar}
              color={profile.color}
              size={200}
              scene
            />
            <p>A little space to do big things.</p>
            <small>Connect Agent37 to see the real desktop.</small>
            {control && (
              <span className="control-cursor">
                <MousePointer2 size={22} /> You have control
              </span>
            )}
          </div>
        ) : (
          <div
            ref={target}
            className="vnc-screen"
            style={{ aspectRatio: `${screen.width} / ${screen.height}` }}
          />
        )}
      </div>
      <div className="computer-status">
        <span className="status-dot" />
        {state}
        <button
          className="icon-button"
          aria-label="Reconnect computer"
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <button
        className={`button ${control ? "button-primary" : "button-secondary"} computer-control`}
        onClick={toggle}
        disabled={!demo && !rfb.current}
      >
        {control ? <Eye size={16} /> : <MousePointer2 size={16} />}{" "}
        {control ? "Return control" : "Take over"}
      </button>
      <p className="fine-print">
        {control
          ? "Use the mouse and keyboard. Return control when you’re ready for your agent to continue."
          : "Watch them work, or lend a hand with a sign-in. Taking over stops the current chat turn."}
      </p>
    </div>
  );
}
