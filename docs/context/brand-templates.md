# Brand Templates

How form pages inherit brand-level presentation (logo, title, description,
colors, font) and override it per page. This is a page-shell concern, separate
from the Forms MVC/rules architecture covered in `architecture.md`.

**Design goal: adding a new brand is a pure authoring task.** No CSS or code
change is required to onboard a brand - only to change the generic, shared
page-shell styling all brands use.

## Mechanism

Brand defaults are authored once using AEM Edge Delivery Services' native
[Bulk Metadata](https://www.aem.live/docs/bulk-metadata) system, not custom
code:

- A single da.live Sheet named `metadata` at the site root, with a `URL`
  column (glob patterns, e.g. `/chiefs/**`) and one column per property:
  `title`, `subtitle`, `description`, `logo`, `background-color`,
  `text-color`, `link-color`, `card-background-color`, `font`. `logo` accepts
  a comma-separated list of one or more image paths, the same convention this
  project's forms already use for `Options`/`OptionNames` - a single path
  renders one logo as before, additional paths render extra logos beside it.
  `title` becomes the page's `<title>` element (see `decorateBrandBanner()`
  below) - browsers only allow plain text there, so any rich formatting typed
  into that cell (bold, a second paragraph) is silently flattened to one
  plain string before it ever reaches this codebase. A short line under the
  heading (event dates, a venue) needs the separate `subtitle` property
  instead, which is an ordinary `<meta>` tag and keeps its own styling.
- Rows are evaluated top-to-bottom; a site-wide `/**` default row must come
  before more specific brand rows.
- A page's own inline Page Metadata block always overrides the bulk sheet -
  this is native platform behavior, not something this codebase implements.

Each brand's form pages live under that brand's URL prefix (e.g.
`/chiefs/signup`) so they pick up the matching bulk metadata row. Any page
under that prefix can embed any form (sheet-based or AEM-based) - the brand
system only controls page-shell presentation, it has no relationship to which
form is embedded in the page's Form block.

## Code

- `scripts/scripts.js` `decorateBrandStyle()`: reads each metadata property in
  `BRAND_STYLE_PROPERTIES` and, when present, sets the corresponding CSS
  custom property directly on `:root`. This is the whole mechanism for
  zero-dev-step branding - a color or font typed into the metadata sheet
  becomes a live CSS value with no CSS authored per brand. Fonts must already
  be available on the site (an existing `/fonts` file or an already-linked
  font); this does not load fonts dynamically.
- `scripts/scripts.js` `decorateBrandBanner()`: reads `logo`/`title`/
  `subtitle`/`description` metadata and prepends a `.brand-banner` element
  (logo image(s), heading, subtitle, description) to `<main>`, before the
  page's authored sections. **Opt-in**: only renders when `logo` is present,
  so pages/sites without a brand logo (e.g. internal test pages) are
  unaffected. `logo` is split on comma (trimmed, same as
  `handleMultiValues()` in `blocks/form/transform.js`), so one path renders
  the original single-logo layout unchanged, and two or more render multiple
  logos side by side (e.g. a co-branded partner or sponsor mark). `subtitle`
  is read via `getMetadata('subtitle')` like any other property - unlike
  `title`, it isn't sourced from `document.title`, so it isn't limited to
  plain text the way that property effectively is once da.live emits it.
- `styles/styles.css`:
  - `.brand-banner` - generic layout for the logo/title/subtitle/description
    banner. `.brand-banner-subtitle` styles the optional subtitle line
    (italic, smaller than the title) between the heading and description.
    Logos are appended directly as `<picture>` siblings, deliberately with no
    wrapping `<div>` - EDS's own `decorateSections()` auto-wraps any classed
    div placed as a section child, and that wrapper then matches
    `decorateBlocks()`'s generic block-detection selector, so a manually
    added container div gets mistaken for an authored content block. Multiple
    `<picture>` elements (inline by default) sit side by side on their own;
    `.brand-banner picture + picture` adds the gap between adjacent logos.
  - `main .section:has(.form)` - generic card styling (background via
    `--card-background-color`) so a form reads as a distinct card against
    whatever background color a brand sets, automatically, for any brand.
- `scripts/aem.js` `decorateTemplateAndTheme()` (unchanged, pre-existing):
  still available as an **optional escape hatch** - it reads the `theme`
  metadata value and adds it as a class on `<body>`, for a brand that
  eventually needs bespoke CSS beyond simple color/font swaps. Not required
  for normal brand onboarding.

## Adding a new brand

1. Add a row to the `/metadata` sheet in da.live for that brand's URL prefix
   with its logo, title, description, and colors/font. Preview + Publish.
2. Author form pages under that prefix, each with just a Form block pointing
   at whichever form should render there.

No CSS or code changes needed for either step.
