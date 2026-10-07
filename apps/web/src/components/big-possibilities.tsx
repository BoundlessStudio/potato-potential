import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileCode2,
  Globe2,
  Mail,
  MessageCircle,
  Monitor,
  MousePointer2,
  Phone,
  Search,
  Sparkles,
  Sprout,
  Terminal,
  Wallet,
} from "lucide-react";
import styles from "./big-possibilities.module.css";

// Capability descriptions checked against Agent37's full docs on 2026-10-06.
// Catalog examples checked against Composio toolkits and perflo.ai/marketplace.
// Keep provider capabilities distinct from channels and tools enabled in a workspace.
const partners = [
  {
    name: "Brave",
    category: "WEB RESEARCH",
    logo: "/brand/services/brave.svg",
    integrations: [],
    color: "peach",
    title: "A very useful rabbit hole.",
    description:
      "Spend less time opening tabs and more time deciding. Brave Search helps your companion find current information on the web. They can open the sources, compare the details, and bring you a useful answer with links you can check.",
    services:
      "Web results, searches by country and language, and freshness filters for recent information.",
    features: [
      "Compare tools for your next project, including features, pricing, and tradeoffs.",
      "Research a destination and gather places, opening hours, and useful local information.",
      "Catch up on a topic with a short brief that keeps the sources beside the findings.",
    ],
    example:
      "Compare three newsletter platforms for my small business. Include current pricing and links to the sources.",
    outcome:
      "A comparison you can use to choose, with the research already gathered.",
    technical:
      "Managed Brave search uses an HTTP API, with query, country, language, and freshness options. Search finds the pages; the companion’s browser reads them.",
    availability: "Managed search on the companion’s computer",
    href: "https://www.agent37.com/docs/agents-api/managed-services#web-search",
    link: "Read about managed Brave search",
  },
  {
    name: "Composio",
    category: "CONNECTED APPS",
    logo: "/brand/services/composio.png",
    integrations: [
      { name: "Gmail", logo: "/brand/services/gmail.svg" },
      { name: "Google Calendar", logo: "/brand/services/googlecalendar.svg" },
      { name: "Slack", logo: "/brand/services/slack.svg" },
      { name: "Notion", logo: "/brand/services/notion.svg" },
      { name: "GitHub", logo: "/brand/services/github.svg" },
    ],
    color: "mint",
    title: "Your apps, pulling together.",
    description:
      "Give your companion useful context from the apps you already use, then ask them to help move the work forward. Composio connects your accounts so a conversation can become a calendar event, a document update, or a project task.",
    services:
      "A few examples from the app catalog. Connect the accounts you want to use in Apps.",
    features: [
      "Gmail + Google Calendar: find an email thread, draft a reply, or schedule a follow-up.",
      "Slack + Notion: gather project updates and turn them into a shared summary or next steps.",
      "GitHub: read issues and pull requests, then create or update an issue for the work ahead.",
    ],
    example:
      "Summarize this week’s project updates from Slack and add the decisions and next steps to our Notion page.",
    outcome: "A current project summary in the place your team already checks.",
    technical:
      "Composio exposes tools through MCP (Model Context Protocol). The agent discovers actions as needed instead of loading the entire catalog. Connections are scoped to its instance and survive restarts; app availability and authorization requirements vary.",
    availability: "Connect your accounts in Apps",
    href: "https://www.agent37.com/docs/agents-api/integrations",
    link: "Read about app connections",
  },
  {
    name: "Perflo",
    category: "SPECIALIST TOOLS",
    logo: "/brand/services/perflo.svg",
    integrations: [
      { name: "Apify", logo: "/brand/services/apify.svg" },
      { name: "Exa", logo: "/brand/services/exa.svg" },
      { name: "Google Maps", logo: "/brand/services/googlemaps.png" },
    ],
    color: "butter",
    title: "A little help from the specialists.",
    description:
      "Reach for a specialist when a job needs more than a web search. Perflo lets your companion buy individual tool calls for web data, research, lookups, enrichment, and creative work. You can get a specific result without setting up a separate subscription with each vendor.",
    services:
      "Available services and prices are listed in the live catalog; each paid call uses the managed-service budget.",
    features: [
      "Web data: collect structured information from sites for a spreadsheet or comparison.",
      "Research and lookups: find companies, people, or places and fill gaps in a working dataset.",
      "Creative services: discover generation tools for a project and check the price before choosing one.",
    ],
    example:
      "Find a service that can collect public coworking-space listings for my city. Show me the price before running it.",
    outcome:
      "A specialist tool for the job, with a per-call cost instead of another subscription.",
    technical:
      "The Perflo MCP server provides list_services, spend, pay, and get_task_result. Discovery is free. pay accepts a maxCharge checked before payment; spend chooses a vendor and reports the final charge. Tool availability depends on the installed desktop image and configuration.",
    availability: "Paid tools · desktop image dependent",
    href: "https://www.agent37.com/docs/agents-api/managed-services#paid-tools",
    link: "Read about managed Perflo tools",
  },
  {
    name: "Inkbox",
    category: "MESSAGES, EMAIL & CALLS",
    logo: "/brand/services/inkbox.png",
    integrations: [
      { name: "Email", icon: Mail },
      { name: "iMessage", icon: MessageCircle },
      { name: "Voice calls", icon: Phone },
    ],
    color: "lilac",
    title: "A ‘hey’ away from your day.",
    description:
      "Keep your companion close when you’re away from the web workspace. Inkbox gives them their own email inbox and supported messaging channels. Forward a thread, send a thought from your phone, or receive an update when there’s something useful to share.",
    services:
      "An email address, an iMessage connection, and hosted voice calls. SMS is available when enabled for the account; your workspace provides the channel setup instructions.",
    features: [
      "Email: forward a long thread and ask for the key decisions, dates, and a draft reply.",
      "iMessage: capture a thought, check on a task, or ask a quick question from your phone.",
      "Voice: talk through an idea with the hosted voice assistant; your companion receives the transcript afterward.",
    ],
    example:
      "I’ve forwarded the venue’s email. Pull out the dates and questions I need to answer, and draft a reply.",
    outcome:
      "Useful follow-through from the conversations you already have during your day.",
    technical:
      "Signed webhooks deliver incoming events and can wake the computer. Web, text, and email conversations share Hermes’ native memory. Hosted voice has its own instructions and sends Hermes a transcript afterward, rather than reading its memory live. Phone ownership and channel setup come first.",
    availability: "Complete the channel setup in your workspace",
    href: "https://www.agent37.com/docs/agents-api/imessage",
    link: "Read about Inkbox channels and voice",
  },
] as const;

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
          <span className={styles.eyebrow}>THEIR OWN CLOUD COMPUTER</span>
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
          <span className={styles.eyebrow}>GOOD COMPANY</span>
          <h3>One companion. A well-stocked toolbox.</h3>
        </div>
        <p>
          Search the web, work across your apps, reach for a specialist, and
          keep in touch. Each tool brings a different kind of possibility.
        </p>
      </div>
      <div className={styles.partners}>
        {partners.map((partner) => (
          <article
            key={partner.name}
            className={`${styles.partner} ${styles[partner.color]}`}
            aria-labelledby={`${partner.name.toLowerCase()}-title`}
          >
            <div className={styles.partnerTop}>
              <span className={styles.partnerIcon}>
                <Image
                  src={partner.logo}
                  alt={`${partner.name} logo`}
                  width={32}
                  height={32}
                />
              </span>
              <div>
                <h4
                  id={`${partner.name.toLowerCase()}-title`}
                  className={styles.partnerName}
                >
                  {partner.name}
                </h4>
                <span className={styles.category}>{partner.category}</span>
              </div>
            </div>
            <h5 className={styles.partnerTitle}>{partner.title}</h5>
            <p>{partner.description}</p>
            <div className={styles.services}>
              <h6>What’s available</h6>
              {partner.integrations.length > 0 && (
                <ul
                  className={styles.integrationList}
                  aria-label={`${partner.name} integrations`}
                >
                  {partner.integrations.map((integration) => {
                    const Icon =
                      "icon" in integration ? integration.icon : null;
                    return (
                      <li key={integration.name}>
                        {"logo" in integration ? (
                          <Image
                            src={integration.logo}
                            alt=""
                            width={18}
                            height={18}
                          />
                        ) : (
                          Icon && <Icon size={18} aria-hidden="true" />
                        )}
                        <span>{integration.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p>{partner.services}</p>
            </div>
            <ul>
              {partner.features.map((feature) => (
                <li key={feature}>
                  <ArrowRight size={14} aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className={styles.example}>
              <h6>Try asking</h6>
              <blockquote>“{partner.example}”</blockquote>
              <p>{partner.outcome}</p>
            </div>
            <span className={styles.availability}>{partner.availability}</span>
          </article>
        ))}
      </div>

      <section className={styles.engineering} aria-labelledby="machinery-title">
        <div className={styles.engineeringIntro}>
          <span className={styles.eyebrow}>
            <Terminal size={16} aria-hidden="true" /> FOR THE CURIOUS MINDS
          </span>
          <h3 id="machinery-title">A peek at the machinery.</h3>
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
          {partners.map((partner) => (
            <details key={partner.name}>
              <summary>
                <span>
                  <Image src={partner.logo} alt="" width={18} height={18} />{" "}
                  {partner.name}: under the hood
                </span>
                <ChevronDown size={17} aria-hidden="true" />
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
          ))}
        </div>
      </section>
    </section>
  );
}
