# Squeek or Sleep

A free prediction game on [Squeekchain](https://squeekchain.com). Players guess whether
Squeektoshi the hamster will be running (Squeek) or asleep (Sleep) when the next 2-minute round
ends. Rounds are scored from the live wheel telemetry at `https://api.squeekchain.com/v1/status`,
polled every 5 seconds. Chain stats come from `https://api.squeekchain.com/v1/economy/state`.
No wallet, no tokens, no backend: picks, scores and round history live in the browser's
`localStorage`.

## Layout of the repository

| Path | What it is |
| --- | --- |
| `src/index.html`, `src/styles.css`, `src/app.js`, `src/game.js` | The site source: plain HTML, CSS and ES modules, with type annotations in JSDoc checked by TypeScript |
| `src/favicon.svg`, `src/og-image.svg` | Favicon and share image |
| `dist/` | The production export (committed). Byte-for-byte copy of `src/`, with only relative URLs |
| `scripts/build.mjs` | Build: cleans `dist/`, copies `src/`, refuses root-relative or missing asset URLs |
| `scripts/preview.mjs` | Local static server for `dist/` under the `/squeek/` subpath |
| `tests/game.test.mjs` | Unit tests for the round engine and API parsing (`node --test`) |
| `tsconfig.json` | Typecheck config (`checkJs`, `strict`, `noEmit`) |
| `DESIGN.md` | Tokens, typography, components and responsive behavior |

## Install, preview, rebuild

Requires Node 20 or newer. There are no runtime or build dependencies, so `npm install` only
writes the (empty) dependency tree from `package-lock.json`.

```sh
npm install          # nothing to download; keeps the lockfile honest
npm run build        # src/ -> dist/
npm run preview      # serves dist/ at http://localhost:4173/squeek/
npm test             # round engine and parser tests
npm run typecheck    # tsc --noEmit over src/ (fetches typescript@5.9 through npx)
npm run check        # typecheck, test and build in one go
```

`dist/` can be served by any static host or IPFS gateway at any subpath; every asset URL is
relative (`./styles.css`, `./app.js`, `./game.js`, `./favicon.svg`, `./og-image.svg`).

## How the game works

- Rounds are fixed 2-minute windows on the clock (`round id = floor(time / 120 s)`), so every
  visitor sees the same countdown.
- While a round is in play you pick for the next one. You can switch until the countdown ends.
- When the round starts, the page records the wheel state from the most recent reading taken
  within 15 seconds of the boundary. The round settles as soon as the wheel changes state, or at
  the end of the window using the last reading in the final 15 seconds.
- Correctly calling a change (asleep to running, or running to asleep): 3 points. Correctly calling
  no change: 1 point. A wrong pick costs nothing.
- With no reading at the start or the end (feed down, page closed), the round is void: nobody scores.
- The state comes from the API's wheel fields. `src/game.js` (`parseStatus`) reads the state from
  `wheel.status`, `wheel_status`, `state` or `hamster.state` (snake_case or camelCase), or from a
  `running` boolean, and falls back to `rpm > 0`. "Stopped" counts as Sleep. If the payload has
  no usable field, the page says so and does not guess.
- Several people on one device can play under different names ("Change name"). The leaderboard is
  per browser and says so on the page; static hosting cannot share scores between visitors.

## Assumptions

- The live API's response shape was not visible from this build machine (see Validation), so the
  parser accepts the common shapes listed above rather than one exact schema.
- The brief says both "the state changed in the predicted direction" scores and "correct
  predictions earn points". The game does both: a called flip earns 3 points and a called hold earns 1.
- The share image is an SVG (`og-image.svg`). Some link unfurlers only accept PNG or JPEG; this
  build machine could not render a raster file.

## Validation

### What ran and what did not

This build was made without a working shell. Every Bash call in the session failed before it
started with `Sandbox is required but failed to initialize: Failed to create bridge sockets after
5 attempts.` The browser tool failed with `Browser "chrome-for-testing" is not installed`, and it
could not be installed without a shell. Because of that:

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | **Not run.** `dist/` was written by hand as an exact copy of `src/` (the build's only transformation). Line counts of all six file pairs match, and spot checks of edited lines match. |
| Typecheck | `npm run typecheck` | **Not run.** Source is annotated for `checkJs` + `strict` and was reviewed by hand for type errors. |
| Unit tests | `npm test` | **Not run.** All 12 tests in `tests/game.test.mjs` were traced by hand against `src/game.js`, and each traced assertion passed. That trace is not a test run. |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **Not run** (needs a shell and Playwright). No screenshots exist. |
| Browser inspection (320, 390, 1440; keyboard; console) | Playwright MCP | **Not run**: the browser binary is missing. |
| Live API | WebFetch of `https://api.squeekchain.com/v1/status`, `/v1/economy/state`, `https://squeekchain.com` | All three answered **HTTP 403** to the fetch tool, so the real payload shape is unverified. A web search found no public documentation for the API. |

Run `npm run check`, then `npm run preview`, and open the page at 320, 390 and 1440 wide to close
these gaps. Also confirm that `api.squeekchain.com` sends CORS headers that allow a browser on
another origin. If it does not, the page shows "Wheel status offline" and no rounds settle.

### Better Interface review (source-only)

Scope: the single page `src/index.html` and every state that `src/app.js` renders. All six
domains were reviewed against the source. Every check that needs a browser is listed as not
verified.

| Domain | Coverage | Not verified |
| --- | --- | --- |
| Accessibility | Checked (source): native buttons and links only; `aria-pressed` on picks; labelled name field with `aria-invalid` and `aria-describedby`; focus moves to the first invalid field; Escape closes the form and returns focus; `:focus-visible` 3px outline; polite live regions for pick state, result and state changes; decorative SVG `aria-hidden`; one `h1` and `h2` sections; all motion inside `prefers-reduced-motion: no-preference`; 44px targets; `forced-colors` ring for the selected pick | Keyboard walk in a browser, accessibility tree, screen reader, 200% zoom |
| Layout | Checked (source): logical properties, content-driven breakpoints (40rem, 60rem), DOM order matches reading order, no fixed-height text containers, rows wrap | Rendering at 320, 390 and 1440 wide; RTL |
| Writing | Checked (source): verb-first secondary buttons ("Change name", "Save name", "Clear scores on this device"); the brief fixes "Squeek" and "Sleep"; errors state the fix; empty states point forward; consistent "pick" and "round" vocabulary; no em dashes or emoji | n/a |
| Typography | Checked (source): five sizes, three weights, two families, descending headings, tabular numbers on changing values, balance and pretty wrapping, 16px input | Rendered wrapping; whether `ui-rounded` falls back cleanly off Apple platforms |
| Colors | Checked (computed from declared hex pairs with the WCAG formula, not measured on screen): text `#3a2414` on bg `#fff6ea` about 13.6:1; muted `#6e4f36` on bg about 6.9:1; white on run `#c2410c` about 5.2:1; white on sleep `#3b3f8c` about 9.2:1; run `#c2410c` on surface `#fffdf8` about 5.1:1; success `#1f6f3a` on surface about 5.8:1; danger `#a3123a` on surface about 7.6:1 | Rendered pairs, forced-colors appearance |
| UI | Checked (source): named transition properties, press scale 0.96, one-shot result pop (scale 0.25 to 1, blur 4px to 0, no overshoot), no border plus shadow on one surface, no nested cards | Animation feel, first-frame stutter |

Findings fixed during the build:

1. High, `src/index.html:59` and `src/styles.css:373`: "Squeektoshi is running" set at 28px beside a 7rem wheel would overflow a 320px screen ("Squeektoshi" alone is about 176px; about 150px is available). Split into a 16px "Squeektoshi is" line and a 28px state word ("running", "asleep", "loading", "offline"). Rechecked by width arithmetic only.
2. Medium, `src/app.js:494`: storage events re-ran the tick, which wrote storage again, so two open tabs could answer each other indefinitely. The handler now only re-renders, and `persist()` skips identical writes. `advance()` only moves `round.last` forward in time (`src/game.js:367`).
3. Medium, `src/styles.css:606` (`.field-error`) and `src/styles.css:568` (formerly `.button-danger`): error and reset text used the running orange, which breaks one color, one meaning. Added `--color-danger` (crimson, hue about 340°, more than 30° from the orange) for errors, and made the reset button neutral (`.button-reset`).
4. Low, `src/styles.css` (`:root`): removed the unused `--color-run-tint` and `--color-sleep-tint` and their primitives.
5. Low, `src/styles.css:837` (`@keyframes pop`): removed the 1.15 overshoot to follow the guide's no-bounce rule.
6. Low, `src/index.html:118`: "Make a pick above" was wrong on desktop, where the leaderboard sits beside the game. Changed to "Pick Squeek or Sleep to get on the board."
7. Low, `src/styles.css:742` (`.history-list li`): widened the time column from 4.5rem to 5.5rem so 12-hour labels like "02:06 PM" fit.

Remaining limitations: no build, typecheck, test, probe or browser run happened (see above); the
live API's shape and CORS are unverified; the share image is SVG only; the leaderboard is
per-browser by design.

**Completion: Incomplete.** A complete, usable site and its export are delivered, but the
required build, typecheck, interaction and browser checks could not be executed on this machine.
