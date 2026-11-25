// Draws every image in assets/ (light + dark) and writes README.md.
// No dependencies. Run: node scripts/build.mjs
// With PROFILE_TOKEN (or GITHUB_TOKEN) set, stats come from the GraphQL API;
// without one, the public contributions page and REST API are used.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "profile.config.json"), "utf8"));
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(ROOT, "data"), { recursive: true });

// ---------------------------------------------------------------- theme
const THEMES = {
  dark: {
    panel: "#0f1420", panel2: "#161d2d",
    line: "rgba(148,163,184,0.14)", line2: "rgba(148,163,184,0.26)",
    fg: "#e6e9f2", muted: "#94a0b8", dim: "#64708a",
    acc: "#ff8a5c", accText: "#ff8a5c", accInk: "#1a0d06",
    acc2: "#ffc857", acc3: "#5ad1c4",
    levels: ["#1a2233", "#4a2b2a", "#8a4131", "#d4663f", "#ff8a5c"],
  },
  light: {
    panel: "#fffdf9", panel2: "#f6f1ea",
    line: "rgba(30,30,50,0.10)", line2: "rgba(30,30,50,0.20)",
    fg: "#1c1d2b", muted: "#555a6e", dim: "#8b8fa0",
    acc: "#e8622f", accText: "#c2410c", accInk: "#ffffff",
    acc2: "#b7791f", acc3: "#0f8a7e",
    levels: ["#efe9e1", "#fbd3c0", "#f5a07c", "#e8703f", "#c2410c"],
  },
};
const SANS = `'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
const MONO = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => Number(n).toLocaleString("en-US");
// Rough text width so chips and pills size to their labels.
const monoW = (s, size) => s.length * size * 0.62;
const R = 16; // corner radius for cards

function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
  .sans{font-family:${SANS}} .mono{font-family:${MONO}}
  @keyframes pulse{0%{r:4;opacity:.8}70%{r:11;opacity:0}100%{r:11;opacity:0}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadein{from{opacity:0}to{opacity:1}}
  .pulse{animation:pulse 2s ease-out infinite}
  .spin{animation:spin 40s linear infinite;transform-box:fill-box;transform-origin:center}
  .spin-r{animation:spin 60s linear infinite reverse;transform-box:fill-box;transform-origin:center}
  .fadein{animation:fadein .6s ease-out both}
  @media (prefers-reduced-motion:reduce){.pulse,.spin,.spin-r,.fadein{animation:none}}
</style>
${body}
</svg>`;
}

const card = (w, h, t) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${R}" fill="${t.panel}" stroke="${t.line}"/>`;

function cardTitle(text, t, right) {
  return `<rect x="48" y="38" width="10" height="10" rx="2" fill="${t.acc}"/>
<text x="68" y="48" class="sans" font-size="18" font-weight="700" fill="${t.fg}">${esc(text)}</text>
${right ? `<text x="1152" y="48" text-anchor="end" class="mono" font-size="12" fill="${t.dim}">${esc(right)}</text>` : ""}`;
}

function chip(x, y, text, t, dot) {
  const size = 13;
  const w = Math.round(monoW(text, size) + (dot ? 38 : 26));
  const h = 30;
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${t.panel2}" stroke="${t.line}"/>
${dot ? `<circle cx="${x + 15}" cy="${y + h / 2}" r="3.5" fill="${dot}"/>` : ""}
<text x="${x + (dot ? 26 : 13)}" y="${y + 19.5}" class="mono" font-size="${size}" fill="${t.fg}">${esc(text)}</text>`,
  };
}

// ---------------------------------------------------------------- data
async function gql(token, login) {
  const q = `query($login:String!){user(login:$login){
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100){totalCount}
    contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-readme-builder" },
    body: JSON.stringify({ query: q, variables: { login } }),
  });
  const j = await r.json();
  if (!j.data?.user) throw new Error("GraphQL: " + JSON.stringify(j.errors || j));
  const u = j.data.user;
  return {
    days: u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount })),
    repos: u.repositories.totalCount,
  };
}

