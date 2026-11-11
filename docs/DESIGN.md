# Code Details design foundations

The current visual system for the UI refresh, written from the accepted UI01 brief and tuned in UI03. It replaces the mix of old and new notes in `Agent Planning/design-reference/DESIGN.md`, which stays as history. The tokens themselves live in `src/styles/foundations.css`.

**Status:** adopted screen by screen. `/categories` was the first (UI04). Since UI05 the shared shell (header, sidebar, footer and the frame around the content) is on the foundations on every page, while each page's own content keeps its old look until it adopts them. UI06 adopted the showcase: the project card (on every list that shows it), the public project page in view mode, `/shared-projects/<name>` and `/users/<name>`. UI07 adopted discovery: `/search`, `/tags`, `/tags/<name>`, `/categories/<key>` and the project lists (`/projects`, portfolio, favorites, Graveyard, `/projects/users/<name>`) with their sort, category, view and page controls. UI08 adopted the creator screens: `/dashboard` (with the profile form), `/projects/new`, the project editor and its media controls. UI09 adopted the account and secondary screens: sign-in, sign-up, reset, the auth error and sign-out screens, the account menu, not-found and the route error screens, the admin dashboard and tag submissions, the admin tools (`/llm-test`, `/scrapper-demo`), About, Community, Support, the GitHub Scrapper pages, suggest-tags and `/users`. Home is the one page whose content is still outside the scope (UI10). UI11 removed the UI03 preview route (`/dashboard/admin/design-foundations`) and the admin theme-test pages under `/api`; the tokens and controls are documented here and in `src/styles/foundations.css`, and every adopted screen is their live example.

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

The palette covers all 22 categories. C01 added `ai-agents`, `generative-ai` and `libraries-frameworks`, whose tokens UI06 had already made. Jose's revision: every chip on its own hue, from pink (OKLCH 340) through red, orange, yellow and green to blue (252). Purple and violet (OKLCH 258 to 330) stay out; pink and rose are fine. 14 chips are soft (pale fill, mid-tone text) and 7 are deep (colored fill, dark text) on hues between the soft ones. The hues are spaced by how different they look, not by degrees, because OKLCH degrees bunch up in teal and cyan. Other is the only neutral. `tests/unit/ui06-category-tokens.test.ts` checks 4.5:1 text on every chip in both themes, the purple rule, a minimum OKLab distance between any two chips, Other as the only gray, and that four pairs Jose named stay well apart (Testing / Cybersecurity, ML Models / Cloud, Data / Desktop, Embedded / Dev Tools). The UI03 token test's HSL purple check skips the category tokens. To change one, edit the slot table in `Agent Planning/phase-ui06/tools/palette22.mjs` (`hue-arc.mjs` spaces hues), run it, then `write-category-tokens.cjs`.

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
| Entry | Once, from 16px and 0.8 opacity, 300ms or less, stagger 100ms at most |
| Typed labels | The whole text is in the page from the start; the reveal takes 1s at most |

No scroll hijacking, and content works before any animation ends.

What runs, since UI10:

