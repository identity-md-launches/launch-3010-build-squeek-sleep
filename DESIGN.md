# Squeek or Sleep: design system

Extracted from the final source: `src/styles.css` (tokens and components), `src/index.html`
(markup patterns) and `src/app.js` (states). `dist/` is a verbatim copy of `src/`.

## Overview

A one-page, free prediction game for anyone curious about Squeekchain. The look is warm and
playful: cream paper, brown ink, an orange that means "running" and an indigo that means
"asleep". One illustration carries the idea: a hamster wheel drawn in inline SVG that spins
while the hamster runs and goes fully still, eyes closed, with two static "z" marks while it
sleeps. Nothing moves in the sleeping state.

Hierarchy is set by size and weight, not decoration. The game card comes first and holds,
top to bottom: one plain sentence saying what this is, the live wheel status, the result line
(the round in play, or the latest settle result), the countdown and the two pick buttons. Supporting panels (leaderboard, chain stats, history, rules) are
flat cards that follow it. Density is relaxed, with 44px minimum targets.

## Colors

All values are hex, defined once in `:root` in `src/styles.css`. Primitives are named by hue;
components use only the semantic roles.

| Role token | Primitive | Value | Used for |
| --- | --- | --- | --- |
| `--color-bg` | `--cream-50` | `#fff6ea` | Page background |
| `--color-surface` | `--cream-0` | `#fffdf8` | Cards, quiet buttons, input background |
| `--color-surface-sunken` | `--cream-100` | `#fbead3` | Progress track, wheel fill, result line background, list dividers, quiet-button hover |
| `--color-text` | `--brown-900` | `#3a2414` | Body text, headings |
| `--color-text-muted` | `--brown-700` | `#6e4f36` | Lead line, notes, metadata, input border |
| `--color-border` | `--brown-300` | `#e3c7a3` | Card borders, section dividers, quiet-button border |
| `--color-run` | `--orange-700` | `#c2410c` | Squeek button fill, "Squeek" in the title, "running" text, progress fill, your leaderboard row |
| `--color-run-hover` | `--orange-800` | `#9a3412` | Squeek button hover |
| `--color-sleep` | `--indigo-700` | `#3b3f8c` | Sleep button fill, "Sleep" in the title, "asleep" text, the "z" marks |
| `--color-sleep-hover` | `--indigo-800` | `#2e3170` | Sleep button hover |
| `--color-success` | `--green-700` | `#1f6f3a` | Points won (result, history) |
| `--color-danger` | `--crimson-700` | `#a3123a` | Name field error text and border |
| `--color-on-fill` | `--white` | `#ffffff` | Text on the pick buttons, inner ring of the selected pick |
| `--color-focus` | `--brown-900` | `#3a2414` | Focus outline, outer ring of the selected pick |
| `--color-wheel` | `--brown-700` | `#6e4f36` | Wheel stand, rim, rungs, spokes |
| `--color-wheel-idle` | `--stone-500` | `#9c8a78` | Wheel strokes while the feed is loading or offline |
| `--color-fur` / `--color-fur-light` | `--fur-400` / `--fur-200` | `#e8a35c` / `#f6d3a8` | Hamster body and belly |

Meaning is fixed: orange is running, indigo is asleep, green is points, crimson is an input
error. Every state also has a word ("running", "asleep", "Your pick", "+3"), so color is never
the only cue. Contrast ratios were computed from these declared pairs (see the README's
validation section); they were not measured in a rendered browser.

## Typography

| Token | Size | Roles |
| --- | --- | --- |
| `--text-display` | 2rem, 2.75rem from 40rem wide | `h1.title`, the largest and heaviest type on the page |
| `--text-xl` | 1.75rem | Status word, countdown, pick button labels, result points |
| `--text-lg` | 1.25rem | Section `h2`s, round title |
| `--text-md` | 1rem | Body, lead line, settle result text, buttons, input (16px avoids iOS zoom) |
| `--text-sm` | 0.875rem | Notes, metadata, pick hints, the in-play line, history sub-lines |

Five sizes at any width. Weights: `--weight-regular` 400, `--weight-semibold` 600,
`--weight-heavy` 800.

Families, both system stacks with no web font files:

- `--font-display`: `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Varela Round", system-ui, sans-serif`.
  Used for `h1`, `h2`, the countdown, pick labels, result points and leaderboard points. The rounded
  face renders on Apple platforms; elsewhere it falls back to the system sans, which was not verified in a browser.
  No font file is bundled; a bundled rounded face is the requester's call.
- `--font-body`: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

Signature detail on every platform: the title is `<span class="tag-run">Squeek</span> or
<span class="tag-sleep">Sleep</span>`, so the two picks carry their colors (orange, indigo) at
the heavy 800 weight (`.title .tag-run, .title .tag-sleep { font-weight: inherit }`), while
"or" stays in the text color.

Rules: headings `line-height: 1.15` and `text-wrap: balance`; body `1.5`; the h1 tracks at
`-0.04em` and the status word at `-0.01em`; nothing is tracked wider or set in capitals.
Every changing number (countdown, RPM, block, points, times) uses
`font-variant-numeric: tabular-nums`. Prose is capped at 60 to 65ch and uses `text-wrap: pretty`.

## Layout