async function publicData(login) {
  const ua = { "User-Agent": "profile-readme-builder" };
  const html = await (await fetch(`https://github.com/users/${login}/contributions`, { headers: ua })).text();
  const ids = {};
  for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*?id="([^"]+)"/g)) ids[m[2]] = m[1];
  const days = [];
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const date = ids[m[1]];
    if (!date) continue;
    const n = m[2].match(/^(\d[\d,]*) contribution/);
    days.push({ date, count: n ? Number(n[1].replace(/,/g, "")) : 0 });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) throw new Error("could not read the contributions page");
  let repos = 0;
  const rr = await fetch(`https://api.github.com/users/${login}/repos?per_page=100&type=owner`, { headers: ua });
  if (rr.ok) repos = (await rr.json()).filter((r) => !r.fork).length;
  return { days, repos };
}

function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  let longest = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  // Today with no commits yet doesn't break the current streak.
  let i = days.length - 1, current = 0;
  if (i >= 0 && days[i].date >= today && days[i].count === 0) i--;
  while (i >= 0 && days[i].count > 0) { current++; i--; }
  return { current, longest };
}

async function loadStats() {
  const cache = join(ROOT, "data", "stats.json");
  const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const s = token ? await gql(token, cfg.login) : await publicData(cfg.login);
    writeFileSync(cache, JSON.stringify({ ...s, fetched: new Date().toISOString() }));
    console.log(`stats: ${token ? "graphql" : "public page"}, ${s.days.length} days`);
    return s;
  } catch (e) {
    console.warn("stats fetch failed:", e.message);
    if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
    return { days: [], repos: 0 };
  }
}

// ---------------------------------------------------------------- hero
function hero(t) {
  const W = 1200, H = 340;
  const statusW = Math.round(monoW(cfg.status, 12.5) + 46);
  // Decorative orbit on the right: two rings, three planets, a code bracket.
  const cx = 1000, cy = 150;
  const orbit = `
<g opacity="0.95">
  <circle cx="${cx}" cy="${cy}" r="118" fill="none" stroke="${t.line2}" stroke-dasharray="2 7"/>
  <circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="${t.line2}"/>
  <g class="spin"><circle cx="${cx}" cy="${cy}" r="118" fill="none" stroke="none"/><circle cx="${cx + 118}" cy="${cy}" r="7" fill="${t.acc}"/><circle cx="${cx - 83}" cy="${cy + 83}" r="5" fill="${t.acc2}"/></g>
  <g class="spin-r"><circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="none"/><circle cx="${cx}" cy="${cy - 76}" r="5" fill="${t.acc3}"/></g>
  <rect x="${cx - 38}" y="${cy - 38}" width="76" height="76" rx="20" fill="${t.panel2}" stroke="${t.line2}"/>
  <text x="${cx}" y="${cy + 10}" text-anchor="middle" class="mono" font-size="28" font-weight="700" fill="${t.accText}">&lt;/&gt;</text>
</g>`;
  const body = `<defs><clipPath id="c"><rect width="${W}" height="${H}" rx="${R}"/></clipPath></defs>
${card(W, H, t)}
<g clip-path="url(#c)">
  <rect x="0" y="0" width="6" height="${H}" fill="${t.acc}"/>
  ${orbit}
</g>
<g class="fadein">
  <text x="56" y="74" class="mono" font-size="14" fill="${t.accText}">// hi, I'm</text>
  <text x="54" y="128" class="sans" font-size="50" font-weight="800" letter-spacing="-1.5" fill="${t.fg}">${esc(cfg.name)}</text>
  <text x="56" y="172" class="sans" font-size="22" font-weight="600" fill="${t.fg}">${esc(cfg.role)} <tspan fill="${t.muted}" font-weight="400">at</tspan> <tspan fill="${t.accText}">${esc(cfg.company)}</tspan></text>
  <text x="56" y="208" class="sans" font-size="18" fill="${t.muted}">${esc(cfg.intro)}</text>

  <rect x="56" y="236" width="${statusW}" height="30" rx="8" fill="${t.panel2}" stroke="${t.line2}"/>
  <circle cx="74" cy="251" r="4" fill="${t.acc3}" class="pulse"/>
  <circle cx="74" cy="251" r="4" fill="${t.acc3}"/>
  <text x="88" y="255.5" class="mono" font-size="12.5" fill="${t.fg}">${esc(cfg.status)}</text>
</g>
<line x1="56" y1="290" x2="${W - 56}" y2="290" stroke="${t.line}"/>
<g class="mono" font-size="12.5" fill="${t.dim}">
  <text x="56" y="318">${esc(cfg.location)}</text>
  <text x="${W / 2}" y="318" text-anchor="middle">${esc(cfg.experience)}</text>
  <text x="${W - 56}" y="318" text-anchor="end">github.com/${esc(cfg.login)}</text>
</g>`;
  return svg(W, H, body, `${cfg.name}, ${cfg.role} at ${cfg.company}. ${cfg.intro}`);
}

