"use client";

import { useId } from "react";

export function FeatureOverview({ color = "#7659e8" }: { color?: string }) {
  const id = useId();
  return (
    <svg
      className="feature-overview"
      viewBox="0 0 360 270"
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
      fill="none"
    >
      <title id={`${id}-title`}>
        A little workspace for everything that matters
      </title>
      <desc id={`${id}-description`}>
        Chat and calls, tasks, wiki notes, routines, connected apps, and a
        personal computer, illustrated as a collection of little tools working
        together.
      </desc>
      <defs>
        <radialGradient id={`${id}-wash`}>
          <stop stopColor={color} stopOpacity=".11" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <filter
          id={`${id}-shadow`}
          x="-30%"
          y="-30%"
          width="160%"
          height="170%"
        >
          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="5"
            floodColor="#806397"
            floodOpacity=".09"
          />
        </filter>
      </defs>
      <ellipse cx="183" cy="140" rx="166" ry="122" fill={`url(#${id}-wash)`} />
      <path
        d="M88 76C117 57 154 49 188 57S274 83 297 128S273 207 222 222S94 211 64 172S53 99 88 76Z"
        stroke="#ded2ed"
        strokeWidth="1.5"
        strokeDasharray="3 6"
      />
      <g strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M39 115v10m-5-5h10M315 92v10m-5-5h10M272 225v8m-4-4h8"
          stroke="#c4afd9"
          strokeWidth="2"
        />
        <circle cx="157" cy="30" r="3" fill="#eac973" />
        <circle cx="327" cy="133" r="3" fill="#a8c9b3" />
        <circle cx="99" cy="236" r="2.5" fill="#d8b4c8" />
        <ellipse cx="188" cy="228" rx="83" ry="9" fill="#eee7f5" />

        {/* A browser on their computer, with a task and a small conversation. */}
        <g filter={`url(#${id}-shadow)`}>
          <rect
            x="113"
            y="85"
            width="147"
            height="107"
            rx="12"
            fill="white"
            stroke="#d9cde8"
            strokeWidth="1.5"
          />
          <path
            d="M125 85h123a12 12 0 0 1 12 12v9H113v-9a12 12 0 0 1 12-12Z"
            fill="#f4effa"
          />
          <circle cx="123" cy="96" r="2" fill="#d6b6c8" />
          <circle cx="131" cy="96" r="2" fill="#e7cc88" />
          <circle cx="139" cy="96" r="2" fill="#aecab6" />
          <text
            x="192"
            y="100"
            textAnchor="middle"
            fill="#9784a8"
            fontSize="11"
          >
            Computer
          </text>
          <rect x="123" y="116" width="31" height="64" rx="5" fill="#f4effa" />
          <rect
            x="129"
            y="124"
            width="19"
            height="5"
            rx="2.5"
            fill={color}
            opacity=".45"
          />
          <path
            d="M130 140h15m-15 9h11m-11 9h14"
            stroke="#d4c5e4"
            strokeWidth="3"
          />
          <rect
            x="163"
            y="116"
            width="85"
            height="29"
            rx="6"
            fill="#faf8fd"
            stroke="#eee6f4"
          />
          <rect x="171" y="125" width="10" height="10" rx="3" fill="#e8f2e9" />
          <path d="m173.5 130 2 2 3-4" stroke="#89aa8e" strokeWidth="1.3" />
          <path d="M188 126h48m-48 8h29" stroke="#d3c3e4" strokeWidth="3" />
          <rect
            x="171"
            y="152"
            width="66"
            height="11"
            rx="5.5"
            fill={color}
            opacity=".16"
          />
          <rect x="163" y="168" width="51" height="10" rx="5" fill="#eef4ee" />
          <path d="M175 193v15m23-15v15" stroke="#d9cde8" strokeWidth="3" />
          <path d="M159 211h55" stroke="#d9cde8" strokeWidth="5" />
        </g>

        {/* Chat and voice. */}
        <g transform="rotate(-8 80 58)" filter={`url(#${id}-shadow)`}>
          <rect
            x="25"
            y="29"
            width="112"
            height="57"
            rx="11"
            fill="white"
            stroke="#e7dced"
          />
          <rect x="36" y="40" width="29" height="29" rx="9" fill="#edf4ee" />
          <path
            d="M43 47h15v11H49l-5 4v-4h-1Z"
            stroke="#87a890"
            strokeWidth="1.4"
          />
          <path d="M47 51h7m-7 3h4" stroke="#87a890" strokeWidth="1.3" />
          <text x="73" y="51" fill="#857095" fontSize="10" fontWeight="600">
            Chat + calls
          </text>
          <path
            d="M76 62v3m5-6v9m5-12v15m5-11v7m5-4v2"
            stroke="#b7cebd"
            strokeWidth="2.5"
          />
        </g>

        {/* A checked-off task. */}
        <g transform="rotate(9 289 60)" filter={`url(#${id}-shadow)`}>
          <rect
            x="242"
            y="31"
            width="92"
            height="62"
            rx="11"
            fill="white"
            stroke="#e7dced"
          />
          <circle cx="260" cy="50" r="8" fill="#f9f2dc" />
          <path d="m256 50 3 3 5-6" stroke="#c4aa59" strokeWidth="1.7" />
          <text x="275" y="54" fill="#857095" fontSize="11" fontWeight="600">
            Tasks
          </text>
          <path
            d="M254 70h9m7 0h49m-65 10h9m7 0h34"
            stroke="#e4d8ee"
            strokeWidth="3"
          />
        </g>

        {/* A page of knowledge. */}
        <g transform="rotate(-7 64 180)" filter={`url(#${id}-shadow)`}>
          <rect
            x="19"
            y="149"
            width="88"
            height="65"
            rx="11"
            fill="white"
            stroke="#e7dced"
          />
          <path
            d="M34 161h18l7 7v27H34Z"
            fill="#f3edf9"
            stroke="#c9b5df"
            strokeWidth="1.3"
          />
          <path
            d="M52 161v8h7m-19 8h12m-12 6h8"
            stroke="#c9b5df"
            strokeWidth="1.3"
          />
          <text x="67" y="176" fill="#857095" fontSize="11" fontWeight="600">
            Wiki
          </text>
          <path d="M67 185h25m-25 6h17" stroke="#e4d8ee" strokeWidth="3" />
        </g>

        {/* A recurring little check-in. */}
        <g transform="rotate(7 299 184)" filter={`url(#${id}-shadow)`}>
          <rect
            x="249"
            y="153"
            width="102"
            height="62"
            rx="11"
            fill="white"
            stroke="#e7dced"
          />
          <circle cx="270" cy="173" r="10" fill="#f9eff3" />
          <path
            d="M270 167v7l4 2m4-11a11 11 0 1 0 3 15m-3-15 4 1-1-4"
            stroke="#c392ac"
            strokeWidth="1.4"
          />
          <text x="286" y="177" fill="#857095" fontSize="10" fontWeight="600">
            Routines
          </text>
          <path
            d="M262 199h6m7 0h6m7 0h6m7 0h6m7 0h15"
            stroke="#ead6e0"
            strokeWidth="3"
          />
        </g>

        {/* Connected tools, without favoring a particular app. */}
        <g filter={`url(#${id}-shadow)`}>
          <rect
            x="112"
            y="234"
            width="147"
            height="29"
            rx="14.5"
            fill="white"
            stroke="#e7dced"
          />
          <rect
            x="123"
            y="242"
            width="12"
            height="12"
            rx="4"
            fill={color}
            opacity=".32"
          />
          <rect x="131" y="238" width="12" height="12" rx="4" fill="#b7d1bc" />
          <rect x="139" y="244" width="12" height="12" rx="4" fill="#ead09a" />
          <text x="160" y="253" fill="#857095" fontSize="10" fontWeight="600">
            Connected apps
          </text>
        </g>
      </g>
    </svg>
  );
}
