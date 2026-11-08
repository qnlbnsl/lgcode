---
name: reverse-fig
description: Turn a project's existing interface into an OpenPencil design file (.fig) with component sets, variants and color variables, then check it against the browser pixel by pixel. Use when a project that already has screens joins Sheprd and its design should become the source of truth.
---

# Reverse Fig

Reverse Fig renders a project's components in a real browser, photographs each variant, and copies
its computed styles into plain HTML. OpenPencil imports that HTML. A build script then turns the
imported frames into component sets with variants, and the CSS custom properties into color
variables with one mode per theme. Last, the skill renders every variant from the design file and
compares it with the browser's photograph.

The owner decided on 2026-11-07 that the design file is the source of truth, and that mocks are
built from code. Reverse Fig is how a project that already has an interface gets its first design
file.

It covers color tokens and components. It does not draw screens yet. The design file has a Screens
page with one instance of each component, ready for that work.

## The first passes on a new project are tuning, and they can use many tokens

The scripts in `lib/` are general. Everything specific to a project lives in its profile: the
page to open, how to wait for it, which components to stage and in which states, how to switch
themes, and which custom properties are tokens. No profile is right on the first try.

Expect the first few passes on a new project to be a loop that an AI agent runs:

1. Write a profile from `profiles/template.mjs`, after reading the project's components and
   styles.
2. Run the skill and open `report.html` in the work folder.
3. Look at the worst rows. Each row shows the component as shipped, as the browser draws it in
   the design font, as the design file draws it, and the difference in red.
4. Change the profile, or the scripts when a fault is general, and run again.

Every pass reads screenshots, so this loop is expensive. A project with many components can take
several passes, and each pass sends dozens of images to the model. Tell the owner before starting,
and stop when the remaining differences are listed as known losses below or are accepted by the
owner. Later runs on the same project reuse the tuned profile and cost little.

A change to a script that fixes one project must not break another. Run every profile that exists
after changing `lib/`.

## How to run it

The skill needs Node.js 22 or newer. Install its two packages once, OpenPencil's command-line
tool and Playwright, both pinned:

```sh
npm install --prefix skills/reverse-fig
npx --prefix skills/reverse-fig playwright install chromium   # if no Chromium is installed
```

Start the project's development server. Then run, from the project's folder:

```sh
node skills/reverse-fig/reverse-fig.mjs path/to/profile.mjs
```

The run prints a summary, writes the design file to the profile's `output`, and writes
`extract.json`, `build.json`, `report.json`, `report.html` and the images to the work folder. Keep
the work folder out of git. The exit code is 1 when a variant fails the check.

Options:

- `--steps extract,build,verify` runs only some steps. `--steps build,verify` reuses the last
  extraction, which is quicker while a build fault is being fixed.
- `--storybook` also exports the design file as React stories in the work folder, which shows the
  way back from design to code.
- `PLAYWRIGHT_MODULE` points at another Playwright copy, and `REVERSE_FIG_OPENPENCIL` at another
  `openpencil.js`.

Sheprd's own profile, `profiles/sheprd-mock.mjs`, runs against the web mock on the branch
`area/web-mock`, served on port 4178. Run it from that worktree's root, and it writes
`design/sheprd.fig`. On 2026-11-08 its first tuning passes reached 18 of 26 variants within 3
percent, after the faults below were fixed in the scripts.

## Where a profile lives

A profile is a JavaScript module, so it can hold code as well as settings. Keep it with the
project it describes, for example as `.sheprd/reverse-fig.mjs`. A private project's profile must
not be committed to a public repository, because its component markup and names describe that
product.

`profiles/template.mjs` documents every setting. A variant comes from markup placed on the page,
or from an element already there. A variant can name its own page, which suits a project that
shows each component on a page of its own, such as a component gallery or a mock sheet.

## What the scripts already correct

- **The design font.** A design file cannot use the operating system's font, so the profile names
  a design font, Inter by default. The browser draws a second photograph in that font, and the
  check compares against it. The as-shipped photograph stays in the report for comparison.
- **Font weights.** Weights snap to the nearest weight the design font has, the way CSS picks one.
- **Labels that only just fit.** OpenPencil 0.16.0 measures Inter Medium and SemiBold with a rough
  estimate from the command line, so labels wrapped. Each element that holds only text keeps the
  browser's size, plus one pixel. This is issue 524 in `docs/issues.md`.
- **Node ids.** OpenPencil renumbers nodes when it saves, so the check finds variants by name.
- **Transparent renders.** The design render has no background, so both pictures are compared on
  the page background.
- **Half pixels.** Staged components sit at whole pixels, and the window grows to fit them.
- **Percent radii** become pixels, and `inline-block` becomes `block`.

## Known losses

These are still lost on the way into the design file:

- Hover effects made with `filter` or transitions. Forced `:hover` colors do come through.
- `margin: auto` and other margins. Layout comes from flex, gap and padding only.
- Text decoration changes height: the inline link's hover state is 11 pixels taller in the design.
- Text sits about one pixel lower than in the browser. The check allows a one-pixel shift.
- Layer names come from class names, not from the component's meaning.
- Two tokens with the same color bind to the first one, so the profile's token order decides.
- Only color tokens become variables. Spacing, radius and type scales do not yet.
