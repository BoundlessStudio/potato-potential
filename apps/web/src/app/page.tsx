"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  Heart,
  History,
  Leaf,
  Lightbulb,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Monitor,
  Plus,
  Puzzle,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  avatars,
  colors,
  phoneSchema,
  profileSchema,
  visibleMessage,
  type Conversation,
  type Cron,
  type CronRun,
  type Message,
  type Notification,
  type Profile,
  type PublicAgent,
  type StreamEvent,
  type WorkspaceItem,
} from "@boundless/shared";
import { api, credential, demo, signOut, stream, supabase } from "@/lib/client";
import { Brand, Companion } from "@/components/companion";
import { Computer } from "@/components/computer";
import { PhoneField } from "@/components/phone-field";
import { FeatureOverview } from "@/components/feature-overview";
import { PublicEntry } from "@/components/public-entry";
import {
  Apps,
  Markdown,
  Modal,
  Routines,
  Settings,
  Tasks,
  Wiki,
} from "@/components/views";

type Tab = "chat" | "tasks" | "wiki" | "routines" | "apps" | "settings";
const nav = [
  { id: "chat", label: "Your conversation", icon: MessageCircle },
  { id: "tasks", label: "Tasks", icon: CheckCircle2 },
  { id: "wiki", label: "Wiki", icon: BookOpen },
  { id: "routines", label: "Routines", icon: Clock3 },
  { id: "apps", label: "Apps", icon: Puzzle },
] as const;
const err = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something interrupted that request.";
export default function Home() {
  const [booting, setBooting] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [operator, setOperator] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [mobileNav, setMobileNav] = useState(false);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [routines, setRoutines] = useState<Cron[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showComputer, setShowComputer] = useState(false);
  const takeoverContext = useRef(false);
  const [routinePrompt, setRoutinePrompt] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [activity, setActivity] = useState("");
  const [responseId, setResponseId] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Notification | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [calls, setCalls] = useState<any[]>([]);
  const [channelStatus, setChannelStatus] = useState<any>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const say = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, []);
  const onError = useCallback((message: string) => say(message, true), [say]);
  const onSuccess = useCallback((message: string) => say(message), [say]);
  const feedback = { onError, onSuccess };
  const loadAccount = useCallback(async () => {
    try {
      const auth = await credential();
      if (!auth) {
        setSignedIn(false);
        return;
      }
      let data = await api("/me");
      const invitation = localStorage.getItem("boundless-invite");
      if ((invitation || data.invited) && !data.profile) {
        await api(
          "/invitations/accept",
          "POST",
          invitation ? { invitation } : {},
        );
        localStorage.removeItem("boundless-invite");
        data = await api("/me");
      }
      setSignedIn(true);
      setAccountEmail(data.email || "");
      setProfile(data.profile);
      setAgent(data.agent);
      setOperator(data.operator);
    } catch (error) {
      setSignedIn(false);
      if ((error as any).status !== 401) onError(err(error));
    } finally {
      setBooting(false);
    }
  }, [onError]);
  const refreshWorkspace = useCallback(async () => {
    const results = await Promise.allSettled([
      api("/items"),
      api("/notifications"),
      api("/routines"),
    ]);
    if (results[0].status === "fulfilled") setItems(results[0].value.items);
    if (results[1].status === "fulfilled")
      setNotes(results[1].value.notifications);
    if (results[2].status === "fulfilled") {
      setRoutines(results[2].value.routines);
      setRuns(results[2].value.runs);
    }
    for (const result of results)
      if (result.status === "rejected") onError(err(result.reason));
  }, [onError]);
  const loadHistory = useCallback(async () => {
    const id = selectedSession || agent?.mainSessionId;
    if (!id) return null;
    const data = await api(`/sessions/${id}`);
    setMessages(
      data.history
        .filter((message: Message) =>
          ["user", "assistant"].includes(message.role),
        )
        .map((message: Message) => ({
          ...message,
          content: visibleMessage(message.content) || "",
        }))
        .filter((message: Message) => message.content),
    );
    return data;
  }, [selectedSession, agent?.mainSessionId]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const invitation = url.searchParams.get("invite");
    if (invitation) {
      localStorage.setItem("boundless-invite", invitation);
      window.location.replace(
        `/signin?invite=${encodeURIComponent(invitation)}`,
      );
      return;
    }
    if (url.searchParams.has("auth_error"))
      onError("That sign-in link could not be used. Request a fresh one.");
    void loadAccount();
    return () => {
      alive.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [loadAccount, onError]);
  useEffect(() => {
    if (!signedIn || !agent || agent.status === "ready") return;
    const timer = setInterval(() => void loadAccount(), 1500);
    return () => clearInterval(timer);
  }, [signedIn, agent?.status, loadAccount]);
  useEffect(() => {
    if (agent?.status !== "ready") return;
    void refreshWorkspace();
    void loadHistory()
      .then((session) => {
        if (session?.active_response_id && !selectedSession) {
          setResponseId(session.active_response_id);
          setInterrupted(true);
        }
      })
      .catch((error) => onError(err(error)));
  }, [agent?.status, refreshWorkspace, loadHistory, onError, selectedSession]);
  useEffect(() => {
    if (!profile || agent?.status !== "ready" || demo) return;
    const channel = supabase()
      .channel(`workspace:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_items",
          filter: `owner_id=eq.${profile.id}`,
        },
        () => void refreshWorkspace(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `owner_id=eq.${profile.id}`,
        },
        () => void refreshWorkspace(),
      )
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [profile?.id, agent?.status, refreshWorkspace]);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, liveText, busy]);
  const onEvent = useCallback((event: StreamEvent) => {
    if (event.event === "response.created") {
      setResponseId(String(event.data.id));
      setLiveText("");
      setActivity("Thinking it through…");
    }
    if (event.event === "response.tool_call.started")
      setActivity(String(event.data.label || "Working on it…"));
    if (event.event === "response.output_text.delta") {
      setLiveText((current) => current + String(event.data.text || ""));
      setActivity("A thought is taking shape…");
    }
    if (event.event === "response.completed")
      setLiveText(String(event.data.output_text || ""));
    if (event.event === "response.failed") {
      setInterrupted(true);
      throw new Error(
        (event.data.error as any)?.message ||
          "The agent’s turn was interrupted.",
      );
    }
  }, []);
  async function send(text = input) {
    if (!text.trim() || busy || selectedSession) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    setBusy(true);
    setInterrupted(false);
    setLiveText("");
    setActivity("Thinking it through…");
    try {
      await stream(
        "/responses",
        {
          input: text,
          takeover: takeoverContext.current,
          notificationId: replyTo?.id,
        },
        onEvent,
      );
      takeoverContext.current = false;
      setReplyTo(null);
      await loadHistory();
      setLiveText("");
      void refreshWorkspace();
    } catch (error) {
      setInterrupted(true);
      onError(err(error));
    } finally {
      setBusy(false);
      setActivity("");
    }
  }
  async function recover() {
    setBusy(true);
    setInterrupted(false);
    try {
      const current = await loadHistory();
      const id = current?.active_response_id || responseId;
      if (id) {
        try {
          await stream(`/responses/${id}/stream`, undefined, onEvent);
        } catch (error) {
          if ((error as any).code !== "response_not_found") throw error;
          const recovered = await loadHistory();
          if (recovered?.active_response_id)
            throw new Error(
              "Your agent is still working. Try reconnecting again shortly.",
            );
        }
      }
      await loadHistory();
      setLiveText("");
      void refreshWorkspace();
    } catch (error) {
      setInterrupted(true);
      onError(err(error));
    } finally {
      setBusy(false);
      setActivity("");
    }
  }
  async function stop() {
    if (!responseId) return;
    try {
      await api(`/responses/${responseId}/cancel`, "POST");
      onSuccess("The current turn has been stopped.");
    } catch (error) {
      onError(err(error));
    }
  }
  const returnControl = useCallback(() => {
    takeoverContext.current = true;
    onSuccess(
      "Control returned. Your next message will tell the agent to inspect the browser.",
    );
  }, [onSuccess]);
  const clearPrompt = useCallback(() => setRoutinePrompt(undefined), []);
  const navigate = (next: Tab) => {
    setTab(next);
    setMobileNav(false);
  };
  const openSession = (id: string) => {
    setSelectedSession(id);
    setTab("chat");
    setHistoryOpen(false);
  };
  function makeRoutine(text: string) {
    setRoutinePrompt(text);
    navigate("routines");
  }
  const unread = notes.filter((note) => !note.readAt).length;
  async function showHistory() {
    setHistoryOpen(true);
    try {
      setSessions((await api("/sessions")).sessions);
    } catch (error) {
      onError(err(error));
    }
  }
  async function showChannels() {
    setChannelsOpen(true);
    try {
      const [calls, status] = await Promise.all([
        api("/calls"),
        api("/channels"),
      ]);
      setCalls(calls.calls);
      setChannelStatus(status);
    } catch (error) {
      onError(err(error));
    }
  }
  async function openTranscript(call: any) {
    if (call.transcript) {
      setTranscript(call.transcript);
      return;
    }
    try {
      const result = await api(`/calls/${call.id}/transcript`);
      setTranscript(
        typeof result.transcript === "string"
          ? result.transcript
          : JSON.stringify(
              result.transcript || result.segments || result,
              null,
              2,
            ),
      );
    } catch (error) {
      onError(err(error));
    }
  }
  function freshPreview() {
    localStorage.setItem("boundless-demo-user", "demo-new");
    window.location.reload();
  }

  if (booting)
    return (
      <main className="boot-screen">
        <Brand />
        <Companion size={100} />
        <p>Making a little room for you…</p>
      </main>
    );
  if (!signedIn)
    return (
      <>
        <PublicEntry />
        {toast && <Toast toast={toast} close={() => setToast(null)} />}
      </>
    );
  if (!profile && !operator && !demo)
    return <PublicEntry pendingEmail={accountEmail} />;
  if (!agent)
    return (
      <>
        <Onboarding
          initial={profile}
          onDone={() => void loadAccount()}
          onError={onError}
        />
        {toast && <Toast toast={toast} close={() => setToast(null)} />}
      </>
    );
  if (agent.status !== "ready")
    return (
      <>
        <Setup
          profile={profile}
          agent={agent}
          retry={async () => {
            try {
              await api(
                agent.status === "deleting" ? "/account" : "/onboarding/retry",
                agent.status === "deleting" ? "DELETE" : "POST",
              );
              void loadAccount();
            } catch (error) {
              onError(err(error));
            }
          }}
          verify={async () => {
            try {
              await api("/onboarding/verify-phone", "POST");
              void loadAccount();
            } catch (error) {
              onError(err(error));
            }
          }}
        />
        {toast && <Toast toast={toast} close={() => setToast(null)} />}
      </>
    );
  if (!profile) return null;
  return (
    <div
      className="app-shell"
      style={{ "--companion-color": profile.color } as React.CSSProperties}
    >
      {mobileNav && (
        <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <Brand />
        <div className="sidebar-label">YOUR LITTLE CORNER</div>
        <nav aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
              {id === "tasks" &&
                items.some((item) => item.status === "needs_you") && (
                  <span className="nav-count">
                    {items.filter((item) => item.status === "needs_you").length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-spark">✦</span>
          <p>
            A little help.
            <br />
            <strong>A lot of possibility.</strong>
          </p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <SettingsIcon size={18} />
            Settings
          </button>
          {operator && (
            <Link className="nav-item" href="/operator/invitations">
              <ShieldCheck size={18} />
              Beta operator
            </Link>
          )}
          <div className="sidebar-profile">
            <span className="person-avatar">{profile.name.slice(0, 1)}</span>
            <div>
              <strong>{profile.name}</strong>
              <small>
                {demo ? "Your preview workspace" : "Your personal workspace"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut size={15} />
            </button>
          </div>
          {demo && (
            <button className="fresh-preview" onClick={freshPreview}>
              <Plus size={12} />
              Try agent onboarding
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span>
              {tab === "chat"
                ? "You & your companion"
                : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </span>
            <ChevronRight size={13} />
            <span className="topbar-subtitle">{profile.agentName}’s world</span>
          </div>
          <div className="topbar-actions">
            {demo && <span className="preview-badge">Local preview</span>}
            <span className="availability">
              <span className="status-dot" />
              Here for you
            </span>
            <button
              className={`icon-button notifications-button ${unread ? "has-notifications" : ""}`}
              aria-label="Notifications"
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell size={19} />
              {unread > 0 && (
                <span className="notification-count">{unread}</span>
              )}
            </button>
          </div>
        </header>
        {tab === "chat" ? (
          <div className="conversation-layout">
            <section className="chat-column">
              <div className="chat-heading">
                <div className="buddy-heading">
                  <div className="buddy-avatar">
                    <Companion
                      avatar={profile.avatar}
                      color={profile.color}
                      size={55}
                    />
                  </div>
                  <div>
                    <h1>{profile.agentName}</h1>
                    <p>
                      {busy
                        ? activity || "Working on it…"
                        : "A little curious. Always in your corner."}
                    </p>
                  </div>
                </div>
                <div className="chat-tools">
                  <button
                    className="icon-button"
                    onClick={() => void showHistory()}
                    aria-label="Conversation history"
                  >
                    <History size={18} />
                  </button>
                  <button
                    className="text-button channel-button"
                    onClick={() => void showChannels()}
                  >
                    Channels
                  </button>
                  <button
                    className={`button button-secondary computer-toggle ${showComputer ? "selected" : ""}`}
                    onClick={() => setShowComputer((value) => !value)}
                  >
                    <Monitor size={16} />
                    <span>Computer</span>
                  </button>
                </div>
              </div>
              <div className="chat-scroll">
                <div className="chat-welcome">
                  <span className="welcome-eyebrow">
                    <Sparkles size={13} /> A little space for big things
                  </span>
                  <h2>
                    A little more room
                    <br />
                    for <span>what matters.</span>
                  </h2>
                  <div className="welcome-scene">
                    <FeatureOverview color={profile.color} />
                  </div>
                </div>
                <div className="chat-date">
                  <span />
                  TODAY
                  <span />
                </div>
                <div className="message-list">
                  {messages.map((message, index) => (
                    <div
                      className={`message message-${message.role}`}
                      key={`${index}-${message.role}`}
                    >
                      {message.role === "assistant" && (
                        <Companion
                          avatar={profile.avatar}
                          color={profile.color}
                          size={33}
                        />
                      )}
                      <div className="message-body">
                        {message.role === "assistant" && (
                          <span className="message-name">
                            {profile.agentName}
                          </span>
                        )}
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </div>
                  ))}
                  {(busy || liveText) && (
                    <div className="message message-assistant">
                      <Companion
                        avatar={profile.avatar}
                        color={profile.color}
                        size={33}
                      />
                      <div className="message-body">
                        <span className="message-name">
                          {profile.agentName}
                        </span>
                        {liveText ? (
                          <Markdown>{liveText}</Markdown>
                        ) : (
                          <div className="thinking-dots">
                            <i />
                            <i />
                            <i />
                            <small>{activity || "Thinking…"}</small>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div ref={chatBottom} />
                </div>
              </div>
              {selectedSession ? (
                <div className="readonly-note">
                  <History size={16} />
                  <span>
                    This is a saved conversation. Continue messaging in its
                    original channel.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setSelectedSession(null)}
                  >
                    Back to your chat
                  </button>
                </div>
              ) : (
                <div className="composer-area">
                  {interrupted && (
                    <div className="reconnect-note">
                      <RefreshCw size={14} />
                      <span>Your agent may still be working.</span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void recover()}
                      >
                        Reconnect
                      </button>
                    </div>
                  )}
                  {replyTo && (
                    <div className="reply-context">
                      Replying to a check-in
                      <button
                        className="icon-button"
                        onClick={() => setReplyTo(null)}
                        aria-label="Clear notification reply"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder={`A thought, a task, a little “what if”…`}
                      aria-label="Message your companion"
                      rows={1}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <span>
                        <Sparkles size={14} />A little help starts here.
                      </span>
                      {busy ? (
                        <button
                          type="button"
                          className="send-button stop-button"
                          aria-label="Stop response"
                          onClick={() => void stop()}
                        >
                          <Square size={16} />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label="Send message"
                          disabled={!input.trim()}
                        >
                          <ArrowRight size={21} />
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="starter-chips">
                    <button
                      onClick={() =>
                        void send("Help me make a little room in my week.")
                      }
                    >
                      <Leaf size={13} />
                      Make room in my week
                    </button>
                    <button
                      onClick={() =>
                        void send("I have an idea I’d like to think through.")
                      }
                    >
                      <Lightbulb size={13} />
                      Think through an idea
                    </button>
                    <button
                      onClick={() =>
                        void send("Help me set up a useful morning briefing.")
                      }
                    >
                      <Clock3 size={13} />A lighter morning
                    </button>
                  </div>
                  <p className="composer-footnote">
                    {demo
                      ? "A local preview with mocked providers. No real work, messages, or purchases."
                      : "Your companion can make mistakes. Keep an eye on the things that matter."}
                  </p>
                </div>
              )}
            </section>
            <aside
              className={`companion-panel ${showComputer ? "computer-open" : ""}`}
            >
              {showComputer ? (
                <Computer
                  profile={profile}
                  onClose={() => setShowComputer(false)}
                  onReturn={returnControl}
                  onError={onError}
                />
              ) : (
                <>
                  <div className="panel-intro">
                    <span className="eyebrow">YOUR LITTLE TEAM OF TWO</span>
                    <h2>
                      {profile.agentName}’s world <span>✦</span>
                    </h2>
                    <p>A few things taking shape.</p>
                  </div>
                  <div className="companion-card">
                    <div className="companion-card-art">
                      <Companion
                        avatar={profile.avatar}
                        color={profile.color}
                        size={150}
                        scene
                      />
                    </div>
                    <div>
                      <span className="status-pill">
                        <span className="status-dot" />
                        Here, and ready
                      </span>
                      <h3>A computer of their own.</h3>
                      <p>
                        A little space to browse, make things, and take care of
                        your work.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setShowComputer(true)}
                      >
                        Take a peek <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="panel-section-heading">
                    <h3>Taking care of</h3>
                    <button
                      className="icon-button"
                      aria-label="View all tasks"
                      onClick={() => navigate("tasks")}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="care-list">
                    {items
                      .filter(
                        (item) =>
                          ["task", "responsibility"].includes(item.kind) &&
                          ["in_progress", "needs_you"].includes(item.status),
                      )
                      .slice(0, 3)
                      .map((item) => (
                        <button
                          className="care-item"
                          key={item.id}
                          onClick={() => navigate("tasks")}
                        >
                          <span
                            className={`care-icon ${item.status === "needs_you" ? "care-orange" : ""}`}
                          >
                            {item.status === "needs_you" ? (
                              <MessageCircle size={15} />
                            ) : (
                              <Sparkles size={15} />
                            )}
                          </span>
                          <span>
                            <strong>{item.title}</strong>
                            <small>
                              {item.status === "needs_you"
                                ? "A little input from you"
                                : "In good hands"}
                            </small>
                          </span>
                        </button>
                      ))}
                    {!items.some((item) => item.status === "in_progress") && (
                      <p className="quiet-note">
                        Hand over a responsibility to get started.
                      </p>
                    )}
                  </div>
                  <div className="panel-section-heading">
                    <h3>A little rhythm</h3>
                    <button
                      className="icon-button"
                      aria-label="View routines"
                      onClick={() => navigate("routines")}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {routines.slice(0, 2).map((routine) => (
                    <button
                      key={routine.id}
                      className="mini-routine"
                      onClick={() => navigate("routines")}
                    >
                      <Clock3 size={16} />
                      <span>
                        <strong>{routine.name}</strong>
                        <small>
                          {routine.enabled ? "On the schedule" : "Paused"}
                        </small>
                      </span>
                      <span
                        className={`status-dot ${routine.enabled ? "" : "paused"}`}
                      />
                    </button>
                  ))}
                  {items
                    .filter(
                      (item) =>
                        item.kind === "suggestion" &&
                        item.status !== "completed",
                    )
                    .slice(0, 1)
                    .map((item) => (
                      <div className="suggestion-card" key={item.id}>
                        <span className="eyebrow">
                          <Lightbulb size={13} />A LITTLE IDEA
                        </span>
                        <h3>{item.title}</h3>
                        <p>{item.body}</p>
                        <button
                          className="text-button"
                          onClick={() => makeRoutine(item.body)}
                        >
                          Make it a routine <ArrowRight size={13} />
                        </button>
                      </div>
                    ))}
                  <div className="panel-footer">
                    <Heart size={13} />
                    Good things happen together.
                  </div>
                </>
              )}
            </aside>
          </div>
        ) : (
          <main className="workspace-page">
            {tab === "tasks" && (
              <Tasks
                items={items}
                refresh={() => void refreshWorkspace()}
                {...feedback}
              />
            )}{" "}
            {tab === "wiki" && (
              <Wiki
                items={items}
                refresh={() => void refreshWorkspace()}
                {...feedback}
              />
            )}{" "}
            {tab === "routines" && (
              <Routines
                routines={routines}
                runs={runs}
                refresh={() => void refreshWorkspace()}
                profile={profile}
                initialPrompt={routinePrompt}
                clearPrompt={clearPrompt}
                openSession={openSession}
                {...feedback}
              />
            )}{" "}
            {tab === "apps" && <Apps {...feedback} />}{" "}
            {tab === "settings" && (
              <Settings
                profile={profile}
                agent={agent}
                operator={operator}
                refresh={() => {
                  void loadAccount();
                  void refreshWorkspace();
                }}
                {...feedback}
              />
            )}{" "}
          </main>
        )}
      </div>
      {toast && <Toast toast={toast} close={() => setToast(null)} />}{" "}
      {historyOpen && (
        <Modal title="Your conversations" onClose={() => setHistoryOpen(false)}>
          <div className="history-list">
            <button
              onClick={() => {
                setSelectedSession(null);
                setHistoryOpen(false);
              }}
            >
              <MessageCircle size={18} />
              <span>Your ongoing web chat</span>
              <ArrowRight size={16} />
            </button>
            {sessions
              .filter((session) => session.id !== agent.mainSessionId)
              .map((session) => (
                <button
                  key={session.id}
                  onClick={() => openSession(session.id)}
                >
                  <History size={18} />
                  <span>
                    {session.title.slice(0, 100)}
                    <small>{session.channel}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}
      {notificationsOpen && (
        <Modal
          title="A few useful updates"
          onClose={() => setNotificationsOpen(false)}
        >
          <div className="notification-list">
            {notes.length ? (
              notes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => {
                    setReplyTo(note);
                    setSelectedSession(null);
                    setTab("chat");
                    setNotificationsOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <span
                    className={`status-dot ${note.readAt ? "paused" : ""}`}
                  />
                  <span>
                    {note.text}
                    <small>{new Date(note.createdAt).toLocaleString()}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p className="quiet-note">
                Your companion will share useful news here.
              </p>
            )}
          </div>
          <button
            className="button button-secondary"
            onClick={async () => {
              try {
                await api("/notifications/read", "POST");
                void refreshWorkspace();
              } catch (error) {
                onError(err(error));
              }
            }}
          >
            Mark all as read
          </button>
        </Modal>
      )}
      {channelsOpen && (
        <Modal
          title="One companion, wherever you are"
          onClose={() => setChannelsOpen(false)}
        >
          <div className="channel-info">
            <span className="eyebrow">YOUR AGENT’S EMAIL</span>
            <a href={`mailto:${agent.agentEmail}`}>{agent.agentEmail}</a>
            <span className="eyebrow">IMESSAGE CONNECTION</span>
            {channelStatus && (
              <p>
                <span
                  className={`status-tag ${channelStatus.imessage === "connected" ? "completed" : "needs_you"}`}
                >
                  {channelStatus.imessage === "connected"
                    ? "Connected"
                    : "Connection needed"}
                </span>{" "}
                · Email {channelStatus.email}
              </p>
            )}
            <p>{agent.connect?.command}</p>
            {channelStatus?.sms && (
              <p>
                SMS:{" "}
                <a href={`sms:${channelStatus.sms.number}`}>
                  {channelStatus.sms.number}
                </a>{" "}
                · {channelStatus.sms.status}
              </p>
            )}
            {agent.connect?.smsLink && (
              <a
                className="button button-secondary"
                href={agent.connect.smsLink}
              >
                Open Messages <ExternalLinkIcon />
              </a>
            )}
            <p className="fine-print">
              Hosted voice answers your calls and sends Hermes the transcript
              afterwards.
            </p>
          </div>
          <div className="section-heading">
            <h3>Recent calls</h3>
          </div>
          {calls.length ? (
            calls.map((call) => (
              <button
                key={call.id}
                className="run-row"
                onClick={() => void openTranscript(call)}
              >
                <span>{call.status || "Call"}</span>
                <small>
                  {new Date(
                    call.started_at || call.created_at || Date.now(),
                  ).toLocaleString()}
                </small>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <p className="quiet-note">Your calls will appear here.</p>
          )}
        </Modal>
      )}
      {transcript && (
        <Modal title="Your call transcript" onClose={() => setTranscript(null)}>
          <Markdown>{transcript}</Markdown>
        </Modal>
      )}
    </div>
  );
}
function ExternalLinkIcon() {
  return <ArrowRight size={15} />;
}
function Toast({
  toast,
  close,
}: {
  toast: { message: string; error: boolean };
  close: () => void;
}) {
  return (
    <div role="alert" className={`toast ${toast.error ? "toast-error" : ""}`}>
      {toast.error ? <MessageCircle size={18} /> : <CheckCircle2 size={18} />}
      <span>{toast.message}</span>
      <button
        className="icon-button"
        onClick={close}
        aria-label="Dismiss message"
      >
        <X size={15} />
      </button>
    </div>
  );
}
function Onboarding({
  initial,
  onDone,
  onError,
}: {
  initial: Profile | null;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState({
    name: initial?.name || "",
    agentName: initial?.agentName || "Pip",
    avatar: initial?.avatar || ("sprout" as Profile["avatar"]),
    color: initial?.color || "#7659e8",
    phone: initial?.phone || "",
    timezone:
      initial?.timezone === "UTC"
        ? "America/Toronto"
        : initial?.timezone || "America/Toronto",
    personality:
      initial?.personality ||
      "Curious, thoughtful, and quietly optimistic. A little playful. Always useful.",
    preferences: initial?.preferences || "",
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!initial?.timezone)
      setDraft((current) => ({
        ...current,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
  }, [initial?.timezone]);
  const [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!phoneSchema.safeParse(draft.phone).success) return;
    setBusy(true);
    try {
      const data = profileSchema.parse(draft);
      await api("/onboarding", "POST", data);
      onDone();
    } catch (error) {
      onError(
        (error as any).issues?.map((issue: any) => issue.message).join(" ") ||
          err(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-page">
      <Brand />
      <div className="onboarding-layout">
        <section className="onboarding-story">
          <span className="eyebrow">THE START OF SOMETHING GOOD</span>
          <h1>
            A little hello.
            <br />A companion of <span>your own.</span>
          </h1>
          <Companion
            avatar={draft.avatar}
            color={draft.color}
            size={330}
            scene
          />
          <h2>Meet {draft.agentName || "your companion"}.</h2>
          <p>
            A name, a familiar face, and a little personality.
            <br />
            We’ll give them a computer and a way to keep in touch.
          </p>
          {demo && (
            <span className="preview-badge">
              Local preview · no live provisioning
            </span>
          )}
        </section>
        <form className="onboarding-form stack" onSubmit={submit}>
          <div className="form-two">
            <label>
              Your name
              <input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Alex"
              />
            </label>
            <label>
              Their name
              <input
                required
                value={draft.agentName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    agentName: event.target.value,
                  }))
                }
                placeholder="Pip"
              />
            </label>
          </div>
          <span className="field-label">A familiar little face</span>
          <div className="avatar-options">
            {avatars.map((avatar) => (
              <button
                type="button"
                key={avatar}
                aria-label={`Choose ${avatar}`}
                aria-pressed={draft.avatar === avatar}
                className={draft.avatar === avatar ? "selected" : ""}
                onClick={() => setDraft((current) => ({ ...current, avatar }))}
              >
                <Companion avatar={avatar} color={draft.color} size={66} />
                <small>{avatar}</small>
              </button>
            ))}
          </div>
          <div className="color-options">
            {colors.map((color) => (
              <button
                type="button"
                key={color}
                style={{ background: color }}
                aria-label={`Choose color ${color}`}
                aria-pressed={draft.color === color}
                className={draft.color === color ? "selected" : ""}
                onClick={() => setDraft((current) => ({ ...current, color }))}
              >
                {draft.color === color && <Check size={15} />}
              </button>
            ))}
          </div>
          <PhoneField
            value={draft.phone}
            submitted={submitted}
            disabled={busy}
            onChange={(phone) => setDraft((current) => ({ ...current, phone }))}
          />
          <label>
            Your timezone
            <input
              required
              value={draft.timezone}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
              list="timezones"
            />
            <datalist id="timezones">
              {[
                "America/Toronto",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "Europe/Paris",
                "Asia/Tokyo",
                "Australia/Sydney",
                "UTC",
              ].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
          <label>
            A little personality
            <textarea
              value={draft.personality}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  personality: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Anything they should know?
            <textarea
              value={draft.preferences}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  preferences: event.target.value,
                }))
              }
              placeholder="Your rhythms, preferences, the things that matter…"
            />
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            Create my companion
          </button>
        </form>
      </div>
    </main>
  );
}
function Setup({
  profile,
  agent,
  retry,
  verify,
}: {
  profile: Profile | null;
  agent: PublicAgent;
  retry: () => Promise<void>;
  verify: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const labels = [
    ["identity", "A way to keep in touch"],
    ["computer", "A computer of their own"],
    ["phone", "Your phone connection"],
    ["persona", "A little personality"],
    ["plugin", "Messages, email, and calls"],
    ["ready", "Ready for a little hello"],
  ];
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup-page">
      <Brand />
      <div className="setup-card">
        <Companion avatar={profile?.avatar} color={profile?.color} size={145} />
        <span className="eyebrow">A FEW LITTLE THINGS COMING TOGETHER</span>
        <h1>
          {agent.status === "deleting"
            ? "Saying goodbye, carefully."
            : `Making room for ${profile?.agentName || "your companion"}.`}
        </h1>
        <p>
          {agent.status === "awaiting_phone"
            ? "A little hello from your phone, and we’re on our way."
            : "You can come back to this page. Setup will pick up where it left off."}
        </p>
        <div className="setup-steps">
          {labels.map(([id, label]) => (
            <div
              key={id}
              className={`${agent.completed.includes(id as any) ? "done" : ""} ${agent.phase === id ? "current" : ""}`}
            >
              <span>
                {agent.completed.includes(id as any) ? (
                  <Check size={16} />
                ) : agent.phase === id && agent.status !== "awaiting_phone" ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <span />
                )}
              </span>
              {label}
            </div>
          ))}
        </div>
        {agent.status === "awaiting_phone" && (
          <div className="phone-verification">
            <h3>First, connect in Messages.</h3>
            {agent.connect?.qr && (
              <img
                alt="Scan to connect your phone"
                src={agent.connect.qr}
                width={156}
                height={156}
              />
            )}
            <a
              className="button button-secondary"
              href={agent.connect?.smsLink}
            >
              Open Messages <ArrowRight size={15} />
            </a>
            <p>
              Send <code>{agent.connect?.command}</code> to{" "}
              {agent.connect?.number}. Then send this code to your agent:
            </p>
            <strong className="verification-code">
              {agent.phoneChallenge}
            </strong>
            {agent.sms && (
              <p>
                Prefer SMS? Text <strong>START</strong>, then the verification
                code, to{" "}
                <a href={`sms:${agent.sms.number}`}>{agent.sms.number}</a>. SMS
                readiness: {agent.sms.status}.
              </p>
            )}
            <p className="fine-print">
              {demo
                ? "Preview only: the button simulates a confirmed inbound message."
                : "Use the mobile number you supplied. We check the inbound message directly with Inkbox."}
            </p>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void act(verify)}
            >
              {busy ? <Loader2 size={16} /> : <CheckCircle2 size={16} />}{" "}
              {demo
                ? "Simulate phone confirmation"
                : "I sent the code · check connection"}
            </button>
          </div>
        )}
        {agent.error && (
          <div className="setup-error">
            <p>{agent.error}</p>
            <button
              className="button button-primary"
              onClick={() => void act(retry)}
              disabled={busy}
            >
              <RefreshCw size={16} />
              Continue setup
            </button>
          </div>
        )}
        {agent.status === "deleting" && (
          <p className="fine-print">
            Ownership records stay in place until both providers confirm
            removal.
          </p>
        )}
      </div>
    </main>
  );
}
