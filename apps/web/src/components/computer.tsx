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
  autoConnect = true,
  available = true,
}: {
  profile: Profile;
  onClose?: () => void;
  onReturn: () => void;
  onError: (message: string) => void;
  autoConnect?: boolean;
  available?: boolean;
}) {
  const target = useRef<HTMLDivElement>(null);
  const rfb = useRef<any>(null);
  const [control, setControl] = useState(false);
  const controlRef = useRef(false);
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;
  const [requested, setRequested] = useState(autoConnect);
  const availableRef = useRef(available && requested);
  availableRef.current = available && requested;
  function releaseControl() {
    if (!controlRef.current) return;
    controlRef.current = false;
    if (mounted.current) setControl(false);
    onReturnRef.current();
  }
  const [changingControl, setChangingControl] = useState(false);
  const changing = useRef(false);
  const mounted = useRef(false);
  const [state, setState] = useState("Connecting");
  const [retry, setRetry] = useState(0);
  const [screen, setScreen] = useState({ width: 540, height: 1140 });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!requested || !available) return;
    if (demo) {
      setState("Preview computer");
      const visibility = () => {
        if (document.hidden) releaseControl();
      };
      document.addEventListener("visibilitychange", visibility);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        releaseControl();
      };
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
            releaseControl();
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
        releaseControl();
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
      releaseControl();
    };
  }, [retry, onError, requested, available]);
  async function toggle() {
    if (changing.current) return;
    changing.current = true;
    setChangingControl(true);
    const connection = rfb.current;
    try {
      if (!control) {
        await api("/computer/takeover", "POST");
        if (
          !mounted.current ||
          !availableRef.current ||
          document.hidden ||
          (!demo && (!connection || rfb.current !== connection))
        )
          return;
        if (connection) connection.viewOnly = false;
        controlRef.current = true;
        setControl(true);
      } else {
        if (rfb.current) rfb.current.viewOnly = true;
        releaseControl();
      }
    } catch (error) {
      if (mounted.current)
        onError(
          error instanceof Error ? error.message : "Could not change control.",
        );
    } finally {
      changing.current = false;
      if (mounted.current) setChangingControl(false);
    }
  }
  return (
    <div className="computer-panel">
      <div className="computer-heading">
        <div>
          <span className="eyebrow">A window into their world</span>
          <h3>{profile.agentName}’s computer</h3>
        </div>
        {onClose && (
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close computer"
          >
            <X size={18} />
          </button>
        )}
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
        {!available
          ? "Computer unavailable"
          : !requested
            ? "Connect when you’re ready"
            : state}
        <button
          className={requested ? "icon-button" : "text-button"}
          aria-label={requested ? "Reconnect computer" : "Connect to desktop"}
          disabled={!available}
          onClick={() => {
            setRequested(true);
            setRetry((value) => value + 1);
          }}
        >
          <RefreshCw size={14} />
          {!requested && "Connect to desktop"}
        </button>
      </div>
      <button
        className={`button ${control ? "button-primary" : "button-secondary"} computer-control`}
        onClick={toggle}
        disabled={
          changingControl || !requested || !available || (!demo && !rfb.current)
        }
      >
        {control ? <Eye size={16} /> : <MousePointer2 size={16} />}{" "}
        {changingControl
          ? "Waiting for companion…"
          : control
            ? "Return control"
            : "Take over"}
      </button>
      <p className="fine-print">
        {control
          ? "Use the mouse and keyboard. Return control when you’re ready for your agent to continue."
          : "Watch them work, or lend a hand with a sign-in. Taking over stops the current chat turn."}
      </p>
    </div>
  );
}
