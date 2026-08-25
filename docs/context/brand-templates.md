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
  `title`, `description`, `logo`, `background-color`, `text-color`,
  `link-color`, `card-background-color`, `font`.
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
  `description` metadata and prepends a `.brand-banner` element (logo image,
  heading, description) to `<main>`, before the page's authored sections.
  **Opt-in**: only renders when `logo` is present, so pages/sites without a
  brand logo (e.g. internal test pages) are unaffected.
- `styles/styles.css`:
  - `.brand-banner` - generic layout for the logo/title/description banner.
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