// ---------------------------------------------------------------- link buttons
function button(link, t) {
  const text = link.label;
  const W = Math.round(monoW(text, 14) + 66), H = 42;
  const icons = {
    site: `<circle r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-7 0H7M0-7c3 3 3 11 0 14M0-7c-3 3-3 11 0 14" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    li: `<rect x="-7" y="-7" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-3.5 -1V4M-3.5 -3.6v.1M0 4V-1M0 1.2c0-1.6 3.6-2.6 3.6 0V4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    mail: `<rect x="-7.5" y="-5.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-7 -4.5L0 1L7 -4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  };
  const primary = link.id === "site";
  const ink = primary ? t.accInk : t.fg;
  const body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${primary ? t.acc : t.panel}" stroke="${primary ? "none" : t.line2}"/>
<g transform="translate(24 21)" style="color:${ink}">${icons[link.id] || icons.site}</g>
<text x="42" y="26" class="mono" font-size="14" font-weight="600" fill="${ink}">${esc(text)}</text>`;
  return svg(W, H, body, text);
}

// ---------------------------------------------------------------- skills
function skills(t) {
  const W = 1200, rowH = 48, H = 96 + cfg.skills.length * rowH;
  const dots = [t.acc, t.acc2, t.acc3, t.acc, t.acc2];
  const rows = cfg.skills.map(([k, items], i) => {
    const y = 80 + i * rowH;
    let x = 200, out = "";
    for (const it of items) { const c = chip(x, y, it, t, dots[i % dots.length]); out += c.svg; x += c.w + 8; }
    return `<text x="48" y="${y + 20}" class="sans" font-size="14" font-weight="600" fill="${t.muted}">${esc(k)}</text>\n${out}`;
  }).join("\n");
  const body = `${card(W, H, t)}
${cardTitle("Skills", t)}
${rows}`;
  return svg(W, H, body, "Skills: " + cfg.skills.map(([k, v]) => `${k}: ${v.join(", ")}`).join("; "));
}

// ---------------------------------------------------------------- stats + graph
function stats(t, s) {
  const W = 1200, H = 420;
  const year = s.days.slice(-365);
  const total = year.reduce((a, d) => a + d.count, 0);
  const { current, longest } = streaks(s.days);
  const tiles = [
    [fmt(total), total === 1 ? "contribution, last year" : "contributions, last year"],
    [`${current} ${current === 1 ? "day" : "days"}`, "current streak"],
    [`${longest} ${longest === 1 ? "day" : "days"}`, "longest streak"],
    [fmt(s.repos), s.repos === 1 ? "public repo" : "public repos"],
  ];
  const tw = (W - 96) / 4;
  const tileSvg = tiles.map(([v, k], i) => {
    const x = 48 + i * tw;
    return `<rect x="${x + (i ? 6 : 0)}" y="72" width="${tw - 12}" height="86" rx="12" fill="${t.panel2}" stroke="${t.line}"/>
<text x="${x + (i ? 6 : 0) + 20}" y="116" class="sans" font-size="32" font-weight="800" letter-spacing="-1" fill="${i ? t.fg : t.accText}">${esc(v)}</text>
<text x="${x + (i ? 6 : 0) + 20}" y="142" class="sans" font-size="13" fill="${t.muted}">${esc(k)}</text>`;
  }).join("\n");

  // Graph: last 53 weeks, Sunday-first columns.
  const cell = 16.4, gap = 4, gx = 48, gy = 212;
  let cells = "", months = "";
  if (year.length) {
    const pad = new Date(year[0].date + "T00:00:00Z").getUTCDay();
    const max = Math.max(1, ...year.map((d) => d.count));
    const lvl = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
    let lastMonth = -1, lastCol = -9;
    year.forEach((d, i) => {
      const k = i + pad, col = Math.floor(k / 7), row = k % 7;
      const x = gx + col * (cell + gap), y = gy + row * (cell + gap);
      cells += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="4" fill="${t.levels[lvl(d.count)]}"><title>${d.count} on ${d.date}</title></rect>`;
      const m = new Date(d.date + "T00:00:00Z").getUTCMonth();
      if (row === 0 && m !== lastMonth && col < 51) {
        lastMonth = m;
        if (col - lastCol < 3) return;
        lastCol = col;
        months += `<text x="${x.toFixed(1)}" y="${gy - 10}" class="mono" font-size="11" fill="${t.dim}">${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]}</text>`;
      }
    });
  } else {
    cells = `<text x="${W / 2}" y="${gy + 70}" text-anchor="middle" class="mono" font-size="13" fill="${t.dim}">contribution data unavailable</text>`;
  }
  const ly = gy + 7 * (cell + gap) + 14;
  const legX = W - 48 - 5 * (cell + gap) - 40;
  const legend = `<text x="${legX - 10}" y="${ly + 12}" text-anchor="end" class="mono" font-size="11" fill="${t.dim}">less</text>
${t.levels.map((c, i) => `<rect x="${(legX + i * (cell + gap)).toFixed(1)}" y="${ly}" width="${cell}" height="${cell}" rx="4" fill="${c}"/>`).join("")}
<text x="${(legX + 5 * (cell + gap) + 6).toFixed(1)}" y="${ly + 12}" class="mono" font-size="11" fill="${t.dim}">more</text>`;
  const body = `${card(W, H, t)}
${cardTitle("GitHub activity", t, "updated " + new Date().toISOString().slice(0, 10))}
${tileSvg}
${months}
${cells}
${legend}`;
  return svg(W, H, body, `${fmt(total)} contributions in the last year, current streak ${current} days, longest ${longest} days.`);
}

// ---------------------------------------------------------------- write
const s = await loadStats();
const yearTotal = s.days.slice(-365).reduce((a, d) => a + d.count, 0);
const showStats = yearTotal >= (cfg.statsMinContributions ?? 0);
console.log(`stats card: ${showStats ? "shown" : "hidden"} (${yearTotal} contributions, threshold ${cfg.statsMinContributions ?? 0})`);

// Clear old drawings so removed sections don't linger in the repo.
for (const f of readdirSync(OUT)) if (f.endsWith(".svg")) unlinkSync(join(OUT, f));
let count = 0;
for (const [mode, t] of Object.entries(THEMES)) {
  const w = (name, content) => { writeFileSync(join(OUT, `${name}-${mode}.svg`), content); count++; };
  w("hero", hero(t));
  for (const l of cfg.links) w(`btn-${l.id}`, button(l, t));
  w("skills", skills(t));
  w("stats", stats(t, s));
}

// ---------------------------------------------------------------- README
const pic = (name, alt, width, href) => {
  const img = `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg"><img src="assets/${name}-light.svg" alt="${esc(alt)}"${width ? ` width="${width}"` : ""}></picture>`;
  return href ? `<a href="${href}">${img}</a>` : img;
};

const readme = `<!-- Generated by scripts/build.mjs from profile.config.json. Edit those, not this file. -->

${pic("hero", `${cfg.name}, ${cfg.role} at ${cfg.company}. ${cfg.intro}`, "100%")}

<p align="center">
${cfg.links.map((l) => pic(`btn-${l.id}`, l.label, undefined, l.url)).join("&nbsp;")}
</p>

${pic("skills", "Skills: " + cfg.skills.map(([k, v]) => `${k}: ${v.join(", ")}`).join("; "), "100%")}
${showStats ? `\n${pic("stats", "My GitHub contributions over the last year", "100%")}\n` : ""}`;
writeFileSync(join(ROOT, "README.md"), readme);
console.log(`wrote ${count} svgs + README.md`);
