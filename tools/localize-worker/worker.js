/**
 * Local-only edge localization worker for edsformspoc's doc-based (sheet) forms.
 *
 * Transparently proxies the local `aem up` dev server (AEM_ORIGIN). When a
 * form's own .json endpoint is requested with a supported ?lang= param, the
 * response's human-facing display text (labels, descriptions, tooltips,
 * option names, plain-text/button copy) is translated via a local Ollama
 * model before being returned. Field ids, names, enum codes (Options), and
 * rule expressions are never touched - the rule engine and the sheet's own
 * value comparisons (e.g. country = "USA") depend on those exact strings.
 *
 * This is intentionally independent of any other project's Docker setup:
 * it runs directly on the host via `npx wrangler dev` (see package.json)
 * and talks to a natively-installed Ollama, not a containerized one.
 *
 * Run:
 *   1. `aem up --port 3002` in the edsformspoc repo root (AEM_ORIGIN below)
 *   2. `ollama serve` (native macOS app, or `ollama serve` in a terminal)
 *   3. `npm run dev` in this folder
 *   4. Browse http://localhost:8788/<page> instead of :3002 directly, so
 *      the form's relative .json fetch also routes through this worker.
 */

const AEM_ORIGIN = 'http://localhost:3002';
// 127.0.0.1, not 'localhost': a Docker container publishing the same port
// (e.g. another project's Ollama) can also bind 11434 on the IPv6 wildcard,
// and which one 'localhost' resolves to is not guaranteed to be consistent
// across clients. The literal loopback IP always reaches the native app.
const OLLAMA_URL = 'http://127.0.0.1:11434';
// qwen3.6 (23GB) measured ~48s for a single trivial word on this hardware -
// too slow to be usable. qwen2.5-coder:14b measured ~5s for the same
// prompt and is disciplined about strict JSON output, so it's the better
// fit here despite being a "coder" model rather than a general one.
const OLLAMA_MODEL = 'qwen2.5-coder:14b';

// Keep in sync with SUPPORTED_LANGUAGES in blocks/form/form.js (minus 'en',
// which always means "no translation, pass through the original").
const SUPPORTED_LANGS = {
  es: 'Spanish',
  fr: 'French',
  hi: 'Hindi',
};

// Sheet columns that are always human-facing display text.
const ALWAYS_TRANSLATE_COLUMNS = [
  'Label',
  'Description',
  'tooltip',
  'Placeholder',
  'Required Error Message',
  'Pattern Error Message',
  'Min Error Message',
  'Max Error Message',
  'Thank You Message',
];

// 'Value' is display copy only for these field types (plain-text blocks,
// button labels). For every other type it's actual data (e.g. a pre-filled
// default) and must never be translated. The submit row's post-submit
// behavior now lives in the explicit 'Redirect URL' / 'Thank You Message'
// columns above instead of 'Value', so 'submit' no longer belongs here -
// translating it would burn a translation call on an unused field.
const VALUE_IS_DISPLAY_TEXT_FOR_TYPES = new Set(['plain-text', 'plaintext', 'button', 'reset']);

// A comma-separated OptionNames list longer than this is skipped (left in
// English) rather than translated - e.g. the Chiefs form's 248-country list
// would otherwise turn one Ollama call into ~300 strings, which risks
// timing out or truncating on a local model. Short enums (teams, languages)
// still translate normally.
const MAX_OPTION_ITEMS_TO_TRANSLATE = 60;

// In-memory cache: `${pathname}::${lang}` -> { sourceJson, json }. sourceJson
// is the untranslated sheet body exactly as fetched from the origin - kept
// alongside the translated result so a later request can detect a real
// content edit (someone changed the sheet) and re-translate, while every
// other request for the same pathname+lang is served instantly with no
// Ollama call, for as long as this worker process stays up. There is no
// time-based expiry - a demo/content edit is the only thing that should ever
// invalidate a translation, not a clock. Cleared on worker restart; fine for
// local dev/demo use.
const translationCache = new Map();

