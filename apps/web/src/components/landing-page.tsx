"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  Flower2,
  Heart,
  Lightbulb,
  ListTodo,
  MessageCircle,
  Paperclip,
  Sparkles,
  Sprout,
} from "lucide-react";
import { Brand } from "./companion";
import { BigPossibilities } from "./big-possibilities";
import styles from "./landing-page.module.css";

const examples = [
  {
    name: "Tasks",
    icon: ListTodo,
    category: "TASKS",
    heading: "The next step, without the mental clutter.",
    description:
      "Give your companion an ongoing responsibility or a one-off task. You both see the same list, including progress and anything that needs your input.",
    prompt: "My week is a bit of a jumble. Where do I start?",
    reply:
      "Let’s turn the jumble into a few small steps. What has a deadline, and what can wait?",
    artifact: "A little breathing room",
    items: [
      "Pick the three things that matter",
      "Break the big thing into little things",
      "Leave room for real life",
    ],
  },
  {
    name: "Wiki",
    icon: BookOpen,
    category: "WIKI",
    heading: "A home for ideas as they grow.",
    description:
      "Keep notes, preferences, and project context in a shared wiki. You can edit it, and your companion can read and update it as your plans take shape.",
    prompt: "I have an idea, three notes, and no idea where I put them.",
    reply:
      "Start with the messy version. We can give it a home in your wiki and figure out the next step together.",
    artifact: "The idea garden",
    items: [
      "The spark: what we’re making",
      "A place for useful notes",
      "Next up: a tiny first experiment",
    ],
  },
  {
    name: "Routines",
    icon: Clock3,
    category: "ROUTINES",
    heading: "A little rhythm goes a long way.",
    description:
      "Set a reminder or a repeating routine with instructions for your companion. Scheduled work can wake their computer and give them something useful to do between chats.",
    prompt: "Can we make Sunday planning a thing?",
    reply:
      "Absolutely. Tell me a time and what you’d like to review. We can make a little routine out of it.",
    artifact: "Sunday, a little softer",
    items: [
      "Look back at the week",
      "Gather loose ends",
      "Make a little plan for Monday",
    ],
  },
];

