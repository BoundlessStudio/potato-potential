# Potato Potential social card

Created on 2026-10-06 with the built-in imagegen tool and the imagegen skill. The supplied wordmark and mascot cluster were the inputs. Existing source branding assets were preserved.

Published asset: `apps/web/public/social/potato-potential-social-v1.png`.

Dimensions: 1733 × 907 pixels (approximately 1.91:1). Opaque PNG, 1,357,155 bytes. The original generated image was copied into the workspace without resampling or changing its artwork. Open Graph and X metadata declare the same public asset, actual dimensions and descriptive alternative text. Change the versioned filename when replacing the artwork to avoid stale sharing caches.

Site metadata is centralized in `apps/web/src/lib/site.ts` and uses the production custom domain as its canonical origin. Root metadata includes the search title, description, Open Graph, X large-image card, application name and structured data for the website, organization and application. It makes no pricing or rating claims. The homepage is the only URL in the sitemap. Sign-in, operator pages and connection confirmation carry noindex metadata; service endpoints have noindex response headers and are excluded by robots.txt.

The public introduction is included in the initial homepage HTML, before the browser checks for an existing account. Beta submission remains disabled until that check finishes. Authenticated workspace data is loaded through the existing account-scoped APIs.

## Generation prompt

```text
Use case: compositing.
Asset type: Potato Potential website social sharing card, opaque landscape 1200 x 630 composition, 1.91:1 ratio.
Primary request: Expand and compose the supplied Potato Potential brand artwork into a finished, polished social preview card for a personal AI companion website.
Input images: Image 1 is the existing brand wordmark to preserve: use its exact lowercase black rounded "potato potential" lettering as the wordmark, without duplicating its small mascot icon. Image 2 is supporting mascot artwork: preserve the four characters, colors, expressions and identifying shapes and use this cluster once as the main illustration.
Scene/backdrop: airy warm off-white and pale lavender background, subtle purple arcs and tiny sparkles, refined soft shadows. No transparency.
Composition/framing: wordmark and clear large headline in a spacious left text column; the cheerful cluster fills the right half. A few small floating rounded feature tiles around the cluster show a chat bubble, a checklist, a shared notebook and a clock, illustrating chat, tasks, wiki and routines. Keep all important artwork and text at least 60px from edges.
Style/medium: premium playful SaaS editorial illustration, clean typography, soft colorful mascot rendering matching the original supplied artwork; calm, confident and useful, not childish or cluttered.
Color palette: lavender, vivid violet, cream, charcoal lettering, plus the mascots' original purple, orange, blue and pink.
Text (verbatim): lowercase wordmark "potato potential"; headline split into three deliberate lines "A little help." / "A lot of" / "possibility."; supporting line "Your personal AI companion."; small footer badge "Join the beta".
Typography: large rounded modern sans-serif headline, charcoal and purple accent on "possibility.", excellent readability at thumbnail size.
Constraints: retain original mascot identities and original wordmark spelling. Only the exact quoted text, no extra slogans or URL, no fake application screenshots, no watermarks. Output a complete finished card, not a card inside a mockup.
```