- Spacing scale: `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem,
  `--space-5` 1.5rem, `--space-6` 2rem. Within a group, gaps are `--space-1` to `--space-3`;
  between groups and cards, `--space-4` or more.
- Page margin `--page-margin`: 1rem, then 1.5rem from 40rem wide. Content max width 72rem.
- `.layout` is a CSS grid with named areas. Below 60rem it is one column, ordered play, side
  (leaderboard and chain stats), history, rules. From 60rem it becomes `minmax(0, 1fr) 21rem`
  with the side column sticky at the top (`inset-block-start: var(--space-4)`).
- Inside the play card: the wheel sits beside the status text. It is 7rem below 22rem wide
  (so the text column keeps room at 320px), 9rem from 22rem (144px at 390), and 12rem from 40rem.
  The result line follows the status at a fixed place, then the round block. The pick buttons are
  a two-column grid at every width.
- Logical properties throughout (`margin-inline`, `padding-block-start`, `inset-block-start`).
- Breakpoints: 22rem (wheel 9rem), 40rem (larger margins, display size, wheel 12rem, card
  padding) and 60rem (two columns).
  The intended result is no horizontal scroll at 320px; this was reasoned from the source, not observed in a browser.

## Elevation and depth

Flat. Cards use a 1px `--color-border` border on `--color-surface` and no shadow. The only
shadow is the selected pick's double ring (`inset 0 0 0 4px` white plus `0 0 0 3px` focus
color), which marks state rather than depth. No card sits inside another card; inner sections
of the play card are divided by a 1px top border.

## Shapes

`--radius-sm` 0.5rem for quiet buttons and the input, `--radius-md` 1rem for pick buttons,
`--radius-lg` 1.5rem for cards, and a pill radius for the progress bar. Icons and the wheel
are inline SVG with round line caps.

## Components

All patterns live in `src/index.html` with styles in `src/styles.css` and behavior in `src/app.js`.

- **Card** (`.card`): surface, border, `--radius-lg`, padding `--space-4` (`--space-5` from 40rem).
  The first `h2` gets `margin-block-end: var(--space-3)`.
- **Wheel status** (`.status[data-state]`, `svg.wheel`): `data-state` is `running`, `sleeping` or
  `unknown`. Running spins `.wheel-spin` with `--spin-duration` set from the RPM (0.4s to 3s per turn)
  and bobs the hamster; sleeping closes the eye and shows the static `.zzz` marks, with no
  animation at all; unknown greys the strokes.
  The heading reads "Squeektoshi is / running" or "Wheel status / loading" or "offline".
  Motion runs only under `prefers-reduced-motion: no-preference`.
- **Pick button** (`button.pick.pick-run`, `button.pick.pick-sleep`): filled, white text, label
  plus hint ("Hamster runs", "Hamster sleeps").
  `aria-pressed="true"` adds the double ring and changes the hint to "Your pick". Hover darkens
  (only with `hover: hover`); press scales to 0.96. Transitions name `background-color, box-shadow, scale`.
- **Quiet button** (`.button-quiet`): bordered surface button, 44px tall, used for "Change name",
  "Save name" and "Clear scores on this device" (`.button-reset` adds top margin; it asks for confirmation).
- **Name form** (`#name-form`): visible label, 16px input, `aria-invalid` plus `#name-error`
  described by the input; Escape closes it and returns focus to "Change name".
- **Countdown and progress** (`.round-head`, `.countdown`, `.progress`): `m:ss` countdown, with a bar that fills over the 2-minute round.
- **Result line** (`#result[data-kind]`): always in the layout, directly under the wheel status, on
  `--color-surface-sunken` with `--radius-md`, padding `--space-3` `--space-4` and
  `min-block-size: 5rem` (about three lines), so swapping its text rarely moves the picks.
  With `data-kind="none"` it hides the points badge and shows the round in play in
  `--text-sm` muted text ("In play: the 7:26 PM round started with Squeektoshi asleep. Your pick:
  Squeek."). When a round settles it becomes `win`, `miss`, `void` or `info`, shows the points
  badge (`--text-xl`) and the result in `--text-md`, and plays a one-shot pop (scale 0.25 to 1,
  blur 4px to 0) via `data-pop="true"`. The result stays until the round it landed in ends, then
  the line returns to the round in play. Results are announced through the visually hidden
  `#result-announce` polite live region, so the in-play text is not read out every round.
- **Leaderboard row** (`.board-list li`): rank, name with "x of y right", points. Your row is orange
  and says "(you)".
- **History row** (`.history-list li`): local start time, "Running to asleep (flip)" with colored
  state words, your pick, points.
- **Stats list** (`dl.stats`): label left, tabular value right.

States implemented: loading ("Wheel status loading", "Loading"), feed error ("offline", "Unable to
reach Squeekchain. Retrying every 5 seconds."; chain stats and Block height read "Unavailable"),
unreadable or stale measurement, empty leaderboard and history, storage blocked, void rounds.

## Do's and don'ts

- Do start a new page from `.layout` with `.card` sections, and take every color from a role token.
- Do keep orange for "running"/Squeek and indigo for "asleep"/Sleep only. Pick a new hue at least
  15 degrees away for any new meaning.
- Do fill at most one action per meaning; secondary actions use `.button-quiet`.
- Do use the five size tokens; adding a sixth needs a reason.
- Don't put capitals or tracked labels above headings, and don't add a shadow to a bordered card.
- Don't animate outside `prefers-reduced-motion: no-preference`, and don't use `transition: all`.
- Don't show a wheel state, score or chain number the API did not return; show "Not reported" or
  "Unavailable" instead.

Recipe for one more page or panel: add a `<section class="card" aria-labelledby="...">` with an
`h2` to `.layout`, give it a grid area in both layouts, write text in `--color-text` and notes in
`.note`, and use `.button-quiet` for its actions.