- **Home particles** (`CodeParticlesElement`): 18 code symbols from a fixed seed, so server and client draw the same field; phones hide all but the first 10. One color (the text color at low opacity), no emoji. A CSS keyframe moves transform and opacity, with no JavaScript per frame. They run only under `prefers-reduced-motion: no-preference`, and pause (`data-running="false"`) while the tab is hidden, the layer is offscreen, data saver is on, or the visitor presses "Pause background animation" below the hero. That choice is kept in `localStorage` for this browser. The layer and its symbols ignore the pointer (F01-7).
- **Home hero**: the headline, mascot and welcome line use `.cd-enter` (CSS, from 0.8 opacity), so they're readable on the first frame. The full-screen pulsing blurred glow is gone.
- **Terminal labels**: `TextTypingEffectAnimation` puts the whole label in the DOM and reveals it with a stepped `clip-path`, so a link has its name and full click area at once.
- **Secondary pages** (About, Community, Support, the GitHub Scrapper pages): Framer Motion entries start at 0.8 opacity and 16px, last 300ms and stagger by 100ms at most.
- **Not-found confetti** falls by transform and is skipped under reduced motion.
- **Scripted jumps** (the project page's "On This Page", Back to top, the dashboard's "You have shared N" link, a doc's headings) call `moveFocusTo` from `src/lib/reduced-motion.ts` after scrolling, so the next Tab continues where the view went.
- **Terminal cursor** blinks by opacity (`.cd-cursor-blink`), not the app's `animate-pulse` shimmer, which repainted every frame.
- **Overlays** read the tokens through `--tw-duration` in `globals.css`: menus, selects, tooltips and hover cards 180ms (exit 144ms); dialogs, alert dialogs, sheets and the phone sidebar 240ms (exit 192ms). Dialog parts carry `data-slot` names for this.
- The pause button's wrapper is the one piece of home on the foundations; it's marked `data-home-control` so the scope checks skip it.
- Spinners, loading skeletons and the dashboard's live dot keep running: they report status.

Reduced motion is global, in three parts. `src/styles/globals.css` ends CSS animations and transitions straight away, spinners excepted, because a spinner reports status. `src/providers/motion-provider.tsx` stops Framer Motion's movement and keeps its fades. `src/lib/reduced-motion.ts` covers what CSS can't reach: scripted smooth scrolling and typed text.

## The shared shell (UI05)

- Each shell part carries `cd-foundations` on its own element: the `header`, the sidebar's desktop panel and phone sheet, the `footer`, the theme switch and the skip link. Nothing wraps the page content, so a page that hasn't adopted the foundations keeps its look inside the new shell.
- Shell components import `src/styles/shell-foundations.ts`, which loads the stylesheet. That's the one importer for the shell.
- The frame around the inset content sits outside the scope, so `.cd-shell-frame` repeats the two `--cd-bg` values. A unit test checks they match.
- `AppShell` (`src/components/layout/AppShell.tsx`) renders the sidebar, header, page and footer in one place. `/categories`, `/tags`, `/users`, `/users/<name>`, `/shared-projects/<name>` and `/projects/<slug>` use it, and since UI07 `/search`, `/tags/<name>`, `/categories/<key>` and the project lists; move a page onto it when its phase adopts the foundations.
- The header is solid. Signed out, when the sidebar is a sheet (below 1024px), the header shows the logo and a menu button that opens that sheet; on wider screens the sidebar carries the only logo.
- Sidebar entries are links with `aria-current`, 44px pills, blue "selected" for the current page. Signed-in entries and the Explore label appear only once the session confirms a user, never while it loads.
- Skip to content comes first in the Tab order and lands past the sidebar and header (`#main-content`).

## The project card (UI06)

- `ProjectCard` carries its own `cd-foundations` scope, like the shell parts, so it's the same card on every list. Cards sit in `.cd-card-grid`: as many columns of at least 19rem as fit.
- The title is a real link whose `::after` covers the card. A click anywhere opens the project, and open in a new tab works. Every other control on the card is raised above that link (`position: relative; z-index: 1`). Focus on the title rings the whole card.
- Category and tag chips are links (32px pills, with a 44px hit area on touch). The owner's avatar and name are one button. Icon buttons are 44px. A graveyard card seen by someone else has no title link, as before.
- The description is clamped to three lines. The full text is on the project page.
- List placeholders (`ProjectCardSkeleton`) have the card's shape but not the `.project-card` class, are hidden from screen readers and sit behind a "Loading projects" status. Tests can wait for `[data-project-card]` or `.project-card` and know the data is there.

## Discovery (UI07)

- List pages share `DiscoveryHeader`: an eyebrow, one `h1`, a lead, and an aside for the member tier on personal lists. It replaces the gradient `PageBanner` there.
- Anything that opens a page is a link: search results, category tiles, tags, people and the explore shortcuts. Something with nothing to open (a tag or category with no projects, a person with none) stays listed with a dashed outline and is not a link.
- Category descriptions (Jose, UI07): cards and tiles show the short form, `categorySummary()`, up to the first sentence end or colon. The full wording with its tie-breaks is on `/categories/<key>` and under the category picker in create and edit. No tooltips.
- List controls carry a visible label tied to the control (`aria-labelledby` label + trigger, so the name reads "Sort by, Newest"). Their menus carry `cd-foundations` because they render in a portal.
- Pagination is buttons in a list inside `nav[aria-label="Pagination"]`, the current page marked with `aria-current`. Below 640px it shows "Page n of m".
- Cards / Table is a group of two pressed-state buttons. The table is a dense view and uses compact density.
- A list that fails says so and offers Try again; it never looks like an empty list. On `/search` the people list needs a session, so its 401 signed out isn't a failure.
- `/search` loads the mascot through `next/image`. The full-page particles are gone from `/search` and the lists (particles are for home only).

## Creator screens (UI08)

- `/dashboard` is on `AppShell` with `DiscoveryHeader`. Its loading screen and the page's placeholder share `DashboardSkeleton`, which has no `main` of its own and keeps the real `h1` visible. Fixed card heights apply from `lg` (or `sm` for the project lists) up; on a phone the cards take their natural height and long lists scroll inside a bounded, focusable region.
- A dashboard that fails on first load says so with Try again and never shows the server's message. A failed refresh keeps the last data with a note above it.
- A link that looks like a button is `<Button asChild><Link/></Button>`, never a button inside a link.
- The editor (create and edit) carries the scope like view mode. Field errors sit under the field with `aria-invalid` and `aria-describedby`; the first invalid field takes focus; an alert beside Save lists what blocked the save, with in-page links to the fields. A status line beside the buttons says whether anything is unsaved.
- Unsaved edits are guarded on Cancel, on any same-site link (a capture-phase click listener while the form is dirty) and on reload or close (`beforeunload`). In-page anchors and new-tab clicks pass. Back isn't guarded.
- A dialog opened from state remembers its opener and returns focus through `onCloseAutoFocus`.
- Media: the drop zone is a button; thumbnails in the editor are buttons that open the preview; per-image actions name the image ("Delete Screenshot 2"); a file that won't load shows "Image unavailable". There is no reorder control.

## Account and secondary screens (UI09)

- Sign-in, sign-up, reset, the auth error screens and sign-out share `AuthPageFrame`: the sidebar-less header, one `main` with a centered column, and the footer. The card's title is the page's one `h1`, so each screen is named for what it does ("Reset your password"); the friendly line above it ("Hopefully you are not lost.") is a paragraph. No particles.
- An auth error names the fields it's about: they get `aria-invalid` and `aria-describedby` pointing at the message, and the first one takes focus when the request ends. With no field to blame (too many attempts, offline), focus returns to the submit button, because the disabled fieldset drops it to `<body>` while the request runs. Typing in a marked field clears its mark.
- "Continue with GitHub" is the outline (secondary) button and Continue the primary one. Status lines use the danger and success tokens, never Tailwind's green.
- The sign-in return (`redirect_url`) is unchanged: `safeRedirect` keeps only a same-site path, and an e2e test signs in with another site, a protocol-relative URL, a backslash URL and a script URL and lands on home each time.
- Menus opened from the shell (the account menu) render in a portal, so `DropdownMenuContent` carries `cd-foundations` itself.
- Not-found is inside `AppShell`, so it has the sidebar, header, one `main` and an `h1` ("Page not found"), with "404" as solid text. The mascot is a button that changes its message, and the five-press confetti stays. `app/error.tsx` catches a page that crashes, inside the shell, with Try again; `global-error.tsx` covers the root layout with its own document and inline styles. Neither shows the error's text.
- Signed-in secondary pages (About, Community, Support, the GitHub Scrapper pages) are in `AppShell` like every other signed-in page; before, three of them used the sidebar-less header and had no `main`.

Lessons from UI09:

- A client page that imports a barrel (`@/repoScrapper`) bundles everything the barrel exports. After H1, the barrel included the server crawler and `node:dns`, and `/github-scrapper` answered 500 in development. Import the one client-safe module (`@/repoScrapper/crawler`). Since X3 the engine is the `repo-docs` workspace package: client pages import `repo-docs` or `repo-docs/llm`, and the server entries (`repo-docs/server`, `repo-docs/llm/server`, `repo-docs/safe-fetch`, `repo-docs/store/file`) are closed to browser bundles in the package's `exports`.
- A clickable card that opens a page gets a real link: the card's name is the anchor and its `::after` covers the card, with the focus ring drawn on the card while the link has focus (`.cd-project-card-link`, and since UI11 `.cd-user-card-link` on `/users`). That keeps open in new tab and the link menu, which a `role="link"` div loses.
- JSX keeps a literal `\n` typed into markup as text: the old admin loading screen rendered one.

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

Lessons from the creator screens (UI08):

- Don't wrap the editor in a `<form>` to get Enter-to-submit: its child components have dozens of plain buttons, which become submit buttons inside a form, and Enter in a field would "click" the first one (Generate slug).
- `.cd-status` sets `display: inline-block` unlayered, so Tailwind's `inline-flex` loses; use an inline style when a status pill holds an icon.
- A `label` with no field (the old read-only profile) is noise for screen readers; read-only pairs are a `dl`.

Lessons from discovery (UI07):

- An `<a>` without `href` isn't focusable. The old pagination used them, so keyboard users couldn't change pages. Use a button for an action and a link for a place.
- `pkill -f "next start"` leaves the `next-server` child holding the port. Stop a slot's Next by port (`lsof -t -iTCP:<port>`), or the next run quietly tests the old build.
- A public page that also reads a signed-in-only endpoint must treat its 401 as "not available", not as a failure.

The block of legacy variables in `foundations.css` points shadcn's variables at the new tokens inside the scope, so `ui/button`, `ui/card` and the rest need no edits. Once every screen has adopted it, the tokens can move to `:root` and the scope class can go.