export function LandingPage({ signup }: { signup: ReactNode }) {
  return (
    <main className={styles.page}>
      <a href="#join-beta" className={styles.skipLink}>
        Skip to beta signup
      </a>
      <header className={styles.header}>
        <Link
          href="/"
          aria-label="Potato Potential home"
          className={styles.brand}
        >
          <Brand />
        </Link>
        <nav aria-label="Homepage" className={styles.navigation}>
          <a href="#possibilities">Little possibilities</a>
          <a href="#big-possibilities">Big possibilities</a>
        </nav>
        <div className={`welcome-navigation ${styles.account}`}>
          <Link href="/signin">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <Sprout size={17} /> A SMALL COMPANION. A WORLD OF POTENTIAL.
          </span>
          <h1 id="landing-title">
            Less on <br />
            your plate.
            <br />
            <span>More possibility.</span>
          </h1>
          <p className={styles.introduction}>
            A personal AI companion with a computer of their own. For your big
            ideas, everyday tasks, and all the little things in between.
          </p>
          <section
            id="join-beta"
            aria-label="Join the beta"
            tabIndex={-1}
            className={styles.signup}
          >
            {signup}
          </section>
        </div>

        <div className={styles.collage}>
          <div className={styles.collageBlob} aria-hidden="true" />
          <div className={styles.helloNote}>
            <MessageCircle size={20} />
            <span>
              Big day?
              <br />
              <strong>Let’s make a little room.</strong>
            </span>
            <span className={styles.noteTail} aria-hidden="true" />
          </div>
          <div className={styles.todoSticker}>
            <Paperclip
              size={24}
              className={styles.paperclip}
              aria-hidden="true"
            />
            <span className={styles.handwritten}>a little less “later”</span>
            <span>
              <Check size={14} /> The everyday stuff
            </span>
            <span>
              <Check size={14} /> That big idea
            </span>
            <span className={styles.unchecked}>
              <span aria-hidden="true" /> A bit more you-time
            </span>
          </div>
          <Image
            src="/brand/potato-potential-mascots.png"
            alt="Four cheerful Potato Potential companions, ready to lend a little help."
            width={1134}
            height={899}
            sizes="(max-width: 640px) 90vw, (max-width: 1000px) 65vw, 600px"
            preload
            className={styles.mascots}
          />
          <div className={styles.ideaSticker}>
            <BookOpen size={23} />
            <span>
              Good ideas
              <br />
              <strong>grow here.</strong>
            </span>
          </div>
          <div className={styles.friendBadge}>
            <Heart size={16} /> In your corner.
          </div>
          <Sparkles className={styles.sparkOne} size={34} aria-hidden="true" />
          <Flower2 className={styles.sparkTwo} size={42} aria-hidden="true" />
          <svg
            className={styles.doodleArrow}
            viewBox="0 0 120 75"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 9C57-5 101 9 91 35C81 59 49 42 65 27C80 13 111 41 106 65M95 57L106 66L117 55"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className={styles.collageCaption}>
            A little team of two. A whole lot of possibility.
          </span>
        </div>
      </section>

      <div className={styles.ribbon}>
        <span>A little help starts here</span>
        <ArrowDown size={18} aria-hidden="true" />
        <span>Big ideas welcome. Messy notes, too.</span>
      </div>

      <section
        id="possibilities"
        className={styles.possibilities}
        aria-labelledby="possibilities-title"
      >
        <div className={styles.sectionIntro}>
          <span className={styles.eyebrow}>
            <Sparkles size={16} /> THE LITTLE THINGS ADD UP
          </span>
          <h2 id="possibilities-title">
            Little <em>possibilities</em>
          </h2>
          <p>
            You bring the wonderfully human stuff.
            <br />
            Your companion helps you find a way through it.
          </p>
        </div>
        <div className={styles.exampleLayout}>
          {examples.map((example) => {
            const Icon = example.icon;
            const titleId = `${example.category.toLowerCase()}-title`;
            return (
              <article
                key={example.name}
                className={styles.exampleCard}
                aria-labelledby={titleId}
              >
                <div className={styles.exampleDescription}>
                  <h3 id={titleId}>
                    <Icon size={22} aria-hidden="true" /> {example.name}
                  </h3>
                  <h4>{example.heading}</h4>
                  <p>{example.description}</p>
                </div>
                <div className={styles.examplePaper}>
                  <div className={styles.paperHeading}>
                    <span>
                      <span aria-hidden="true" /> A LITTLE WHAT-IF
                    </span>
                    <Sparkles size={17} aria-hidden="true" />
                  </div>
                  <div className={styles.chatExample}>
                    <span className={styles.speaker}>YOU</span>
                    <p className={styles.youBubble}>{example.prompt}</p>
                    <span className={styles.speaker}>
                      <Sprout size={14} aria-hidden="true" /> YOUR COMPANION
                    </span>
                    <p className={styles.companionBubble}>{example.reply}</p>
                  </div>
                  <div className={styles.artifact}>
                    <div className={styles.artifactTitle}>
                      <Icon size={19} aria-hidden="true" />
                      <h5>{example.artifact}</h5>
                      <span>EXAMPLE</span>
                    </div>
                    <ul>
                      {example.items.map((item) => (
                        <li key={item}>
                          <span
                            className={styles.artifactCheck}
                            aria-hidden="true"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className={styles.sampleNote}>
                    A few ideas to start with. You make it your own.
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <BigPossibilities />

      <footer className={styles.footer}>
        <Link
          href="/"
          aria-label="Potato Potential home"
          className={styles.brand}
        >
          <Brand />
        </Link>
        <a className={styles.studioLink} href="https://venatiostudios.com/">
          Venatio Studios 2026
        </a>
        <a href="#join-beta">
          Let’s grow something good <Sprout size={18} />
        </a>
      </footer>
    </main>
  );
}
