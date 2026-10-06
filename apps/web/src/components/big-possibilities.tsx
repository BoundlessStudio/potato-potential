import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileCode2,
  Globe2,
  Layers3,
  MessageCircle,
  Monitor,
  MousePointer2,
  Plug,
  Search,
  Sparkles,
  Sprout,
  Terminal,
  Wallet,
} from "lucide-react";
import styles from "./big-possibilities.module.css";

// Capability descriptions checked against Agent37's full docs on 2026-10-06.
// Keep provider capabilities distinct from channels and tools enabled in a workspace.
const partners = [
  {
    name: "Brave",
    category: "WEB RESEARCH",
    icon: Search,
    color: "peach",
    title: "A very useful rabbit hole.",
    description:
      "Give your companion a question worth digging into. Brave Search brings back current web results; the browser lets them open sources, compare the details, and turn the trail of tabs into a useful brief with links you can check.",
    features: [
      "Research a new idea, a destination, or the tools for a project.",
      "Compare options and keep the sources alongside the findings.",
      "Turn a pile of links into a sourced comparison or project brief.",
    ],
    technical:
      "Agent37 provides Brave through a managed HTTP search API, with query, country, language, and freshness options. Search finds the pages; the companion’s browser reads them.",
    availability: "Managed search on the companion’s computer",
    href: "https://www.agent37.com/docs/agents-api/managed-services#web-search",
    link: "Read about managed Brave search",
  },
  {
    name: "Composio",
    category: "CONNECTED APPS",
    icon: Plug,
    color: "mint",
    title: "Your apps, pulling together.",
    description:
      "Connect the tools where your life already happens. Your companion can find the right app action, read the context, and do useful work across accounts you connect: email, calendars, documents, project tools, and more.",
    features: [
      "Bring Gmail, Google Calendar, Slack, Notion, or GitHub into a task.",
      "Turn a thread into a task, update a document, or organize a project.",
      "Browse the full catalog in Apps, check connections, and disconnect.",
    ],
    technical:
      "Composio exposes tools through MCP (Model Context Protocol). The agent discovers actions as needed instead of loading the entire catalog. Connections are scoped to its instance and survive restarts; app availability and authorization requirements vary.",
    availability: "Connect your accounts in Apps",
    href: "https://www.agent37.com/docs/agents-api/integrations",
    link: "Read about app connections",
  },
  {
    name: "Perflo",
    category: "SPECIALIST TOOLS",
    icon: Layers3,
    color: "butter",
    title: "A little help from the specialists.",
    description:
      "Some jobs need a tool with a particular talent. Agent37’s managed Perflo catalog offers services by the call: web scraping, company and people lookups, data enrichment, generation, and other specialist capabilities, without separate vendor subscriptions.",
    features: [
      "Discover a service and its listed price before choosing a tool.",
      "Collect structured web data or enrich a research dataset.",
      "Pay for a specific tool call from the managed-service budget.",
    ],
    technical:
      "The Perflo MCP server provides list_services, spend, pay, and get_task_result. Discovery is free. pay accepts a maxCharge checked before payment; spend chooses a vendor and reports the final charge. Tool availability depends on the installed desktop image and configuration.",
    availability: "Agent37 capability · desktop image dependent",
    href: "https://www.agent37.com/docs/agents-api/managed-services#paid-tools",
    link: "Read about managed Perflo tools",
  },
  {
    name: "Inkbox",
    category: "MESSAGES, EMAIL & CALLS",
    icon: MessageCircle,
    color: "lilac",
    title: "A ‘hey’ away from your day.",
    description:
      "Keep the conversation going beyond the web workspace. Your companion gets an Inkbox identity for email and supported messaging. Forward a thread, send a thought from your phone, or get a useful update when work produces something worth sharing.",
    features: [
      "Connect iMessage from your phone using the supplied instructions.",
      "Email your companion, forward a thread, or CC them into context.",
      "Use hosted voice calls; SMS is available when the account supports it.",
    ],
    technical:
      "Signed webhooks deliver incoming events and can wake the computer. Web, text, and email conversations share Hermes’ native memory. Hosted voice has its own instructions and sends Hermes a transcript afterward, rather than reading its memory live. Phone ownership and channel setup come first.",
    availability: "Complete the channel setup in your workspace",
    href: "https://www.agent37.com/docs/agents-api/imessage",
    link: "Read about Inkbox channels and voice",
  },
] as const;