// Fixed technical mapping from this repo's sheet enum values (Options
// column in the favoriteteam field) to ESPN's team abbreviation + official
// display name. Not authored/maintained content - like the country ISO
// list already in the sheet, this only changes if a team relocates/renames.
const NFL_TEAMS = {
  Cardinals: { abbr: 'ari', fullName: 'Arizona Cardinals' },
  Falcons: { abbr: 'atl', fullName: 'Atlanta Falcons' },
  Ravens: { abbr: 'bal', fullName: 'Baltimore Ravens' },
  Bills: { abbr: 'buf', fullName: 'Buffalo Bills' },
  Panthers: { abbr: 'car', fullName: 'Carolina Panthers' },
  Bears: { abbr: 'chi', fullName: 'Chicago Bears' },
  Bengals: { abbr: 'cin', fullName: 'Cincinnati Bengals' },
  Browns: { abbr: 'cle', fullName: 'Cleveland Browns' },
  Cowboys: { abbr: 'dal', fullName: 'Dallas Cowboys' },
  Broncos: { abbr: 'den', fullName: 'Denver Broncos' },
  Lions: { abbr: 'det', fullName: 'Detroit Lions' },
  Packers: { abbr: 'gb', fullName: 'Green Bay Packers' },
  Texans: { abbr: 'hou', fullName: 'Houston Texans' },
  Colts: { abbr: 'ind', fullName: 'Indianapolis Colts' },
  Jaguars: { abbr: 'jax', fullName: 'Jacksonville Jaguars' },
  Chiefs: { abbr: 'kc', fullName: 'Kansas City Chiefs' },
  Raiders: { abbr: 'lv', fullName: 'Las Vegas Raiders' },
  Chargers: { abbr: 'lac', fullName: 'Los Angeles Chargers' },
  Rams: { abbr: 'lar', fullName: 'Los Angeles Rams' },
  Dolphins: { abbr: 'mia', fullName: 'Miami Dolphins' },
  Vikings: { abbr: 'min', fullName: 'Minnesota Vikings' },
  Patriots: { abbr: 'ne', fullName: 'New England Patriots' },
  Saints: { abbr: 'no', fullName: 'New Orleans Saints' },
  Giants: { abbr: 'nyg', fullName: 'New York Giants' },
  Jets: { abbr: 'nyj', fullName: 'New York Jets' },
  Eagles: { abbr: 'phi', fullName: 'Philadelphia Eagles' },
  Steelers: { abbr: 'pit', fullName: 'Pittsburgh Steelers' },
  '49ers': { abbr: 'sf', fullName: 'San Francisco 49ers' },
  Seahawks: { abbr: 'sea', fullName: 'Seattle Seahawks' },
  Buccaneers: { abbr: 'tb', fullName: 'Tampa Bay Buccaneers' },
  Titans: { abbr: 'ten', fullName: 'Tennessee Titans' },
  Commanders: { abbr: 'wsh', fullName: 'Washington Commanders' },
};

// Fixed, known set of customer segments this demo can personalize for - a
// real integration would resolve these (and richer attributes) from a CRM
// or Adobe Experience Platform Real-Time CDP profile lookup, not a hardcoded
// map. The description text is prompt context for the AI, not shown to users.
const CUSTOMER_SEGMENTS = {
  lapsed: {
    description: 'a fan who signed up before but has not engaged in a while - aim for a warm, low-pressure re-engagement, not a hard sell',
    isReturning: true,
  },
  new_visitor: {
    description: 'someone who has never signed up before - aim for a welcoming, exciting first impression',
    isReturning: false,
  },
  vip: {
    description: 'a loyal, highly engaged fan who already receives frequent updates - aim to make them feel recognized and valued',
    isReturning: false,
  },
};

const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Brand path prefix -> the one team that's a real, known signal for that
// brand's page (not a guess about the visitor). DOB or any other attribute
// with no such signal is deliberately never defaulted this way.
const BRAND_DEFAULT_TEAM = {
  chiefs: 'Chiefs',
};

