# Edge Localization Worker (local-only prototype)

`tools/localize-worker/` is a standalone Cloudflare Worker with two related
local-only AI-at-the-edge prototypes for `edsformspoc` forms:

1. **Form translation** — translates a doc-based (sheet) form's display text
   server-side, on request, via a local Ollama model. It is a proof-of-concept
   for "AI personalization at the edge" applied to forms generically — it
   works on the sheet form's own JSON schema, not any one form's specific
   fields, so it applies to any sheet-based form in this repo without
   per-form code.
2. **Team highlight popup** — a `GET /api/team-highlight?team=<Name>` endpoint
   that fetches a team's real, live next-game date from ESPN's public API
   and has the local LLM write a one-line popup message around that real
   fact (never inventing anything else). See
   [Team highlight popup](#team-highlight-popup) below.

## Why it's separate from `blocks/form/`

This is deliberately **not** wired into the site's normal request path. It's
a local dev-only proxy that sits in front of `aem up`:

```
Browser → localize-worker (localhost:8788) → aem up (localhost:3002)
                    │
                    └→ Ollama (localhost:11434, native install)
```

It shares nothing with any other project's Docker setup — it runs directly
on the host via `npx wrangler dev`, and calls a natively installed Ollama.
The only thing to have running alongside it is `aem up` itself and Ollama.

## How it works

1. Every request is proxied transparently to `AEM_ORIGIN` by default —
   HTML, JS, CSS, images, and form JSON all pass through unmodified.
2. When a form's own `.json` endpoint is requested with `?lang=es|fr|hi`,
   the worker fetches the underlying sheet JSON, walks its `data` rows, and
   collects only known **display-text** columns: `Label`, `Description`,
   `tooltip`, `Placeholder`, the `*Error Message` columns, `OptionNames`
   (split per option), and `Value` — but only when a row's `Type` is
   `plain-text`, `submit`, `button`, or `reset` (for every other type,
   `Value` is real prefill data, e.g. a default country code, and is left
   untouched).
3. `Options` (the underlying enum codes), field `Name`/`Id`, and every rule
   expression column (`Required Expression`, `Visible Expression`,
   `Tooltip Visible Expression`) are never sent to the model — the rule
   engine's `country = "USA"`-style comparisons and the submission payload
   depend on those exact values.
4. The collected strings are batched into a single prompt and sent once to
   Ollama (`qwen3.6` by default), asking for a JSON object with the same
   keys translated. The response is parsed and substituted back into the
   row data; the resulting JSON is returned in place of the original.
5. Failures (Ollama down, malformed JSON back) fall back to serving the
   **original, untranslated** JSON rather than breaking the page.
6. Translated JSON is cached in-memory per `(path, lang)`, keyed to the exact
   untranslated sheet JSON it was translated from — no time-based expiry.
   Repeat loads of the same language are instant after the first (LLM)
   request, for as long as the sheet content is unchanged; editing the sheet
   changes the fetched JSON, which is detected on the next request and
   triggers exactly one fresh translation. The cache itself still only lives
   for the life of the `wrangler dev` process (in-memory, not persisted to
   disk) — restarting it clears everything back to a cold state.

## Known limitations

- A comma-separated `OptionNames` list longer than 60 items is skipped
  entirely and left in English (see `MAX_OPTION_ITEMS_TO_TRANSLATE` in
  `worker.js`) — e.g. the Chiefs form's ~248-country dropdown. Translating
  that many strings in one local-LLM call risks truncated or slow output;
  smaller enums (teams, languages) still translate normally.
- Language detection is an explicit user choice (the switcher in
  `blocks/form/form.js`), not real geo/browser-locale detection — `wrangler
  dev` has no access to Cloudflare's real geo data locally, and
  `Accept-Language` is a weaker signal than an explicit choice.
- Only sheet (`:type: sheet`) forms are supported. AEM-based (adaptive)
  form JSON has a different shape and is passed through untranslated.

## Running it

```bash
# 1. aem up must already be running on the port in AEM_ORIGIN (worker.js)
aem up --port 3002

# 2. Ollama must be running natively, with OLLAMA_MODEL pulled
ollama serve   # or the macOS menu-bar app

# 3. from tools/localize-worker/
npm run dev

# 4. browse http://localhost:8788/<page> instead of :3002 directly, so the
#    form's own relative .json fetch also routes through the worker.
```

## Client-side integration

`blocks/form/form.js`'s `decorateLanguageSwitcher()` renders a small button
group above any doc-based form and, on click, re-fetches the form's own
`.json` URL with `?lang=` appended, then re-runs `setupForm()` and swaps the
rendered form in place — no different from a normal (re)load. The supported
language list (`SUPPORTED_LANGUAGES` in `form.js`) must stay in sync with
`SUPPORTED_LANGS` in `worker.js`.

## Team highlight popup

`blocks/form/components/team-highlight/team-highlight.js` is a custom
component (registered in `mappings.js`'s `OOTBComponentDecorators`) that
listens for `change` on whichever `<select>` it's attached to and shows a
popup built from `worker.js`'s `/api/team-highlight?team=<Name>` response.

**To enable it on a field**: set that field's sheet row `Custom Type` column
to `team-highlight` (e.g. the `favoriteteam` row in the Chiefs sheet). This
is a one-time technical flag per field, not per-event content — the popup's
actual content is always live-fetched, never authored.

**What the endpoint does** (`handleTeamHighlight()` in `worker.js`):
1. Maps the selected value (e.g. `"Chiefs"`) to an ESPN team abbreviation +
   official display name via the fixed `NFL_TEAMS` table — a technical
   constant like the country ISO list, not authored content.
2. Fetches that team's real upcoming schedule from ESPN's public API
   (`site.api.espn.com`, no auth needed) and picks the next future game.
3. Asks the local LLM for one short popup sentence using **only** that real
   fact — the prompt explicitly forbids inventing any other game, date,
   opponent, or news, and explicitly forbids referencing headlines, articles,
   or player names it wasn't given (an earlier version also fetched a
   team-tagged headline for flavor, but since the popup never displayed it
   as a link/citation, the AI's references to it read as an unexplained
   non-sequitur — dropped in favor of a message that's entirely about team
   pride and finishing the signup). If the LLM call fails, a plain template
   string built from the real fetched fact is used instead, so the popup
   never goes empty or silent-fails on the AI step alone.
4. Caches the result in memory per `(team, lang)` for 10 minutes.

**Non-obvious gotcha**: ESPN's edge WAF returns 403 for requests with no (or
a generic browser-style) `User-Agent` header, but allows a plain `curl/*`
one — `ESPN_FETCH_HEADERS` in `worker.js` sets this explicitly. Without it,
every ESPN fetch silently 403s and the popup falls back to a generic
no-facts message.

If the endpoint isn't reachable (e.g. the form is viewed directly against
`aem up` instead of through this Worker), the component fails silently and
shows no popup, rather than fabricating content.
