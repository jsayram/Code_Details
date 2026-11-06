# Code Details design foundations

The current visual system for the UI refresh, written from the accepted UI01 brief and tuned in UI03. It replaces the mix of old and new notes in `Agent Planning/design-reference/DESIGN.md`, which stays as history. The tokens themselves live in `src/styles/foundations.css`.

**Status:** preview only. No existing page uses these tokens. To see them, run the app in development, sign in as an admin and open `/dashboard/admin/design-foundations`. Production answers 404 there.

## Principles

- One clear order on every screen, one main action, fast response.
- Personality comes from content and imagery: the mascot, the terminal, the humor. Simple doesn't mean plain.
- Blue means you can act on it. Red, green and amber mean status. Nothing else is colored for decoration.
- Purple stays in the mascot's hood and the logo. Category label colors stay for now and get reviewed in UI06.

## Type

One system family, with no font files and nothing loaded from a third party. It's the stack Tailwind already gives every page, so adopting it changes no glyphs. Monospace is for commands, code and particles only.

| Role | Size | Weight | Use |
|---|---|---|---|
| Display | 36 to 64px | 600 | Home headline only |
| Title | 28 to 36px | 600 | The page's `h1`, one per page |
| Heading | 24px | 600 | Section titles |
| Subheading | 20px | 500 | Card and group titles |
| Lead | 18px | 400 | Introductions |
| Body | 16px, line height 1.625 | 400 | Everything you read |
| Small | 14px | 400 | Controls and metadata |
| Caption | 12px, muted | 400 | The smallest size allowed |

Sizes are in `rem`, so they follow browser zoom and the app's larger root size at 1920px and 2560px. Text uses solid colors only.

## Spacing and layout

- Spacing runs on a 4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Pages share one 72rem width and a gutter from 16 to 40px. Reading text stops at 68 characters.
- Controls are 44px tall. Compact density drops them to 36px on a mouse and keeps 44px on touch.
- Surfaces use 16 to 20px corners, actions are pills, and normal controls keep 10px corners so they still look like controls.
- Long unbroken strings wrap (`.cd-wrap`) and flex children can shrink, so one long word can't widen a page.
- Each page has one `main` and one `h1`.

## Color

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--cd-bg` | `#f5f6f7` | `#171b1f` | Page background |
| `--cd-surface` | `#ffffff` | `#1f2429` | Cards, popovers |
| `--cd-raised` | `#eceef0` | `#2a3036` | Hover, secondary controls |
| `--cd-text` | `#202326` | `#f0f3f5` | Text |
| `--cd-muted` | `#565d64` | `#adb5bd` | Secondary text |
| `--cd-border-subtle` | `#d9dde1` | `#343b42` | Decorative hairlines |
| `--cd-border-control` | `#7c848c` | `#7f8892` | Borders that identify a control |
| `--cd-action` | `#005fb8` | `#92caff` | Actions, links, focus |
| `--cd-selected` | `#e1eefb` | `#1e3a54` | Selected background |
| `--cd-success` | `#176a33` | `#7bd99a` | Status |
| `--cd-warning` | `#7f5300` | `#f0c869` | Status |
| `--cd-danger` | `#b3261e` | `#ffa79e` | Status, destructive actions |

Text pairs reach 4.5:1 and control borders and focus rings reach 3:1 in both themes. `tests/unit/ui03-foundations-tokens.test.ts` reads the stylesheet and enforces this, along with the no-purple rule. Stronger values apply under `prefers-contrast: more`, and surfaces gain a border in forced-colors mode. Nothing uses transparency, so reduced transparency needs no fallback yet.

## Controls and states

- Focus is a solid 2px ring with a 2px offset on every control.
- Disabled controls use a solid surface and stay readable, instead of dimming to half opacity.
- Errors pair a red border with a text message linked by `aria-describedby`. Color is never the only signal.
- Touch targets are at least 44px on touch devices.

## Motion

| Item | Limit |
|---|---|
| Button press | 100 to 160ms (token 120ms), scale 0.97 |
| Menus and dropdowns | 150 to 250ms (token 180ms) |
| Dialogs | 200 to 300ms (token 240ms), exits about 20% shorter |
| Particles | 18 desktop, 10 phone, CSS transform only, pause button, home only |
| Mascot tracking | 10px and 3 degrees at most, fine pointers only |

No scroll hijacking, and content works before any animation ends.

Reduced motion is global, in three parts. `src/styles/globals.css` ends CSS animations and transitions straight away, spinners excepted, because a spinner reports status. `src/providers/motion-provider.tsx` stops Framer Motion's movement and keeps its fades. `src/lib/reduced-motion.ts` covers what CSS can't reach: scripted smooth scrolling and typed text.

## Adopting the foundations on a screen

1. Import `@/styles/foundations.css` in that route's layout.
2. Add `cd-foundations` to the screen's root element and `cd-canvas` for the background.
3. Add `cd-foundations` to any portal content on that screen (Select, Dialog, Popover). Portals render outside the page.
4. Replace page-level gradients and one-off sizes with the type roles and primitives.

The block of legacy variables in `foundations.css` points shadcn's variables at the new tokens inside the scope, so `ui/button`, `ui/card` and the rest need no edits. Once every screen has adopted it, the tokens can move to `:root` and the scope class can go.
