---
name: elite-web-design
description: Master operating system for building or redesigning ANY website, landing page or web app UI (including the FocusFlow planner site). Makes Claude work as a senior digital studio - art direction, typography, composition, UX, motion (GSAP), optional purposeful 3D, accessibility, performance, and mandatory browser/visual QA - instead of producing a generic AI template. Use whenever the user asks to build, design, redesign, polish or "make professional" a website, page, landing page, hero, or frontend, even if they don't mention this skill.
---

# Elite Web Design / UI-UX / Motion / 3D Master System

Operate as an elite multidisciplinary digital product team (creative direction, UI, UX, product, frontend, design systems, motion, interaction, 3D/WebGL, brand, typography, conversion, accessibility, performance, QA). The result must feel deliberate, custom, polished, memorable, responsive, fast and production-ready - never a generic AI template.

**Before starting any website task, read `references/master-brief.md` in full.** It is the user's complete brief (53 sections) and is binding. This file is the operational summary.

## 1. Skill capability map (use these - don't just have them)

| Skill | Purpose | Where it's used |
|---|---|---|
| `frontend-design` | Aesthetic direction, anti-template choices | Phase 4 art direction, every visual decision |
| `ui-ux-pro-max` | Searchable styles, palettes, font pairings, 119 UX rules, stack guides | Phases 3-6: run its `scripts/search.py "<product> <industry>" --design-system`, then `--domain ux/typography/color` and `--stack <stack>` |
| `gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`, `gsap-utils` | Correct GSAP usage, timelines, ScrollTrigger, SplitText etc. | Phase 11 motion system, hero choreography, scroll storytelling |
| `gsap-react` / `gsap-frameworks` | `useGSAP`, scoping, cleanup on unmount | Any GSAP inside React/Next.js or Vue/Svelte |
| `gsap-performance` | Transforms-only, no layout thrash, batching | Phase 14, any jank |
| `webapp-testing` | Playwright: run app, screenshots, console logs, interaction | Phases 15-19 - mandatory visual QA at multiple widths |
| `dataviz` (built-in) | Charts, stat tiles | Only if the site shows data |

Re-check what's installed at the start of each project (`ls .claude/skills ~/.claude/skills`). For 3D, only if the project genuinely needs it: evaluate a Three.js / React Three Fiber skill then (candidates seen: `EnzeD/r3f-skills`, `CloudAI-X/threejs-skills`, `OpenAEC-Foundation/Three.js-Claude-Skill-Package` - third-party, inspect before installing). Never install unverified or unnecessary skills.

## 2. Workflow (never skip, never start by randomly editing)

INSPECT → UNDERSTAND → RESEARCH → AUDIT → PLAN → DESIGN → IMPLEMENT → TEST → VISUALLY INSPECT → ROOT-CAUSE → FIX → RETEST → OPTIMIZE → VERIFY

Phases: 1 repo/env audit · 2 skill check · 3 UX/content audit · 4 art direction · 5 tokens/design system · 6 global shell (bg, type, nav, layout, footer) · 7 hero · 8 core sections · 9 interactive components · 10 responsive/mobile · 11 motion system · 12 advanced visual/3D · 13 accessibility · 14 performance · 15 functional tests · 16 visual QA · 17 bug fixing · 18 regression · 19 final verification. No giant blind rewrite; preserve working business logic.

## 3. Non-negotiables (details in the brief)

- **No generic AI look:** no default giant gradient headline, glow blobs, glassmorphism everywhere, purple/blue neon, identical rounded cards, icon+title+paragraph grids, endless centered layouts, excessive pills/shadows/radius. Every visual decision has a reason.
- **Art direction first:** personality, audience, primary action, emotional goal, tone, type, color philosophy, layout, imagery, motion language, depth, interaction style - one coherent language.
- **Systems, not magic numbers:** tokens for color (semantic: bg, surfaces, text tiers, accent/hover, border, success/warning/error, focus, disabled), type scale (display→metadata, fluid `clamp()`), spacing, radii, shadows, motion (duration, easing, distance, stagger, enter/exit/hover/press/page), breakpoints, z-index.
- **Hierarchy in ~1 second:** what is it, why care, where to look, what to do next.
- **Motion has purpose** (hierarchy, feedback, orientation, continuity). CSS when enough, GSAP for timelines/scroll; always clean up triggers. Full `prefers-reduced-motion` support.
- **3D only with purpose**, lazy-loaded, optimized, paused offscreen, with fallback. A beautiful 20 FPS site is a failed site.
- **Every component state:** default, hover, active, focus, disabled, loading, error, success, empty.
- **Mobile is designed, not shrunk:** test real widths (≈320, 375, 414, 768, 1024, 1280, 1440, 1920). No overflow, clipped text, tiny targets, hover-only essentials.
- **Accessibility is engineering:** semantic HTML, keyboard, visible focus, labels, contrast ≥4.5:1, alt text, logical headings.
- **Performance is a design constraint:** LCP, CLS, INP; optimized images/fonts/SVG, minimal JS, lazy non-critical assets. Ask "value vs. cost?" for every heavy addition.
- **Progressive enhancement:** core → CSS polish → interactions → motion → 3D/effects.
- **Honest content & conversion:** never fabricate stats, testimonials, customers, reviews, awards, scarcity, timers or activity. No dark patterns.
- **Library policy:** inspect what exists first; smallest dependable solution. Options (not mandates): React, Next.js, TypeScript, Tailwind, CSS Modules, Motion, GSAP, Three.js/R3F/Drei, Lenis, Radix, shadcn/ui, Lucide, Playwright.

## 4. Definition of done

Runs; existing functionality works; coherent design; responsive verified at real widths; mobile genuinely usable; smooth purposeful motion; 3D optimized if used; no layout bugs; no avoidable console errors; a11y basics; reduced motion; optimized assets; critical interactions clicked through in a real browser; screenshots taken and inspected; regressions checked; feels custom.

## 5. Autonomy

Make reversible, low-risk professional decisions without asking. Ask only for credentials, irreversible/destructive actions, money, genuinely missing critical info, or product decisions that can't be inferred (e.g. what the site is for, when the repo gives no clue).

## 6. Final report format

1 Skills installed/used · 2 Design direction · 3 Major changes · 4 Motion/interactions · 5 3D/advanced graphics · 6 Responsive work · 7 Accessibility · 8 Performance · 9 Tests performed · 10 Bugs found and fixed · 11 Remaining limitations · 12 Final verification status.

## Known upcoming project: FocusFlow

FocusFlow is the user's ADHD/neurodivergent-focused digital planner: $14 one-time planner, $7/month "Vault" subscription. When building its site, the audience is people with ADHD - favor low cognitive load, calm focus, clear single CTAs, transparent pricing, no manipulative urgency. Use only real proof the user supplies.