// In-memory cache: `${pathname}::${segment}::${name}` -> personalized HTML.
const profileCache = new Map();

const ESPN_ORIGIN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
// ESPN's edge WAF 403s requests with no/blank User-Agent or a generic
// browser-style one - a plain "curl/*" string passes, so fetches here send
// one explicitly rather than relying on workerd's own default.
const ESPN_FETCH_HEADERS = { 'User-Agent': 'curl/8.7.1' };

// In-memory cache for the highlight endpoint, keyed by `${team}::${lang}`.
// ESPN data + the AI summary don't need to be refetched on every popup.
const highlightCache = new Map();
const HIGHLIGHT_CACHE_TTL_MS = 10 * 60 * 1000;

// ESPN's schedule endpoint defaults to seasontype=1 (preseason) only, with no
// indication in the response that it's a partial view - once preseason ends,
// that endpoint alone returns only past games, so the "next game" lookup
// would silently find nothing for the rest of the year. Preseason (1),
// regular season (2), and postseason (3) are fetched and merged so the next
// real game is found correctly regardless of which phase of the year it is.
const SEASON_TYPES = [1, 2, 3];

async function fetchNextEvent(abbr) {
  const responses = await Promise.all(
    SEASON_TYPES.map((seasontype) => fetch(
      `${ESPN_ORIGIN}/teams/${abbr}/schedule?seasontype=${seasontype}`,
      { headers: ESPN_FETCH_HEADERS },
    ).catch(() => null)),
  );
  const events = [];
  await Promise.all(responses.map(async (res) => {
    if (!res || !res.ok) return;
    const data = await res.json();
    events.push(...(data.events || []));
  }));

  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.date).getTime() >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0];
  if (!next) return null;
  return { name: next.name, date: next.date };
}

function buildHighlightPrompt(team, event, language) {
  const langClause = language ? `Write it in ${language}.` : 'Write it in English.';
  const fact = event
    ? `Their next game is ${event.name} on ${new Date(event.date).toDateString()}.`
    : 'No upcoming game is currently scheduled.';
  return `You are writing a single short, exciting popup message (max 2 sentences) for an NFL fan who just picked the ${team} as their favorite team on a newsletter signup form.
Goal: make them feel like part of the ${team} fanbase, and motivate them to finish signing up for the newsletter so they don't miss anything about their team.
Use ONLY this real fact - do not invent any other game, date, opponent, or news: ${fact}
Do not mention any headlines, articles, trades, or player names - you were not given any.
${langClause}
Return ONLY the message text, no quotes, no markdown, no explanation.`;
}