const projectSteps = [
  {
    number: "01",
    title: "Find the good stuff.",
    icon: Search,
    text: "Research the landscape with Brave, read the sources, and gather a brief you can actually use.",
  },
  {
    number: "02",
    title: "Give the idea a home.",
    icon: BookOpen,
    text: "Save the findings in your wiki. Pull relevant context from connected apps and agree on the next tasks.",
  },
  {
    number: "03",
    title: "Make something real.",
    icon: Terminal,
    text: "Work in the browser, write a script, shape a dataset, or put together files on the persistent computer.",
  },
  {
    number: "04",
    title: "Bring it back to you.",
    icon: MessageCircle,
    text: "Save the deliverable, update the task, and share the result through a connected channel. Pick up the next step together.",
  },
];

export function BigPossibilities() {
  return (
    <section
      id="big-possibilities"
      className={styles.section}
      aria-labelledby="big-possibilities-title"
    >
      <div className={styles.intro}>
        <span className={styles.eyebrow}>
          <Sparkles size={16} aria-hidden="true" /> SMALL COMPANION. SERIOUS
          REACH.
        </span>
        <h2 id="big-possibilities-title">
          Big <em>possibilities.</em>
        </h2>
        <p>
          That bigger “what if” you’ve been sitting on? There’s room for it
          here. A persistent computer, real tools, and a little initiative turn
          a good conversation into work that can keep moving.
        </p>
      </div>

      <div className={styles.foundation}>
        <article className={styles.computer}>
          <div className={styles.desktop} aria-hidden="true">
            <div className={styles.desktopBar}>
              <span>
                <i />
                <i />
                <i />
              </span>
              their own little corner of the cloud
              <Monitor size={14} />
            </div>
            <div className={styles.desktopBody}>
              <div className={styles.browserTab}>
                <Globe2 size={17} /> Browser
              </div>
              <div className={styles.terminalTab}>
                <Terminal size={17} /> Terminal
              </div>
              <div className={styles.fileTab}>
                <FileCode2 size={17} /> Working files
              </div>
              <span className={styles.desktopNote}>
                <MousePointer2 size={15} /> You can take the wheel.
              </span>
            </div>
          </div>
          <span className={styles.eyebrow}>AGENT37 + HERMES</span>
          <h3>A little computer. Real room to work.</h3>
          <p>
            Your companion runs on its own persistent cloud computer. It can
            browse websites, work with files, run commands and scripts, and use
            connected tools. A research brief can become a spreadsheet, a set of
            project files, or a finished draft you come back to later.
          </p>
          <p>
            Watch the visible desktop as it works. Take over the mouse and
            keyboard to handle a sign-in or lend a hand, then return control in
            the same browser. Your files and memory stay with your companion
            across conversations and restarts.
          </p>
        </article>
        <article className={styles.teamwork}>
          <div className={styles.workLoop} aria-hidden="true">
            <span>
              <Search size={20} /> Research
            </span>
            <ArrowRight size={16} />
            <span>
              <Terminal size={20} /> Build
            </span>
            <ArrowRight size={16} />
            <span>
              <FileCode2 size={20} /> Deliver
            </span>
          </div>
          <span className={styles.eyebrow}>WORK THAT JOINS THE DOTS</span>
          <h3>One brief. More than one kind of work.</h3>
          <p>
            Give your companion an outcome and the context that matters. It can
            combine web research, information from connected apps, and work on
            its computer in the same job. An idea can grow into a sourced
            report, a cleaned dataset, or a working prototype.
          </p>
          <p>
            Bring a messy CSV, a technical question, or a project with loose
            ends. The terminal can run code to inspect data and produce files;
            app tools can carry the result into the services you use. You can
            follow the work and answer when it needs your input.
          </p>
          <span className={styles.littleNote}>
            <Sprout size={17} aria-hidden="true" /> From “what if” to “here it
            is.”
          </span>
        </article>
      </div>

      <div className={styles.partnerIntro}>
        <div>
          <span className={styles.eyebrow}>GOOD COMPANY UNDER THE HOOD</span>
          <h3>One companion. A well-stocked toolbox.</h3>
        </div>
        <p>
          Search the web, work across your apps, reach for a specialist, and
          keep in touch. Each tool brings a different kind of possibility.
        </p>
      </div>
      <div className={styles.partners}>
        {partners.map((partner) => {
          const Icon = partner.icon;
          return (
            <article
              key={partner.name}
              className={`${styles.partner} ${styles[partner.color]}`}
            >
              <div className={styles.partnerTop}>
                <span className={styles.partnerIcon}>
                  <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <div>
                  <span className={styles.partnerName}>{partner.name}</span>
                  <span className={styles.category}>{partner.category}</span>
                </div>
              </div>
              <h4>{partner.title}</h4>
              <p>{partner.description}</p>
              <ul>
                {partner.features.map((feature) => (
                  <li key={feature}>
                    <ArrowRight size={14} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <span className={styles.availability}>
                {partner.availability}
              </span>
              <details className={styles.technical}>
                <summary>
                  <span>{partner.name}: under the hood</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div>
                  <p>{partner.technical}</p>
                  <a
                    href={partner.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {partner.link}
                    <ExternalLink size={13} aria-hidden="true" />
                    <span className={styles.srOnly}> (opens in a new tab)</span>
                  </a>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <div className={styles.engineering}>
        <div className={styles.engineeringIntro}>
          <span className={styles.eyebrow}>
            <Terminal size={16} aria-hidden="true" /> FOR THE CURIOUS MINDS
          </span>
          <h3>A peek at the machinery.</h3>
          <p>Real files. Real tools. A few details worth knowing.</p>
        </div>
        <div className={styles.engineeringDetails}>
          <details>
            <summary>
              <span>
                <BookOpen size={18} aria-hidden="true" /> Memory & your shared
                workspace
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <div>
              <p>
                Hermes keeps its persona in <code>SOUL.md</code> and native
                memory in <code>USER.md</code> and <code>MEMORY.md</code> on the
                computer. You can edit personality and memory in Settings;
                modification-time checks protect against overwriting newer
                edits.
              </p>
              <p>
                Tasks and wiki pages live in the application’s database. An
                authenticated workspace helper lets your companion read and
                update them, record work that needs your input, and send
                notifications. The wiki gives you shared, editable project
                knowledge alongside the agent’s own memory.
              </p>
            </div>
          </details>
          <details>
            <summary>
              <span>
                <Terminal size={18} aria-hidden="true" /> Tool discovery & live
                progress
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <div>
              <p>
                MCP gives the agent a common interface for discovering and
                calling tools. Composio searches for relevant app actions;
                Perflo lists specialist services. Browser and terminal tools
                handle work on the computer. Available tools and connected
                accounts determine what a particular job can use.
              </p>
              <p>
                Web chat streams the response and shows tool activity as the
                work happens. Response IDs and stored session history let the
                application recover interrupted streams. A tool starting is a
                progress signal; its result and the final response tell you what
                actually happened.
              </p>
              <a
                href="https://www.agent37.com/docs/agents-api/streaming"
                target="_blank"
                rel="noopener noreferrer"
              >
                Explore streamed responses
                <ExternalLink size={13} aria-hidden="true" />
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            </div>
          </details>
          <details>
            <summary>
              <span>
                <Wallet size={18} aria-hidden="true" /> Models, budgets & native
                approvals
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <div>
              <p>
                The companion uses Agent37’s managed model service, backed by an
                OpenAI-compatible router to OpenRouter. Provider credentials
                stay out of your browser. Model, search, app-tool, and Perflo
                usage share an operator-set managed-service cap; computer and
                Inkbox costs are accounted for separately.
              </p>
              <p>
                Your companion has full access to its computer. Hermes’ native
                approval behavior remains in place, with requests and blocked
                work surfaced through conversation and activity. Connected apps
                still require their own authorization, and messaging channels
                have their own setup and contact rules.
              </p>
              <a
                href="https://www.agent37.com/docs/agents-api/budgets"
                target="_blank"
                rel="noopener noreferrer"
              >
                Explore managed-service budgets
                <ExternalLink size={13} aria-hidden="true" />
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            </div>
          </details>
        </div>
      </div>

      <div className={styles.project}>
        <div className={styles.projectHeading}>
          <span className={styles.eyebrow}>
            AN EXAMPLE OF THE PIECES COMING TOGETHER
          </span>
          <h3>
            “Help me get this project <em>off the ground.</em>”
          </h3>
          <p>
            A big possibility can start with one sentence. Agree on the scope,
            connect the tools it needs, and let the little steps grow.
          </p>
        </div>
        <ol className={styles.projectSteps}>
          {projectSteps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.number}>
                <div className={styles.projectStepTop}>
                  <span>{step.number}</span>
                  <Icon size={21} aria-hidden="true" />
                </div>
                <h4>{step.title}</h4>
                <p>{step.text}</p>
              </li>
            );
          })}
        </ol>
        <div className={styles.projectFooter}>
          <span>
            <Sprout size={20} aria-hidden="true" /> Got a bigger “what if”?
          </span>
          <a href="#join-beta">
            Let’s make room for it
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
