"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Copy,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
} from "lucide-react";
import {
  visibleMessage,
  type Conversation,
  type Message,
  type PublicAgent,
} from "@boundless/shared";
import { api } from "@/lib/client";
import { Markdown } from "./views";
import { Modal } from "./modal";

type ChannelStatus = {
  email: string;
  imessage: string;
  voice: string;
  sms: { number: string; status: string } | null;
};
type Call = {
  id: string;
  status?: string;
  started_at?: string;
  created_at?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  transcript?: string;
};
type Tab = "contact" | "messages" | "calls";
type Detail =
  { kind: "message"; session: Conversation } | { kind: "call"; call: Call };
const tabs: { id: Tab; label: string; icon: typeof Mail }[] = [
  { id: "contact", label: "Contact", icon: Mail },
  { id: "messages", label: "Messages", icon: MessageCircle },
  { id: "calls", label: "Calls", icon: Phone },
];
const channelName = (channel: string) =>
  channel === "imessage" ? "iMessage" : channel === "sms" ? "SMS" : "Email";
const dateLabel = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Date unavailable";
const callDate = (call: Call) => call.started_at || call.created_at;

export function ChannelsDialog({
  agent,
  agentName,
  onClose,
  onError,
  onSuccess,
}: {
  agent: PublicAgent;
  agentName: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("contact");
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [messages, setMessages] = useState<Conversation[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState<Record<Tab, boolean>>({
    contact: true,
    messages: true,
    calls: true,
  });
  const [errors, setErrors] = useState<Partial<Record<Tab, string>>>({});
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [history, setHistory] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const historyFocus = useRef("");
  const historyButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let cancelled = false;
    setLoading({ contact: true, messages: true, calls: true });
    setErrors({});
    const requests: { tab: Tab; path: string; save: (result: any) => void }[] =
      [
        { tab: "contact", path: "/channels", save: setStatus },
        {
          tab: "messages",
          path: "/sessions",
          save: (result: { sessions: Conversation[] }) =>
            setMessages(
              result.sessions
                .filter((session) =>
                  ["email", "imessage", "sms"].includes(session.channel),
                )
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            ),
        },
        {
          tab: "calls",
          path: "/calls",
          save: (result: { calls: Call[] }) =>
            setCalls(
              [...result.calls].sort((a, b) =>
                (callDate(b) || "").localeCompare(callDate(a) || ""),
              ),
            ),
        },
      ];
    void Promise.allSettled(
      requests.map(async (request) => {
        try {
          const result = await api(request.path);
          if (!cancelled) request.save(result);
        } catch {
          if (!cancelled)
            setErrors((current) => ({
              ...current,
              [request.tab]: `Your ${request.tab === "contact" ? "connection status" : request.tab === "messages" ? "message history" : "call history"} couldn’t be loaded.`,
            }));
        } finally {
          if (!cancelled)
            setLoading((current) => ({ ...current, [request.tab]: false }));
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!detail) return;
    const selection = detail;
    let cancelled = false;
    setHistory([]);
    setTranscript("");
    setDetailError(false);
    setDetailLoading(true);
    detailHeading.current?.focus();
    async function load() {
      try {
        if (selection.kind === "message") {
          const result = await api<{ history: Message[] }>(
            `/sessions/${selection.session.id}`,
          );
          if (!cancelled)
            setHistory(
              result.history
                .filter((message) =>
                  ["user", "assistant"].includes(message.role),
                )
                .map((message) => ({
                  ...message,
                  content: visibleMessage(message.content) || "",
                }))
                .filter((message) => message.content),
            );
        } else {
          const call = selection.call;
          const text =
            call.transcript ||
            (
              await api<{ transcript: string }>(
                `/calls/${encodeURIComponent(call.id)}/transcript`,
              )
            ).transcript;
          if (!cancelled) setTranscript(text || "");
        }
      } catch {
        if (!cancelled) setDetailError(true);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detail, detailRefresh]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onSuccess(`${label} copied.`);
    } catch {
      onError(
        "Couldn’t copy that. Select the contact detail and copy it manually.",
      );
    }
  }
  function changeTab(next: Tab) {
    setTab(next);
    setDetail(null);
  }
  const connected =
    !loading.contact && !errors.contact && status?.imessage === "connected";
  const needsConnection =
    !loading.contact &&
    !errors.contact &&
    status?.imessage === "connect_required";
  const connectionStatus = loading.contact
    ? "Checking…"
    : errors.contact
      ? "Status unavailable"
      : connected
        ? "Connected"
        : "Connection needed";
  const sms = !loading.contact && !errors.contact ? status?.sms : null;
  // The connect details belong to Inkbox's router, not the shared agent line.
  // Inkbox sends that line's contact card to the user and omits it from the API.
  const messageAddress = needsConnection ? agent.connect?.command : undefined;

  return (
    <Modal
      title="One companion, wherever you are"
      onClose={onClose}
      className="channels-modal"
    >
      <div className="channels-dialog">
        <div className="channels-intro-row">
          <p className="channels-intro">
            Reach {agentName} from your day-to-day apps, or catch up on messages
            and calls.
          </p>
          <span
            className={`channel-status ${connected ? "is-ready" : ""}`}
            role="status"
            aria-label="Connection status"
            aria-atomic="true"
          >
            {connectionStatus}
          </span>
        </div>
        <div
          className="channel-tabs"
          role="tablist"
          aria-label="Contact and history"
        >
          {tabs.map(({ id: key, label, icon: Icon }, index) => (
            <button
              key={key}
              ref={(element) => {
                tabButtons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-${key}`}
              aria-controls={`${id}-panel-${key}`}
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => changeTab(key)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft")
                  next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else return;
                event.preventDefault();
                changeTab(tabs[next].id);
                tabButtons.current[next]?.focus();
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel-${tab}`}
          aria-labelledby={`${id}-${tab}`}
          className="channel-panel"
          tabIndex={0}
        >
          {tab === "contact" ? (
            <>
              {errors.contact && (
                <ChannelError
                  text={errors.contact}
                  retry={() => setRefresh((value) => value + 1)}
                />
              )}
              <div className="channel-cards">
                <ContactCard
                  icon={<Mail size={19} />}
                  title="Email"
                  value={agent.agentEmail}
                  description={
                    agent.agentEmail
                      ? `Send a note or forward something to ${agentName}.`
                      : "Your email address is getting ready."
                  }
                  action="Send email"
                  href={
                    agent.agentEmail ? `mailto:${agent.agentEmail}` : undefined
                  }
                  onCopy={
                    agent.agentEmail
                      ? () => void copy(agent.agentEmail!, "Email address")
                      : undefined
                  }
                />
                <ContactCard
                  icon={<MessageCircle size={19} />}
                  title="iMessage"
                  copyLabel="connection message"
                  value={messageAddress}
                  description={
                    connected
                      ? `Open your conversation with ${agentName} in Messages, or use the saved contact card Inkbox sent when you connected.`
                      : needsConnection
                        ? "Send the connection message from your phone to get started. Inkbox will send you a contact card for future messages and calls."
                        : "Your connection status is needed to show the messaging instructions."
                  }
                  action={needsConnection ? "Connect Messages" : undefined}
                  href={needsConnection ? agent.connect?.smsLink : undefined}
                  onCopy={
                    messageAddress
                      ? () => void copy(messageAddress, "Connection message")
                      : undefined
                  }
                />
                <ContactCard
                  icon={<Phone size={19} />}
                  title="Calls"
                  copyLabel="phone number"
                  value={sms?.number}
                  description={
                    sms
                      ? `Call this dedicated number. A voice assistant answers and ${agentName} receives the transcript afterwards.`
                      : connected
                        ? `Call ${agentName} from the saved contact card Inkbox sent in Messages. A voice assistant answers and ${agentName} receives the transcript afterwards.`
                        : needsConnection
                          ? "Connect iMessage, then call from the contact card Inkbox sends in Messages."
                          : "Your connection status is needed to show the calling instructions."
                  }
                  action={sms ? "Call" : undefined}
                  href={sms ? `tel:${sms.number}` : undefined}
                  onCopy={
                    sms
                      ? () => void copy(sms.number, "Phone number")
                      : undefined
                  }
                />
                {sms && (
                  <ContactCard
                    icon={<MessageCircle size={19} />}
                    title="SMS"
                    value={sms.number}
                    description={
                      ["active", "ready"].includes(sms.status)
                        ? "Send a text message to this dedicated number."
                        : "Setup in progress for this dedicated text-message number."
                    }
                    action="Open SMS"
                    href={`sms:${sms.number}`}
                    onCopy={() => void copy(sms.number, "SMS number")}
                  />
                )}
              </div>
              <p className="channel-app-note">
                <ArrowUpRight size={13} aria-hidden="true" /> Contact actions
                open your email, messaging, or phone app.
              </p>
            </>
          ) : detail ? (
            <div className="channel-detail">
              <button
                type="button"
                className="channel-back"
                onClick={() => {
                  setDetail(null);
                  requestAnimationFrame(() =>
                    historyButtons.current.get(historyFocus.current)?.focus(),
                  );
                }}
              >
                <ArrowLeft size={15} />
                Back to {tab === "messages" ? "messages" : "calls"}
              </button>
              <h3 ref={detailHeading} tabIndex={-1}>
                {detail.kind === "message"
                  ? detail.session.title
                  : "Call transcript"}
              </h3>
              <p className="channel-detail-meta">
                {detail.kind === "message"
                  ? `${channelName(detail.session.channel)} · ${dateLabel(detail.session.createdAt)}`
                  : dateLabel(callDate(detail.call))}
              </p>
              {detailLoading ? (
                <p className="channel-empty" role="status">
                  Loading{" "}
                  {detail.kind === "message" ? "conversation" : "transcript"}…
                </p>
              ) : detailError ? (
                <ChannelError
                  text="This conversation couldn’t be loaded."
                  retry={() => setDetailRefresh((value) => value + 1)}
                />
              ) : detail.kind === "message" ? (
                <>
                  <div className="channel-transcript">
                    {history.length ? (
                      history.map((message, index) => (
                        <article
                          key={index}
                          className={`channel-message channel-message-${message.role}`}
                        >
                          <span>
                            {message.role === "user" ? "You" : agentName}
                          </span>
                          <Markdown>{message.content}</Markdown>
                        </article>
                      ))
                    ) : (
                      <p className="channel-empty">No messages to show yet.</p>
                    )}
                  </div>
                  <p className="channel-app-note">
                    Continue this conversation in{" "}
                    {channelName(detail.session.channel)}.
                  </p>
                </>
              ) : transcript ? (
                <div className="channel-transcript">
                  <Markdown>{transcript}</Markdown>
                </div>
              ) : (
                <p className="channel-empty">
                  A transcript isn’t available for this call yet.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="channel-history-heading">
                <h3>
                  {tab === "messages" ? "Message history" : "Call history"}
                </h3>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Refresh ${tab === "messages" ? "message" : "call"} history`}
                  disabled={loading[tab]}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={16} className={loading[tab] ? "spin" : ""} />
                </button>
              </div>
              <p className="channel-history-note">
                {tab === "messages"
                  ? "Your email, iMessage, and SMS conversations with your companion."
                  : "Open a call to read its transcript."}
              </p>
              {loading[tab] ? (
                <p className="channel-empty" role="status">
                  Loading {tab === "messages" ? "messages" : "calls"}…
                </p>
              ) : errors[tab] ? (
                <ChannelError
                  text={errors[tab]!}
                  retry={() => setRefresh((value) => value + 1)}
                />
              ) : (
                <div className="channel-history-list">
                  {tab === "messages" ? (
                    messages.length ? (
                      messages.map((session) => (
                        <button
                          type="button"
                          key={session.id}
                          ref={(element) => {
                            if (element)
                              historyButtons.current.set(session.id, element);
                            else historyButtons.current.delete(session.id);
                          }}
                          onClick={() => {
                            historyFocus.current = session.id;
                            setDetail({ kind: "message", session });
                          }}
                        >
                          <span className="channel-history-icon">
                            {session.channel === "email" ? (
                              <Mail size={17} />
                            ) : (
                              <MessageCircle size={17} />
                            )}
                          </span>
                          <span>
                            <strong>{session.title}</strong>
                            <small>
                              {channelName(session.channel)} ·{" "}
                              {dateLabel(session.createdAt)}
                            </small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    ) : (
                      <ChannelEmpty
                        icon={<MessageCircle size={24} />}
                        title="Your messages, all together"
                        text="Email, iMessage, and SMS conversations will appear here once you start chatting."
                      />
                    )
                  ) : calls.length ? (
                    calls.map((call) => (
                      <button
                        type="button"
                        key={call.id}
                        ref={(element) => {
                          if (element)
                            historyButtons.current.set(call.id, element);
                          else historyButtons.current.delete(call.id);
                        }}
                        onClick={() => {
                          historyFocus.current = call.id;
                          setDetail({ kind: "call", call });
                        }}
                      >
                        <span className="channel-history-icon">
                          <Phone size={17} />
                        </span>
                        <span>
                          <strong>
                            {call.direction === "outbound"
                              ? "Outgoing call"
                              : call.direction === "inbound"
                                ? "Incoming call"
                                : "Call with your companion"}
                          </strong>
                          <small>
                            {dateLabel(callDate(call))}
                            {call.status
                              ? ` · ${call.status.replaceAll("_", " ")}`
                              : ""}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <ChannelEmpty
                      icon={<Phone size={24} />}
                      title="A little catch-up, on call"
                      text="Your calls and their transcripts will appear here."
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ContactCard({
  icon,
  title,
  copyLabel,
  value,
  description,
  action,
  href,
  onCopy,
}: {
  icon: ReactNode;
  title: string;
  copyLabel?: string;
  value?: string;
  description: string;
  action?: string;
  href?: string;
  onCopy?: () => void;
}) {
  return (
    <section className="channel-card" aria-label={title}>
      <div className="channel-card-heading">
        <span className="channel-card-icon" aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
      </div>
      {value && (
        <div className="channel-address">
          <span>{value}</span>
          {onCopy && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Copy ${copyLabel || (title === "Email" ? "email address" : `${title} number`)}`}
              title="Copy"
              onClick={onCopy}
            >
              <Copy size={14} />
            </button>
          )}
        </div>
      )}
      <div className="channel-card-bottom">
        <p>{description}</p>
        {action &&
          (href ? (
            <a className="channel-action" href={href}>
              {action}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            <button type="button" className="channel-action" disabled>
              {action}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ))}
      </div>
    </section>
  );
}
function ChannelError({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="channel-error" role="alert">
      <p>{text}</p>
      <button type="button" className="channel-back" onClick={retry}>
        <RefreshCw size={14} />
        Try again
      </button>
    </div>
  );
}
function ChannelEmpty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="channel-empty-state">
      <span aria-hidden="true">{icon}</span>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
