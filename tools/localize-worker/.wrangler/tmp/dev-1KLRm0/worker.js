var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var AEM_ORIGIN = "http://localhost:3002";
var OLLAMA_URL = "http://127.0.0.1:11434";
var OLLAMA_MODEL = "qwen2.5-coder:14b";
var SUPPORTED_LANGS = {
  es: "Spanish",
  fr: "French",
  hi: "Hindi"
};
var ALWAYS_TRANSLATE_COLUMNS = [
  "Label",
  "Description",
  "tooltip",
  "Placeholder",
  "Required Error Message",
  "Pattern Error Message",
  "Min Error Message",
  "Max Error Message"
];
var VALUE_IS_DISPLAY_TEXT_FOR_TYPES = /* @__PURE__ */ new Set(["plain-text", "plaintext", "submit", "button", "reset"]);
var MAX_OPTION_ITEMS_TO_TRANSLATE = 60;
var translationCache = /* @__PURE__ */ new Map();
var NFL_TEAMS = {
  Cardinals: { abbr: "ari", fullName: "Arizona Cardinals" },
  Falcons: { abbr: "atl", fullName: "Atlanta Falcons" },
  Ravens: { abbr: "bal", fullName: "Baltimore Ravens" },
  Bills: { abbr: "buf", fullName: "Buffalo Bills" },
  Panthers: { abbr: "car", fullName: "Carolina Panthers" },
  Bears: { abbr: "chi", fullName: "Chicago Bears" },
  Bengals: { abbr: "cin", fullName: "Cincinnati Bengals" },
  Browns: { abbr: "cle", fullName: "Cleveland Browns" },
  Cowboys: { abbr: "dal", fullName: "Dallas Cowboys" },
  Broncos: { abbr: "den", fullName: "Denver Broncos" },
  Lions: { abbr: "det", fullName: "Detroit Lions" },
  Packers: { abbr: "gb", fullName: "Green Bay Packers" },
  Texans: { abbr: "hou", fullName: "Houston Texans" },
  Colts: { abbr: "ind", fullName: "Indianapolis Colts" },
  Jaguars: { abbr: "jax", fullName: "Jacksonville Jaguars" },
  Chiefs: { abbr: "kc", fullName: "Kansas City Chiefs" },
  Raiders: { abbr: "lv", fullName: "Las Vegas Raiders" },
  Chargers: { abbr: "lac", fullName: "Los Angeles Chargers" },
  Rams: { abbr: "lar", fullName: "Los Angeles Rams" },
  Dolphins: { abbr: "mia", fullName: "Miami Dolphins" },
  Vikings: { abbr: "min", fullName: "Minnesota Vikings" },
  Patriots: { abbr: "ne", fullName: "New England Patriots" },
  Saints: { abbr: "no", fullName: "New Orleans Saints" },
  Giants: { abbr: "nyg", fullName: "New York Giants" },
  Jets: { abbr: "nyj", fullName: "New York Jets" },
  Eagles: { abbr: "phi", fullName: "Philadelphia Eagles" },
  Steelers: { abbr: "pit", fullName: "Pittsburgh Steelers" },
  "49ers": { abbr: "sf", fullName: "San Francisco 49ers" },
  Seahawks: { abbr: "sea", fullName: "Seattle Seahawks" },
  Buccaneers: { abbr: "tb", fullName: "Tampa Bay Buccaneers" },
  Titans: { abbr: "ten", fullName: "Tennessee Titans" },
  Commanders: { abbr: "wsh", fullName: "Washington Commanders" }
};
var CUSTOMER_SEGMENTS = {
  lapsed: "a fan who signed up before but has not engaged in a while - aim for a warm, low-pressure re-engagement, not a hard sell",
  new_visitor: "someone who has never signed up before - aim for a welcoming, exciting first impression",
  vip: "a loyal, highly engaged fan who already receives frequent updates - aim to make them feel recognized and valued"
};
var PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
var BRAND_DEFAULT_TEAM = {
  chiefs: "Chiefs"
};
var profileCache = /* @__PURE__ */ new Map();
var ESPN_ORIGIN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
var ESPN_FETCH_HEADERS = { "User-Agent": "curl/8.7.1" };
var highlightCache = /* @__PURE__ */ new Map();
var HIGHLIGHT_CACHE_TTL_MS = 10 * 60 * 1e3;
async function fetchNextEvent(abbr) {
  const res = await fetch(`${ESPN_ORIGIN}/teams/${abbr}/schedule`, { headers: ESPN_FETCH_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const now = Date.now();
  const upcoming = (data.events || []).filter((e) => new Date(e.date).getTime() >= now).sort((a, b) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0];
  if (!next) return null;
  return { name: next.name, date: next.date };
}
__name(fetchNextEvent, "fetchNextEvent");
function buildHighlightPrompt(team, event, language) {
  const langClause = language ? `Write it in ${language}.` : "Write it in English.";
  const fact = event ? `Their next game is ${event.name} on ${new Date(event.date).toDateString()}.` : "No upcoming game is currently scheduled.";
  return `You are writing a single short, exciting popup message (max 2 sentences) for an NFL fan who just picked the ${team} as their favorite team on a newsletter signup form.
Goal: make them feel like part of the ${team} fanbase, and motivate them to finish signing up for the newsletter so they don't miss anything about their team.
Use ONLY this real fact - do not invent any other game, date, opponent, or news: ${fact}
Do not mention any headlines, articles, trades, or player names - you were not given any.
${langClause}
Return ONLY the message text, no quotes, no markdown, no explanation.`;
}
__name(buildHighlightPrompt, "buildHighlightPrompt");
async function askOllama(prompt, timeoutMs = 12e4) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keep_alive: Ollama's default unloads the model ~5 min after the last
      // request; during active local testing that means frequent cold
      // reloads (real added latency on top of generation time). Keeping it
      // warm for 30 min avoids that without changing anything about output.
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        keep_alive: "30m"
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.response.trim();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Ollama request timed out after ${timeoutMs / 1e3}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
__name(askOllama, "askOllama");
function parseJsonResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) {
  }
  return null;
}
__name(parseJsonResponse, "parseJsonResponse");
function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    if (key) cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}
__name(parseCookies, "parseCookies");
function resolveCustomerProfile(request, url) {
  const qpSegment = url.searchParams.get("segment");
  if (qpSegment && CUSTOMER_SEGMENTS[qpSegment]) {
    return { segment: qpSegment, name: url.searchParams.get("name") || null, fresh: true };
  }
  const cookies = parseCookies(request);
  if (cookies.profile_segment && CUSTOMER_SEGMENTS[cookies.profile_segment]) {
    return { segment: cookies.profile_segment, name: cookies.profile_name || null, fresh: false };
  }
  return null;
}
__name(resolveCustomerProfile, "resolveCustomerProfile");
function buildProfilePrompt(segment, name) {
  const nameClause = name ? `Address them by name: ${name}.` : "No name is known - address them generically, do not invent one.";
  return `You are writing personalized copy for an NFL newsletter sign-up page, for this specific type of visitor: ${CUSTOMER_SEGMENTS[segment]}.
${nameClause}
Use ONLY the facts given here - do not invent any offer, discount, date, or other detail not stated.
Return ONLY a JSON object with exactly these three keys:
{"title": "...", "description": "...", "favoriteTeamLabel": "..."}
- title: a page title, under 60 characters.
- description: a one-sentence page description, under 140 characters.
- favoriteTeamLabel: a short, warm rephrasing of the form field label "Favorite Team". If a name was given, you MUST include it (e.g. "Alex's Favorite Team"). If no name was given, keep it close to the original, e.g. "Your Favorite Team". Under 40 characters, no trailing punctuation.
No markdown fences, no explanation.`;
}
__name(buildProfilePrompt, "buildProfilePrompt");
var profileCopyCache = /* @__PURE__ */ new Map();
async function getProfileCopy(segment, name) {
  const key = `${segment}::${name || ""}`;
  if (profileCopyCache.has(key)) return profileCopyCache.get(key);
  const raw = await askOllama(buildProfilePrompt(segment, name));
  const parsed = parseJsonResponse(raw);
  if (!parsed || !parsed.title || !parsed.description || !parsed.favoriteTeamLabel) {
    throw new Error(`Non-JSON or incomplete profile response: ${raw.slice(0, 200)}`);
  }
  profileCopyCache.set(key, parsed);
  return parsed;
}
__name(getProfileCopy, "getProfileCopy");
function appendProfileCookies(headers, profile) {
  if (!profile.fresh) return;
  headers.append("Set-Cookie", `profile_segment=${encodeURIComponent(profile.segment)}; Path=/; Max-Age=${PROFILE_COOKIE_MAX_AGE}; SameSite=Lax`);
  if (profile.name) {
    headers.append("Set-Cookie", `profile_name=${encodeURIComponent(profile.name)}; Path=/; Max-Age=${PROFILE_COOKIE_MAX_AGE}; SameSite=Lax`);
  }
}
__name(appendProfileCookies, "appendProfileCookies");
function applyFieldPersonalization(body, copy, pathname) {
  const favoriteTeamRow = body.data.find((row) => row.Name === "favoriteteam");
  if (!favoriteTeamRow) return body;
  favoriteTeamRow.Label = copy.favoriteTeamLabel;
  const brand = pathname.split("/").filter(Boolean)[0];
  const defaultTeam = BRAND_DEFAULT_TEAM[brand];
  if (defaultTeam && !favoriteTeamRow.Value) {
    favoriteTeamRow.Value = defaultTeam;
  }
  return body;
}
__name(applyFieldPersonalization, "applyFieldPersonalization");
function escapeHtmlAttribute(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
__name(escapeHtmlAttribute, "escapeHtmlAttribute");
function escapeHtmlText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escapeHtmlText, "escapeHtmlText");
function applyProfileToHtml(html, title, description) {
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlText(title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeHtmlAttribute(description)}">`
  );
  return out;
}
__name(applyProfileToHtml, "applyProfileToHtml");
async function personalizeHtmlResponse(aemRes, profile, pathname) {
  const cacheKey = `${pathname}::${profile.segment}::${profile.name || ""}`;
  let html = profileCache.get(cacheKey);
  if (!html) {
    const rawHtml = await aemRes.text();
    try {
      const copy = await getProfileCopy(profile.segment, profile.name);
      html = applyProfileToHtml(rawHtml, copy.title, copy.description);
      profileCache.set(cacheKey, html);
      console.log(`[localize-worker] Personalized ${pathname} for segment=${profile.segment}`);
    } catch (err) {
      console.error("[localize-worker] Profile personalization failed, serving original:", err.message);
      html = rawHtml;
    }
  }
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  appendProfileCookies(headers, profile);
  return new Response(html, { status: aemRes.status, headers });
}
__name(personalizeHtmlResponse, "personalizeHtmlResponse");
var formJsonCache = /* @__PURE__ */ new Map();
async function personalizeFormJson(aemRes, profile, pathname) {
  const cacheKey = `${pathname}::${profile.segment}::${profile.name || ""}`;
  let json = formJsonCache.get(cacheKey);
  if (!json) {
    const body = await aemRes.json();
    if (body?.[":type"] !== "sheet" || !Array.isArray(body.data)) {
      json = JSON.stringify(body);
    } else {
      try {
        const copy = await getProfileCopy(profile.segment, profile.name);
        applyFieldPersonalization(body, copy, pathname);
        json = JSON.stringify(body);
        formJsonCache.set(cacheKey, json);
        console.log(`[localize-worker] Personalized fields for ${pathname}, segment=${profile.segment}`);
      } catch (err) {
        console.error("[localize-worker] Field personalization failed, serving original:", err.message);
        json = JSON.stringify(body);
      }
    }
  }
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  appendProfileCookies(headers, profile);
  return new Response(json, { status: aemRes.status, headers });
}
__name(personalizeFormJson, "personalizeFormJson");
async function handleTeamHighlight(url) {
  const team = url.searchParams.get("team");
  const lang = url.searchParams.get("lang");
  const teamInfo = NFL_TEAMS[team];
  if (!teamInfo) {
    return new Response(JSON.stringify({ error: "Unknown team" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const cacheKey = `${team}::${lang || "en"}`;
  const cached = highlightCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HIGHLIGHT_CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.body), { headers: { "Content-Type": "application/json" } });
  }
  const event = await fetchNextEvent(teamInfo.abbr);
  let message;
  try {
    const language = lang && SUPPORTED_LANGS[lang];
    message = await askOllama(buildHighlightPrompt(teamInfo.fullName, event, language));
  } catch (err) {
    console.error("[localize-worker] team-highlight AI summary failed:", err.message);
    message = event ? `Go ${teamInfo.fullName}! Next up: ${event.name} on ${new Date(event.date).toDateString()}.` : `Go ${teamInfo.fullName}!`;
  }
  const body = {
    team: teamInfo.fullName,
    logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${teamInfo.abbr}.png`,
    event,
    message
  };
  highlightCache.set(cacheKey, { at: Date.now(), body });
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
__name(handleTeamHighlight, "handleTeamHighlight");
function collectTranslatable(rows) {
  const strings = {};
  rows.forEach((row, i) => {
    ALWAYS_TRANSLATE_COLUMNS.forEach((col) => {
      if (row[col]) strings[`${i}::${col}`] = String(row[col]);
    });
    if (row.OptionNames) {
      const names = String(row.OptionNames).split(",").map((n) => n.trim());
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
__name(collectTranslatable, "collectTranslatable");
function applyTranslations(rows, translated) {
  rows.forEach((row, i) => {
    ALWAYS_TRANSLATE_COLUMNS.forEach((col) => {
      const key = `${i}::${col}`;
      if (translated[key]) row[col] = translated[key];
    });
    if (row.OptionNames) {
      const originalNames = String(row.OptionNames).split(",").map((n) => n.trim());
      row.OptionNames = originalNames.map((name, j) => translated[`${i}::OptionNames::${j}`] || name).join(",");
    }
    const valueKey = `${i}::Value`;
    if (row.Value && VALUE_IS_DISPLAY_TEXT_FOR_TYPES.has(row.Type) && translated[valueKey]) {
      row.Value = translated[valueKey];
    }
  });
}
__name(applyTranslations, "applyTranslations");
function buildPrompt(strings, language) {
  const entries = Object.entries(strings).map(([key, text]) => `  ${JSON.stringify(key)}: ${JSON.stringify(text)}`).join(",\n");
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
__name(buildPrompt, "buildPrompt");
async function translateSheetForm(body, lang) {
  const strings = collectTranslatable(body.data);
  if (Object.keys(strings).length === 0) return body;
  const language = SUPPORTED_LANGS[lang];
  const raw = await askOllama(buildPrompt(strings, language));
  const translated = parseJsonResponse(raw);
  if (!translated) throw new Error(`Non-JSON translation response: ${raw.slice(0, 200)}`);
  applyTranslations(body.data, translated);
  return body;
}
__name(translateSheetForm, "translateSheetForm");
var WORKER_ONLY_PARAMS = /* @__PURE__ */ new Set(["lang", "segment", "name"]);
function buildAemUrl(url) {
  const aemUrl = new URL(AEM_ORIGIN);
  aemUrl.pathname = url.pathname;
  url.searchParams.forEach((value, key) => {
    if (!WORKER_ONLY_PARAMS.has(key)) aemUrl.searchParams.set(key, value);
  });
  return aemUrl.toString();
}
__name(buildAemUrl, "buildAemUrl");
var worker_default = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/team-highlight") {
      return handleTeamHighlight(url);
    }
    const lang = url.searchParams.get("lang");
    const headers = new Headers(request.headers);
    headers.set("Accept-Encoding", "identity");
    const aemRes = await fetch(buildAemUrl(url), { method: request.method, headers });
    const contentType = aemRes.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const isHtml = contentType.includes("text/html");
    if (isHtml && request.method === "GET" && aemRes.ok) {
      const profile = resolveCustomerProfile(request, url);
      if (profile) {
        return personalizeHtmlResponse(aemRes, profile, url.pathname);
      }
    }
    if (isJson && request.method === "GET" && aemRes.ok && !(lang && SUPPORTED_LANGS[lang])) {
      const profile = resolveCustomerProfile(request, url);
      if (profile) {
        return personalizeFormJson(aemRes, profile, url.pathname);
      }
    }
    if (!isJson || !lang || !SUPPORTED_LANGS[lang]) {
      return aemRes;
    }
    const cacheKey = `${url.pathname}::${lang}`;
    if (translationCache.has(cacheKey)) {
      return new Response(translationCache.get(cacheKey), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    const body = await aemRes.json();
    if (body?.[":type"] !== "sheet" || !Array.isArray(body.data)) {
      return new Response(JSON.stringify(body), {
        status: aemRes.status,
        headers: { "Content-Type": "application/json" }
      });
    }
    try {
      const translatedBody = await translateSheetForm(body, lang);
      const json = JSON.stringify(translatedBody);
      translationCache.set(cacheKey, json);
      console.log(`[localize-worker] Translated ${url.pathname} -> ${lang}`);
      return new Response(json, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    } catch (err) {
      console.error("[localize-worker] Translation failed, serving original:", err.message);
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
  }
};

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ilpwTo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ilpwTo/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
