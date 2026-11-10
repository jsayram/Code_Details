# Code Details design foundations

The current visual system for the UI refresh, written from the accepted UI01 brief and tuned in UI03. It replaces the mix of old and new notes in `Agent Planning/design-reference/DESIGN.md`, which stays as history. The tokens themselves live in `src/styles/foundations.css`.

**Status:** adopted screen by screen. `/categories` was the first (UI04). Since UI05 the shared shell (header, sidebar, footer and the frame around the content) is on the foundations on every page, while each page's own content keeps its old look until it adopts them. UI06 adopted the showcase: the project card (on every list that shows it), the public project page in view mode, `/shared-projects/<name>` and `/users/<name>`. To see every token and control, run the app in development, sign in as an admin and open `/dashboard/admin/design-foundations`. Production answers 404 there.

## Principles

- One clear order on every screen, one main action, fast response.
- Personality comes from content and imagery: the mascot, the terminal, the humor. Simple doesn't mean plain.
- Blue means you can act on it. Red, green and amber mean status. Nothing else is colored for decoration.
- Purple stays in the mascot's hood and the logo. Categories keep a color each so people can tell them apart (Jose, UI06), none of them purple. See "Category colors".

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

### Category colors (UI06)

Categories keep a color each so people can tell them apart (Jose's call). Each category key has three tokens per theme, `--cd-cat-<key>-bg`, `-fg` and `-border`, solid hex like every other token. A chip gets them with `class="cd-cat" data-category="<key>"`; an unknown key falls back to the neutral raised chip.

The palette covers 22 keys: today's 19 plus `ai-agents`, `generative-ai` and `libraries-frameworks`, which a later phase adds as categories. Jose's revision: every chip on its own hue, from pink (OKLCH 340) through red, orange, yellow and green to blue (252). Purple and violet (OKLCH 258 to 330) stay out; pink and rose are fine. 14 chips are soft (pale fill, mid-tone text) and 7 are deep (colored fill, dark text) on hues between the soft ones. The hues are spaced by how different they look, not by degrees, because OKLCH degrees bunch up in teal and cyan. Other is the only neutral. `tests/unit/ui06-category-tokens.test.ts` checks 4.5:1 text on every chip in both themes, the purple rule, a minimum OKLab distance between any two chips, Other as the only gray, and that four pairs Jose named stay well apart (Testing / Cybersecurity, ML Models / Cloud, Data / Desktop, Embedded / Dev Tools). The UI03 token test's HSL purple check skips the category tokens. To change one, edit the slot table in `Agent Planning/phase-ui06/tools/palette22.mjs` (`hue-arc.mjs` spaces hues), run it, then `write-category-tokens.cjs`.

The old `category-styles.css` still colors filter pills and badges on pages that haven't adopted the foundations; it goes in UI11.

## Controls and states

- Focus is a solid 2px outline with a 2px offset on every control.
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

## The shared shell (UI05)

- Each shell part carries `cd-foundations` on its own element: the `header`, the sidebar's desktop panel and phone sheet, the `footer`, the theme switch and the skip link. Nothing wraps the page content, so a page that hasn't adopted the foundations keeps its look inside the new shell.
- Shell components import `src/styles/shell-foundations.ts`, which loads the stylesheet. That's the one importer for the shell.
- The frame around the inset content sits outside the scope, so `.cd-shell-frame` repeats the two `--cd-bg` values. A unit test checks they match.
- `AppShell` (`src/components/layout/AppShell.tsx`) renders the sidebar, header, page and footer in one place. `/categories`, `/tags`, `/users`, `/users/<name>`, `/shared-projects/<name>` and `/projects/<slug>` use it; move a page onto it when its phase adopts the foundations.
- The header is solid. Signed out, when the sidebar is a sheet (below 1024px), the header shows the logo and a menu button that opens that sheet; on wider screens the sidebar carries the only logo.
- Sidebar entries are links with `aria-current`, 44px pills, blue "selected" for the current page. Signed-in entries and the Explore label appear only once the session confirms a user, never while it loads.
- Skip to content comes first in the Tab order and lands past the sidebar and header (`#main-content`).

## The project card (UI06)

- `ProjectCard` carries its own `cd-foundations` scope, like the shell parts, so it's the same card on every list. Cards sit in `.cd-card-grid`: as many columns of at least 19rem as fit.
- The title is a real link whose `::after` covers the card. A click anywhere opens the project, and open in a new tab works. Every other control on the card is raised above that link (`position: relative; z-index: 1`). Focus on the title rings the whole card.
- Category and tag chips are links (32px pills, with a 44px hit area on touch). The owner's avatar and name are one button. Icon buttons are 44px. A graveyard card seen by someone else has no title link, as before.
- The description is clamped to three lines. The full text is on the project page.
- List placeholders (`ProjectCardSkeleton`) have the card's shape but not the `.project-card` class, are hidden from screen readers and sit behind a "Loading projects" status. Tests can wait for `[data-project-card]` or `.project-card` and know the data is there.

## Adopting the foundations on a screen

1. Import `@/styles/foundations.css` in that route's layout, and move the page onto `AppShell` if it assembles the shell by hand.
2. Add `cd-foundations` to the screen's root element and `cd-canvas` for the background.
3. Add `cd-foundations` to any portal content on that screen (Select, Dialog, Popover). Portals render outside the page.
4. Replace page-level gradients and one-off sizes with the type roles and primitives.

Then add the new importer to the list in `tests/unit/ui03-foundations-tokens.test.ts`, which fails on any file it doesn't expect.

Lessons from `/categories`:

- Import the stylesheet in the page and in its `loading.tsx`. A segment's `loading.tsx` also covers its child routes, so `/categories/<name>` loads the sheet and briefly shows the index's skeleton while it opens. That's harmless, because nothing there has the class, but give a child route its own `loading.tsx` when it adopts the foundations.
- A rule in the scope beats a Tailwind utility, so a one-off color on a `.cd-surface` needs an inline style.
- Show placeholders while data loads and a message with Try again when it fails. Never show a failure as an empty list.
- In tests, Next's route announcer also has `role="alert"`. Filter alerts by their text.

Lessons from the shell (UI05):

- `.cd-foundations :focus-visible` only reaches descendants. An element that is itself the scope (the theme switch) needs `.cd-foundations:focus-visible` too; both are in the rule now.
- Some Tailwind utilities outrank an unlayered rule here (`has-…:bg-sidebar` did). Setting the variable the utility reads (`--sidebar`) is more reliable than fighting it.
- A sheet opened by a plain button, not a Radix trigger, doesn't get focus back on close by itself. The sidebar sheet now remembers which button opened it.

Lessons from the showcase (UI06):

- A shared component (the card) can adopt before the pages around it: give it its own scope, as the shell did. The seam then sits at the card's edge.
- One long word widens a grid column unless the column is `minmax(0, 1fr)` and the text has `.cd-wrap`. `break-words` alone doesn't help in a grid.
- A section that loads later (images, linked docs) should only exist once it has content, and the contents list watches the page for it, so the list never offers an empty section.
- A dialog opened from state rather than a Radix trigger needs its opener remembered to put focus back.
- When a button shows text (a count, "Image unavailable"), its name must contain that text. Prefer screen-reader text inside the button to `aria-label`.
- Don't add a `loading.tsx` to a route that can call `notFound()` (the project page). The loading boundary streams the response, so the 200 status is sent before `notFound()` runs and private, deleted and unknown projects stop answering 404. Use a `Suspense` fallback inside the page instead.
- A view that shares a component with an editor (the project page and its edit mode) can scope only the view: `isEditMode ? old classes : "cd-foundations cd-canvas"`, with `display: contents` on the inner wrapper so the editor doesn't move.

The block of legacy variables in `foundations.css` points shadcn's variables at the new tokens inside the scope, so `ui/button`, `ui/card` and the rest need no edits. Once every screen has adopted it, the tokens can move to `:root` and the scope class can go.
