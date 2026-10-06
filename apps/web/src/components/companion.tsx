"use client";
import Image from "next/image";
import type { Profile } from "@boundless/shared";
export function Companion({
  avatar = "sprout",
  color = "#7659e8",
  size = 64,
  className = "",
  scene = false,
}: {
  avatar?: Profile["avatar"];
  color?: string;
  size?: number;
  className?: string;
  scene?: boolean;
}) {
  const body =
    avatar === "pebble"
      ? "M31 100Q10 66 37 34Q62 12 92 33Q130 67 108 104Q69 129 31 100Z"
      : avatar === "spark"
        ? "M70 20L91 38L112 44L108 67L118 90L96 100L78 117L58 108L33 110L27 87L16 68L34 50L43 27Z"
        : "M28 94Q18 63 35 39Q52 19 77 23Q108 25 112 59L115 86Q113 113 86 115L53 115Q29 114 28 94Z";
  return (
    <svg
      className={className}
      width={size}
      height={scene ? size * 0.78 : size}
      viewBox={scene ? "-70 -30 280 218" : "0 0 140 140"}
      role="img"
      aria-label={`${avatar} companion`}
    >
      {scene && (
        <>
          <path d="M-60 139Q60 107 200 139V180H-60Z" fill="#ede9f5" />
          <circle cx="-25" cy="35" r="5" fill="#e7c672" />
          <path
            d="M174 17v13m-6-6h12"
            stroke="#b8a4d6"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M159 97q10-20 21-9t-5 26"
            stroke="#bacac4"
            fill="none"
            strokeWidth="3"
          />
          <path d="M-31 117q-4-20-16-20q-10 7 4 16" fill="#bad5b7" />
          <ellipse cx="70" cy="137" rx="61" ry="9" fill="#dcd5e9" />
        </>
      )}
      <ellipse cx="70" cy="126" rx="39" ry="5" fill="#241e42" opacity=".09" />
      {avatar === "orbit" && (
        <ellipse
          cx="70"
          cy="70"
          rx="65"
          ry="18"
          transform="rotate(-22 70 70)"
          fill="none"
          stroke="#e2bc65"
          strokeWidth="7"
        />
      )}
      <path d={body} fill={color} />
      <path
        d={body}
        fill="white"
        opacity=".18"
        transform="translate(0 -5) scale(.9)"
      />
      {avatar === "sprout" && (
        <>
          <path
            d="M69 26Q70 11 70 7"
            stroke="#315b43"
            strokeWidth="4"
            fill="none"
          />
          <path d="M70 13Q40-1 42 14Q49 30 70 13" fill="#a1c88b" />
          <path d="M70 13Q91-4 95 10Q91 23 70 13" fill="#6d9d65" />
        </>
      )}
      <ellipse cx="54" cy="69" rx="4.2" ry="6.2" fill="#302444" />
      <ellipse cx="87" cy="69" rx="4.2" ry="6.2" fill="#302444" />
      <circle cx="52.5" cy="67" r="1.4" fill="white" />
      <circle cx="85.5" cy="67" r="1.4" fill="white" />
      <path
        d="M64 82Q71 89 78 82"
        fill="none"
        stroke="#302444"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse cx="44" cy="82" rx="8" ry="4.5" fill="#f6b3b3" opacity=".5" />
      <ellipse cx="98" cy="82" rx="8" ry="4.5" fill="#f6b3b3" opacity=".5" />
      <path
        d="M35 96Q18 91 19 76M107 95Q124 88 123 75"
        stroke={color}
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <Image
        src="/brand/potato-potential-wordmark.png"
        className="brand-image"
        width={1644}
        height={482}
        sizes="(max-width: 760px) 180px, 220px"
        alt="Potato Potential"
        loading="eager"
      />
    </div>
  );
}
