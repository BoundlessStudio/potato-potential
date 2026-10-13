"use client";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from "react";
import {
  ArrowUpRight,
  Eye,
  Loader2,
  MousePointer2,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import { api, demo } from "@/lib/client";
import { Companion } from "./companion";
import type { Profile } from "@boundless/shared";
import { ChatBackupButton } from "./computer-backups";
import { useComputerSession } from "./computer-session";

export type ComputerHandle = { refresh: () => void };
export function Computer({
  profile,
  onClose,
  onReturn,
  onError,
  autoConnect = true,
  available = true,
  availabilityKnown = true,
  screenSize,
  ref,
}: {
  profile: Profile;
  onClose?: () => void;
  onReturn: () => void;
  onError: (message: string) => void;
  autoConnect?: boolean;
  available?: boolean;
  availabilityKnown?: boolean;
  screenSize?: { width: number; height: number };
  ref?: Ref<ComputerHandle>;
}) {
  const target = useRef<HTMLDivElement>(null);
  const session = useComputerSession();
  const {
    requested,
    state,
    screen: connectedScreen,
  } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [control, setControl] = useState(false);
  const controlRef = useRef(false);
  const controlRequest = useRef(0);
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;
  const availableRef = useRef(available && requested);
  availableRef.current = available && requested;
  function releaseControl() {
    ++controlRequest.current;
    if (!controlRef.current) return;
    session.setViewOnly();
    controlRef.current = false;
    if (mounted.current) setControl(false);
    onReturnRef.current();
  }
  const [changingControl, setChangingControl] = useState(false);
  const changing = useRef(false);
  const mounted = useRef(false);
  const screen = screenSize || connectedScreen;
  useImperativeHandle(
    ref,
    () => ({
      refresh() {
        releaseControl();
        session.refresh();
      },
    }),
    [session],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const detach = target.current ? session.attach(target.current) : undefined;
    const visibility = () => {
      if (document.hidden) releaseControl();
    };
    const unsubscribe = session.subscribe(() => {
      if (session.getSnapshot().state !== "Connected" && !demo)
        releaseControl();
    });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe();
      releaseControl();
      detach?.();
    };
  }, [session]);
  useEffect(() => {
    if (availabilityKnown) session.setAvailable(available);
    if (autoConnect && available) session.start();
    if (!available) releaseControl();
  }, [session, autoConnect, available, availabilityKnown]);
  async function toggle() {
    if (changing.current) return;
    changing.current = true;
    setChangingControl(true);
    const connection = session.connection;
    const request = ++controlRequest.current;
    try {
      if (!control) {
        await api("/computer/takeover", "POST");
        if (
          !mounted.current ||
          request !== controlRequest.current ||
          !availableRef.current ||
          document.hidden ||
          (!demo &&
            (!connection ||
              session.connection !== connection ||
              session.getSnapshot().state !== "Connected"))
        )
          return;
        if (connection) connection.viewOnly = false;
        controlRef.current = true;
        setControl(true);
      } else {
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
        <div
          className="computer-heading-actions"
          role="group"
          aria-label="Computer controls"
        >
          {onClose && (
            <ChatBackupButton available={available} onError={onError} />
          )}
          <button
            type="button"
            className="icon-button computer-action"
            aria-label={requested ? "Reconnect computer" : "Connect to desktop"}
            title={requested ? "Reconnect computer" : "Connect to desktop"}
            disabled={!available}
            onClick={() => {
              releaseControl();
              session.refresh();
            }}
          >
            {requested ? <RefreshCw size={16} /> : <PlugZap size={16} />}
          </button>
          <button
            type="button"
            className="icon-button computer-action"
            aria-label={
              changingControl
                ? "Waiting for companion…"
                : control
                  ? "Return control"
                  : "Take over"
            }
            title={
              changingControl
                ? "Waiting for companion…"
                : control
                  ? "Return control"
                  : "Take over"
            }
            aria-pressed={control}
            onClick={toggle}
            disabled={
              changingControl ||
              !requested ||
              !available ||
              (!demo && state !== "Connected")
            }
          >
            {changingControl ? (
              <Loader2 size={16} className="spin" />
            ) : control ? (
              <Eye size={16} />
            ) : (
              <MousePointer2 size={16} />
            )}
          </button>
          {onClose && (
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close computer"
              title="Close computer"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div
        className="computer-browser"
        data-screen-orientation={
          screen.height > screen.width ? "portrait" : "landscape"
        }
        style={
          {
            "--computer-screen-ratio": screen.width / screen.height,
          } as CSSProperties
        }
      >
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
            <small>
              {!requested
                ? "Connect above to open their desktop."
                : "Connect Agent37 to see the real desktop."}
            </small>
            {control && (
              <span className="control-cursor">
                <MousePointer2 size={22} /> You have control
              </span>
            )}
          </div>
        ) : (
          <div className="computer-screen-wrap">
            <div
              ref={target}
              className="vnc-screen"
              style={{ aspectRatio: `${screen.width} / ${screen.height}` }}
            />
            {(!requested || !available || state !== "Connected") && (
              <div className="computer-placeholder" role="status">
                <Companion
                  avatar={profile.avatar}
                  color={profile.color}
                  size={180}
                  scene
                />
                <p>
                  {!available
                    ? "A little pause at their desk."
                    : !requested
                      ? "A little space to make things happen."
                      : state === "Connecting"
                        ? "Opening a window into their world…"
                        : "Their desk is a refresh away."}
                </p>
                <small>
                  {!available
                    ? "The desktop will be ready when the computer is available."
                    : requested
                      ? "Reconnect above to take another peek."
                      : "Connect above to take a peek."}
                </small>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="computer-status">
        <span className="status-dot" />
        {!available
          ? "Computer unavailable"
          : !requested
            ? "Connect when you’re ready"
            : state}
      </div>
      <p className="fine-print">
        {control
          ? "Use the mouse and keyboard. Return control when you’re ready for your agent to continue."
          : "Watch them work, or lend a hand with a sign-in. Taking over stops the current chat turn."}
      </p>
    </div>
  );
}