async function askOllama(prompt, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keep_alive: Ollama's default unloads the model ~5 min after the last
      // request; during active local testing that means frequent cold
      // reloads (real added latency on top of generation time). Keeping it
      // warm for 30 min avoids that without changing anything about output.
      body: JSON.stringify({
        model: OLLAMA_MODEL, prompt, stream: false, keep_alive: '30m',
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.response.trim();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Ollama request timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) { /* fall through */ }
  return null;
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    if (key) cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

// Resolves a "known customer" signal from either a fresh query param (as a
// personalized campaign/email link would carry) or a previously-set cookie
// (a return visit with no query param at all). This is what's being
// simulated here in place of a real CRM/RTCDP profile lookup - the point
// being demonstrated is "the site recognizes a known visitor and adapts",
// not the lookup mechanism itself. Returns null when neither signal is
// present, which is the common case and leaves every other request path
// completely untouched.
function resolveCustomerProfile(request, url) {
  const qpSegment = url.searchParams.get('segment');
  if (qpSegment && CUSTOMER_SEGMENTS[qpSegment]) {
    return {
      segment: qpSegment,
      name: url.searchParams.get('name') || null,
      lastname: url.searchParams.get('lastname') || null,
      email: url.searchParams.get('email') || null,
      fresh: true,
    };
  }
  const cookies = parseCookies(request);
  if (cookies.profile_segment && CUSTOMER_SEGMENTS[cookies.profile_segment]) {
    return {
      segment: cookies.profile_segment,
      name: cookies.profile_name || null,
      lastname: cookies.profile_lastname || null,
      email: cookies.profile_email || null,
      fresh: false,
    };
  }
  return null;
}

function buildProfilePrompt(segment, name) {
  const { description, isReturning } = CUSTOMER_SEGMENTS[segment];
  const nameClause = name
    ? `Address them by name: ${name}.`
    : 'No name is known - address them generically, do not invent one.';
  // Without this, the model defaults to generic "welcome back" boilerplate
  // regardless of segment, which is actively wrong for vip/new_visitor (they
  // haven't been away) and makes segments read as indistinguishable.
  const returningClause = isReturning
    ? 'This fan has been away for a while, so "welcome back" style language is appropriate.'
    : 'This fan has NOT been away - never use "welcome back," "come back," or any language implying absence. They are either brand new or have stayed continuously engaged.';
  return `You are writing personalized copy for an NFL newsletter sign-up page, for this specific type of visitor: ${description}.
${nameClause}
${returningClause}
Use ONLY the facts given here - do not invent any offer, discount, date, or other detail not stated.
Return ONLY a JSON object with exactly these three keys:
{"title": "...", "description": "...", "favoriteTeamLabel": "..."}
- title: a page title, under 60 characters.
- description: a one-sentence page description, under 140 characters.
- favoriteTeamLabel: a short, warm rephrasing of the form field label "Favorite Team". If a name was given, you MUST include it (e.g. "Alex's Favorite Team"). If no name was given, keep it close to the original, e.g. "Your Favorite Team". Under 40 characters, no trailing punctuation.
No markdown fences, no explanation.`;
}

// One AI call per (segment, name) pair produces all personalized copy for
// that visitor - shared between the page-level HTML personalization and the
// form-model JSON field personalization below, so a visitor who triggers
// both doesn't pay for two separate LLM calls.
const profileCopyCache = new Map();

async function getProfileCopy(segment, name) {
  const key = `${segment}::${name || ''}`;
  if (profileCopyCache.has(key)) return profileCopyCache.get(key);

  const raw = await askOllama(buildProfilePrompt(segment, name));
  const parsed = parseJsonResponse(raw);
  if (!parsed || !parsed.title || !parsed.description || !parsed.favoriteTeamLabel) {
    throw new Error(`Non-JSON or incomplete profile response: ${raw.slice(0, 200)}`);
  }
  profileCopyCache.set(key, parsed);
  return parsed;
}

function appendProfileCookies(headers, profile) {
  if (!profile.fresh) return;
  headers.append('Set-Cookie', `profile_segment=${encodeURIComponent(profile.segment)}; Path=/; Max-Age=${PROFILE_COOKIE_MAX_AGE}; SameSite=Lax`);
  ['name', 'lastname', 'email'].forEach((field) => {
    if (profile[field]) {
      headers.append('Set-Cookie', `profile_${field}=${encodeURIComponent(profile[field])}; Path=/; Max-Age=${PROFILE_COOKIE_MAX_AGE}; SameSite=Lax`);
    }
  });
}

// Relabels the favorite-team field with the AI-phrased copy, and - only for
// brands with a known default team (a real signal: which brand's page this
// is) and only when the visitor hasn't already got a value - preselects it.
// Never touches fields with no such real-world signal (e.g. DOB).
function applyFieldPersonalization(body, copy, pathname, profile) {
  const favoriteTeamRow = body.data.find((row) => row.Name === 'favoriteteam');
  if (favoriteTeamRow) {
    favoriteTeamRow.Label = copy.favoriteTeamLabel;

    const brand = pathname.split('/').filter(Boolean)[0];
    const defaultTeam = BRAND_DEFAULT_TEAM[brand];
    if (defaultTeam && !favoriteTeamRow.Value) {
      favoriteTeamRow.Value = defaultTeam;
    }
  }

  // Autofills contact fields only when the profile carries more than just a
  // first name - lastname or email present means a real CRM/RTCDP contact
  // record was matched, not just a marketing-link personalization token. A
  // bare first name alone (e.g. Alex's URL) still drives the title and label
  // copy, but does not by itself justify pre-filling the actual form fields.
  if (profile.lastname || profile.email) {
    const knownValues = {
      firstname: profile.name,
      lastname: profile.lastname,
      email: profile.email,
    };
    Object.entries(knownValues).forEach(([fieldName, value]) => {
      if (!value) return;
      const row = body.data.find((r) => r.Name === fieldName);
      if (row && !row.Value) row.Value = value;
    });
  }

  return body;
}

function escapeHtmlAttribute(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtmlText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyProfileToHtml(html, title, description) {
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlText(title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeHtmlAttribute(description)}">`,
  );
  return out;
}

async function personalizeHtmlResponse(aemRes, profile, pathname) {
  const cacheKey = `${pathname}::${profile.segment}::${profile.name || ''}`;
  let html = profileCache.get(cacheKey);

  if (!html) {
    const rawHtml = await aemRes.text();
    try {
      const copy = await getProfileCopy(profile.segment, profile.name);
      html = applyProfileToHtml(rawHtml, copy.title, copy.description);
      profileCache.set(cacheKey, html);
      console.log(`[localize-worker] Personalized ${pathname} for segment=${profile.segment}`);
    } catch (err) {
      console.error('[localize-worker] Profile personalization failed, serving original:', err.message);
      html = rawHtml;
    }
  }

  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  appendProfileCookies(headers, profile);
  return new Response(html, { status: aemRes.status, headers });
}

const formJsonCache = new Map();

async function personalizeFormJson(aemRes, profile, pathname) {
  const cacheKey = `${pathname}::${profile.segment}::${profile.name || ''}::${profile.lastname || ''}::${profile.email || ''}`;
  let json = formJsonCache.get(cacheKey);

  if (!json) {
    const body = await aemRes.json();
    if (body?.[':type'] !== 'sheet' || !Array.isArray(body.data)) {
      json = JSON.stringify(body);
    } else {
      try {
        const copy = await getProfileCopy(profile.segment, profile.name);
        applyFieldPersonalization(body, copy, pathname, profile);
        json = JSON.stringify(body);
        formJsonCache.set(cacheKey, json);
        console.log(`[localize-worker] Personalized fields for ${pathname}, segment=${profile.segment}`);
      } catch (err) {
        console.error('[localize-worker] Field personalization failed, serving original:', err.message);
        json = JSON.stringify(body);
      }
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendProfileCookies(headers, profile);
  return new Response(json, { status: aemRes.status, headers });
}

async function handleTeamHighlight(url) {
  const team = url.searchParams.get('team');
  const lang = url.searchParams.get('lang');
  const teamInfo = NFL_TEAMS[team];
  if (!teamInfo) {
    return new Response(JSON.stringify({ error: 'Unknown team' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cacheKey = `${team}::${lang || 'en'}`;
  const cached = highlightCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HIGHLIGHT_CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.body), { headers: { 'Content-Type': 'application/json' } });
  }

  const event = await fetchNextEvent(teamInfo.abbr);

  let message;
  try {
    const language = lang && SUPPORTED_LANGS[lang];
    message = await askOllama(buildHighlightPrompt(teamInfo.fullName, event, language));
  } catch (err) {
    console.error('[localize-worker] team-highlight AI summary failed:', err.message);
    message = event
      ? `Go ${teamInfo.fullName}! Next up: ${event.name} on ${new Date(event.date).toDateString()}.`
      : `Go ${teamInfo.fullName}!`;
  }

  const body = {
    team: teamInfo.fullName,
    logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${teamInfo.abbr}.png`,
    event,
    message,
  };
  highlightCache.set(cacheKey, { at: Date.now(), body });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

// Collects every translatable string out of a sheet form's `data` rows into
// a flat { key: text } map. OptionNames is comma-separated (see util.js
// handleMultiValues()) so each option gets its own key - translating the
// whole comma-joined string as one blob risks the model introducing a
// stray comma inside a single option's translated text.
function collectTranslatable(rows) {
  const strings = {};
  rows.forEach((row, i) => {
    ALWAYS_TRANSLATE_COLUMNS.forEach((col) => {
      if (row[col]) strings[`${i}::${col}`] = String(row[col]);
    });
    if (row.OptionNames) {
      const names = String(row.OptionNames).split(',').map((n) => n.trim());
      if (names.length <= MAX_OPTION_ITEMS_TO_TRANSLATE) {
        names.forEach((name, j) => {
          if (name) strings[`${i}::OptionNames::${j}`] = name;
        });
      }
    }
    if (row.Value && VALUE_IS_DISPLAY_TEXT_FOR_TYPES.has(row.Type)) {
      strings[`${i}::Value`] = String(row.Value);
    }
  });
  return strings;
}

// Writes translated strings back into the row data. Missing keys (e.g. an
// OptionNames list that was skipped for being too long) fall back to the
// original text, so a partial/failed translation degrades gracefully
// instead of dropping content.
function applyTranslations(rows, translated) {
  rows.forEach((row, i) => {
    ALWAYS_TRANSLATE_COLUMNS.forEach((col) => {
      const key = `${i}::${col}`;
      if (translated[key]) row[col] = translated[key];
    });
    if (row.OptionNames) {
      const originalNames = String(row.OptionNames).split(',').map((n) => n.trim());
      row.OptionNames = originalNames
        .map((name, j) => translated[`${i}::OptionNames::${j}`] || name)
        .join(',');
    }
    const valueKey = `${i}::Value`;
    if (row.Value && VALUE_IS_DISPLAY_TEXT_FOR_TYPES.has(row.Type) && translated[valueKey]) {
      row.Value = translated[valueKey];
    }
  });
}

function buildPrompt(strings, language) {
  const entries = Object.entries(strings)
    .map(([key, text]) => `  ${JSON.stringify(key)}: ${JSON.stringify(text)}`)
    .join(',\n');
  return `You are translating UI copy for a web form into ${language}.

Rules:
- Translate ONLY the text content, never HTML tags or attributes (e.g. keep <a href="..."> exactly as-is, translate only the visible text inside it).
- Keep exactly the same JSON keys in your response.
- Keep translations natural and concise - do not add extra sentences or explanations.
- Return ONLY a single valid JSON object, no markdown fences, no commentary.

Input:
{
${entries}
}

Output the same keys with their ${language} translations, as one JSON object.`;
}

// Translating a whole form (a few dozen strings in one prompt) is a much
// larger generation than the short single-message calls elsewhere in this
// file, and non-Latin scripts make it worse: Hindi's Devanagari output needs
// substantially more tokens per word than Spanish/French, so the same form
// that translates in a few seconds into those languages can still be
// actively generating past the default 120s timeout for Hindi - confirmed
// directly (translation still in progress at the 120s cutoff, not stalled).
const FORM_TRANSLATION_TIMEOUT_MS = 240_000;

async function translateSheetForm(body, lang) {
  const strings = collectTranslatable(body.data);
  if (Object.keys(strings).length === 0) return body;

  const language = SUPPORTED_LANGS[lang];
  const raw = await askOllama(buildPrompt(strings, language), FORM_TRANSLATION_TIMEOUT_MS);
  const translated = parseJsonResponse(raw);
  if (!translated) throw new Error(`Non-JSON translation response: ${raw.slice(0, 200)}`);

  applyTranslations(body.data, translated);
  return body;
}

// Params this worker consumes itself and must never forward to the origin -
// aem up/da.live's own routing doesn't expect them, and passing them through
// caused a broken/mixed response (a 404 fragment appearing alongside real
// page content) rather than a clean pass-through.
const WORKER_ONLY_PARAMS = new Set(['lang', 'segment', 'name', 'lastname', 'email']);

function buildAemUrl(url) {
  const aemUrl = new URL(AEM_ORIGIN);
  aemUrl.pathname = url.pathname;
  url.searchParams.forEach((value, key) => {
    if (!WORKER_ONLY_PARAMS.has(key)) aemUrl.searchParams.set(key, value);
  });
  return aemUrl.toString();
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/team-highlight') {
      return handleTeamHighlight(url);
    }

    const lang = url.searchParams.get('lang');

    const headers = new Headers(request.headers);
    headers.set('Accept-Encoding', 'identity');
    const aemRes = await fetch(buildAemUrl(url), { method: request.method, headers });

    const contentType = aemRes.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const isHtml = contentType.includes('text/html');

    // Customer-profile personalization (title/description) for HTML pages
    // only, and only when an explicit profile signal exists via cookie or
    // query param - everything else falls straight through to the existing
    // untouched JSON/passthrough logic below.
    let cookieSensitive = false;
    if (isHtml && request.method === 'GET' && aemRes.ok) {
      cookieSensitive = true;
      const profile = resolveCustomerProfile(request, url);
      if (profile) {
        return personalizeHtmlResponse(aemRes, profile, url.pathname);
      }
    }

    // Customer-profile field-level personalization (relabel/prefill specific
    // form fields) for the form's JSON model, independent of the HTML branch
    // above since it's a separate request. Skipped when a language switch is
    // also requested on the same request - combining both isn't part of this
    // demo, and translation below takes priority in that case.
    if (isJson && request.method === 'GET' && aemRes.ok && !(lang && SUPPORTED_LANGS[lang])) {
      cookieSensitive = true;
      const profile = resolveCustomerProfile(request, url);
      if (profile) {
        return personalizeFormJson(aemRes, profile, url.pathname);
      }
    }

    // Transparent proxy: no lang, unsupported lang, or non-JSON response.
    if (!isJson || !lang || !SUPPORTED_LANGS[lang]) {
      if (cookieSensitive) {
        // This request was checked for a cookie-driven profile above, even
        // though none matched this time. aem up's own Cache-Control (e.g.
        // "max-age=60") has no Vary: Cookie, so a browser or shared cache
        // would happily replay this exact response to a later request that
        // *does* carry a profile cookie, silently suppressing personalization
        // until the cache entry expires. Force no-store so every cookie-
        // checked request is re-evaluated by this Worker every time.
        const passthroughHeaders = new Headers(aemRes.headers);
        passthroughHeaders.set('Cache-Control', 'no-store');
        return new Response(aemRes.body, { status: aemRes.status, headers: passthroughHeaders });
      }
      return aemRes;
    }

    const body = await aemRes.json();

    // Only sheet (doc-based) forms are supported for now - AEM/adaptive
    // form JSON has a different shape and is passed through untouched.
    if (body?.[':type'] !== 'sheet' || !Array.isArray(body.data)) {
      return new Response(JSON.stringify(body), {
        status: aemRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // The origin fetch above already happens on every request (this worker
    // is a proxy, not a cache in front of aem up), so this comparison costs
    // nothing extra over the network - only a cheap in-memory string check.
    // A byte-for-byte-unchanged sourceJson means the sheet hasn't been
    // edited since the last translation, so the cached result is still
    // exactly correct and the slow Ollama call is skipped entirely.
    const cacheKey = `${url.pathname}::${lang}`;
    const sourceJson = JSON.stringify(body);
    const cached = translationCache.get(cacheKey);
    if (cached && cached.sourceJson === sourceJson) {
      return new Response(cached.json, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    try {
      const translatedBody = await translateSheetForm(body, lang);
      const json = JSON.stringify(translatedBody);
      translationCache.set(cacheKey, { sourceJson, json });
      console.log(`[localize-worker] Translated ${url.pathname} -> ${lang}`);
      return new Response(json, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      console.error('[localize-worker] Translation failed, serving original:', err.message);
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  },
};
