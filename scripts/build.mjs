// Draws every image in assets/ (light + dark) and writes README.md.
// No dependencies. Run: node scripts/build.mjs
// With GITHUB_TOKEN (or PROFILE_TOKEN) set, stats come from the GraphQL API;
// without one, the public contributions page and REST API are used.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "profile.config.json"), "utf8"));
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- theme
const THEMES = {
  dark: {
    bg: "#07070a", panel: "#0e0e13", panel2: "#15151c",
    line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.16)",
    fg: "#eeecf3", muted: "#9391a0", dim: "#5f5d6b",
    acc: "#c6ff3d", accText: "#c6ff3d", accInk: "#0b0f00",
    acc2: "#7c5cff", acc3: "#3de0ff",
    levels: ["#17171f", "#3d5212", "#6f9a1c", "#a3d42e", "#c6ff3d"],
  },
  light: {
    bg: "#f7f7f3", panel: "#ffffff", panel2: "#f0f0ea",
    line: "rgba(10,10,20,0.09)", line2: "rgba(10,10,20,0.18)",
    fg: "#111015", muted: "#55535f", dim: "#8a8895",
    acc: "#c6ff3d", accText: "#3f6400", accInk: "#0b0f00",
    acc2: "#5b3fd9", acc3: "#0a7f9c",
    levels: ["#ebebe4", "#dff5a6", "#b4e33a", "#7fb012", "#3f6400"],
  },
};
const SANS = `Geist, 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
const MONO = `'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const SERIF = `'Instrument Serif', Georgia, 'Times New Roman', serif`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => Number(n).toLocaleString("en-US");
// Rough text width so chips and pills size to their labels.
const monoW = (s, size) => s.length * size * 0.62;

function svg(w, h, t, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
  .sans{font-family:${SANS}} .mono{font-family:${MONO}} .serif{font-family:${SERIF};font-style:italic}
  @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
  @keyframes pulse{0%{r:4;opacity:.9}70%{r:11;opacity:0}100%{r:11;opacity:0}}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(-40px,18px)}}
  .blink{animation:blink 1.1s steps(1) infinite}
  .pulse{animation:pulse 2s ease-out infinite}
  .rise{animation:rise .7s cubic-bezier(.22,1,.36,1) both}
  .drift{animation:drift 14s ease-in-out infinite}
  @media (prefers-reduced-motion:reduce){.blink,.pulse,.rise,.drift{animation:none}}
</style>
${body}
</svg>`;
}

const frame = (w, h, t, r = 22) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${r}" fill="${t.panel}" stroke="${t.line}"/>`;

const label = (x, y, text, t, color) =>
  `<text x="${x}" y="${y}" class="mono" font-size="12" letter-spacing="1.4" fill="${color || t.muted}">${esc(text.toUpperCase())}</text>`;

function chip(x, y, text, t, { size = 13, fill, stroke, color } = {}) {
  const w = Math.round(monoW(text, size) + 24);
  const h = size + 15;
  return {
    w,
    svg: `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill || t.panel2}" stroke="${stroke || t.line}"/>
<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" text-anchor="middle" class="mono" font-size="${size}" fill="${color || t.fg}">${esc(text)}</text></g>`,
  };
}

function chipRow(x, y, items, t, opts) {
  let cx = x, out = "";
  for (const it of items) { const c = chip(cx, y, it, t, opts); out += c.svg; cx += c.w + 8; }
  return out;
}

// ---------------------------------------------------------------- data
async function gql(token, login) {
  const q = `query($login:String!){user(login:$login){
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100){totalCount nodes{stargazerCount}}
    contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
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
    stars: u.repositories.nodes.reduce((a, n) => a + n.stargazerCount, 0),
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
  let repos = 0, stars = 0;
  const rr = await fetch(`https://api.github.com/users/${login}/repos?per_page=100&type=owner`, { headers: ua });
  if (rr.ok) {
    const list = (await rr.json()).filter((r) => !r.fork);
    repos = list.length;
    stars = list.reduce((a, r) => a + r.stargazers_count, 0);
  }
  if (!days.length) throw new Error("could not read the contributions page");
  return { days, repos, stars };
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
    return { days: [], repos: 0, stars: 0 };
  }
}

// ---------------------------------------------------------------- hero
function hero(t, mode) {
  const W = 1200, H = 400;
  const [l1, l2, l3] = cfg.headline;
  const statusW = Math.round(monoW(cfg.status, 13) + 52);
  const glowA = mode === "dark" ? 0.22 : 0.35;
  const body = `
<defs>
  <radialGradient id="g1" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${t.acc2}" stop-opacity="${glowA}"/><stop offset="1" stop-color="${t.acc2}" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${t.acc}" stop-opacity="${glowA * 0.8}"/><stop offset="1" stop-color="${t.acc}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${t.line}" stroke-width="1"/></pattern>
  <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="gm"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
  <clipPath id="clip"><rect width="${W}" height="${H}" rx="22"/></clipPath>
</defs>
<g clip-path="url(#clip)">
  ${frame(W, H, t)}
  <rect width="${W}" height="${H}" fill="url(#grid)" mask="url(#gm)"/>
  <g class="drift"><circle cx="1010" cy="70" r="300" fill="url(#g1)"/></g>
  <circle cx="1120" cy="380" r="220" fill="url(#g2)"/>
</g>

<g class="rise">
  <rect x="56" y="48" width="${statusW}" height="30" rx="15" fill="${t.panel2}" stroke="${t.line2}"/>
  <circle cx="76" cy="63" r="4" fill="${t.acc}" class="pulse" opacity="0.8"/>
  <circle cx="76" cy="63" r="4" fill="${mode === "dark" ? t.acc : t.accText}"/>
  <text x="90" y="67.5" class="mono" font-size="13" fill="${t.fg}">${esc(cfg.status)}</text>
</g>

<g class="rise" style="animation-delay:.08s">
  <text x="54" y="152" class="sans" font-size="58" font-weight="600" letter-spacing="-2" fill="${t.fg}">${esc(l1)}</text>
  <text x="54" y="216" class="sans" font-size="58" font-weight="600" letter-spacing="-2" fill="${t.fg}">${esc(l2)} <tspan class="serif" font-weight="400" letter-spacing="-1" fill="${t.accText}">${esc(l3)}</tspan><tspan class="blink" font-weight="300" fill="${t.accText}" dx="6">|</tspan></text>
</g>

<g class="rise" style="animation-delay:.16s">
  <text x="56" y="272" class="sans" font-size="20" fill="${t.muted}">I'm <tspan fill="${t.fg}" font-weight="600">${esc(cfg.name)}</tspan>, ${esc(cfg.role.toLowerCase())} at ${esc(cfg.company)}.</text>
  <text x="56" y="302" class="sans" font-size="20" fill="${t.muted}">Web and mobile products for founders, from first release to production.</text>
</g>

<line x1="56" y1="336" x2="${W - 56}" y2="336" stroke="${t.line}"/>
<g class="mono" font-size="12" letter-spacing="1.4" fill="${t.dim}">
  <text x="56" y="365">${esc(cfg.location.toUpperCase())}</text>
  <text x="${W / 2}" y="365" text-anchor="middle">${esc(cfg.yearsBuilding)} YEARS · ${esc(cfg.productsShipped)} PRODUCTS SHIPPED</text>
  <text x="${W - 56}" y="365" text-anchor="end">GITHUB.COM/${esc(cfg.login.toUpperCase())}</text>
</g>`;
  return svg(W, H, t, body, `${cfg.name}: ${cfg.headline.join(" ")}`);
}

// ---------------------------------------------------------------- link buttons
function button(link, t, mode) {
  const text = link.label;
  const W = Math.round(monoW(text.toUpperCase(), 13) + 70), H = 44;
  const icons = {
    site: `<circle cx="0" cy="0" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-7 0H7M0-7c3 3 3 11 0 14M0-7c-3 3-3 11 0 14" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    li: `<rect x="-7" y="-7" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-3.5 -1V4M-3.5 -3.6v.1M0 4V-1M0 1.2c0-1.6 3.6-2.6 3.6 0V4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    mail: `<rect x="-7.5" y="-5.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M-7 -4.5L0 1L7 -4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  };
  const primary = link.id === "site";
  const fill = primary ? t.acc : t.panel;
  const ink = primary ? t.accInk : t.fg;
  const body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${H / 2}" fill="${fill}" stroke="${primary ? "none" : t.line2}"/>
<g transform="translate(26 22)" style="color:${ink}">${icons[link.id] || icons.site}</g>
<text x="44" y="26.5" class="mono" font-size="13" letter-spacing="1.2" fill="${ink}">${esc(text.toUpperCase())}</text>`;
  return svg(W, H, t, body, text);
}

// ---------------------------------------------------------------- now (terminal)
function now(t) {
  const W = 1200, rowH = 34, H = 140 + cfg.now.length * rowH;
  const keyW = 130;
  const rows = cfg.now.map(([k, v], i) => {
    const y = 112 + i * rowH;
    return `<g class="rise" style="animation-delay:${0.1 + i * 0.08}s">
  <text x="56" y="${y}" class="mono" font-size="15" fill="${k === "building" ? t.accText : k === "exploring" ? t.acc2 : t.acc3}">${esc(k)}</text>
  <text x="${56 + keyW}" y="${y}" class="mono" font-size="15" fill="${t.fg}">${esc(v)}</text></g>`;
  }).join("\n");
  const body = `${frame(W, H, t)}
<circle cx="36" cy="32" r="6" fill="${t.line2}"/><circle cx="56" cy="32" r="6" fill="${t.line2}"/><circle cx="76" cy="32" r="6" fill="${t.line2}"/>
<text x="${W / 2}" y="37" text-anchor="middle" class="mono" font-size="12" fill="${t.dim}">~/${esc(cfg.login)} · zsh</text>
<line x1="0" y1="56" x2="${W}" y2="56" stroke="${t.line}"/>
<text x="56" y="80" class="mono" font-size="15" fill="${t.muted}"><tspan fill="${t.accText}">❯</tspan> cat now.md</text>
${rows}
<rect x="76" y="${H - 34}" width="9" height="18" fill="${t.accText}" class="blink"/>
<text x="56" y="${H - 20}" class="mono" font-size="15" fill="${t.accText}">❯</text>`;
  return svg(W, H, t, body, "What I'm doing now: " + cfg.now.map((r) => r.join(": ")).join("; "));
}

// ---------------------------------------------------------------- stack
function stack(t) {
  const W = 1200, rowH = 52, H = 92 + cfg.stack.length * rowH;
  const rows = cfg.stack.map(([k, items], i) => {
    const y = 84 + i * rowH;
    return `<line x1="56" y1="${y - 14}" x2="${W - 56}" y2="${y - 14}" stroke="${t.line}"/>
${label(56, y + 18, k, t)}
${chipRow(210, y, items, t, { size: 13 })}`;
  }).join("\n");
  const body = `${frame(W, H, t)}
<text x="56" y="52" class="sans" font-size="22" font-weight="600" fill="${t.fg}">Tools I reach for</text>
<text x="${W - 56}" y="52" text-anchor="end" class="mono" font-size="12" letter-spacing="1.4" fill="${t.dim}">IN PRODUCTION, NOT JUST TUTORIALS</text>
${rows}`;
  return svg(W, H, t, body, "Tech stack: " + cfg.stack.map(([k, v]) => `${k}: ${v.join(", ")}`).join("; "));
}

// ---------------------------------------------------------------- stats + graph
function stats(t, s) {
  const W = 1200, H = 430;
  const year = s.days.slice(-365);
  const total = year.reduce((a, d) => a + d.count, 0);
  const { current, longest } = streaks(s.days);
  const tiles = [
    [fmt(total), total === 1 ? "contribution · last year" : "contributions · last year", t.accText],
    [`${current}d`, `current streak · best ${longest}d`, t.fg],
    [cfg.productsShipped, "products shipped", t.fg],
    [cfg.yearsBuilding, "years building", t.fg],
  ];
  const tw = (W - 112) / 4;
  const tileSvg = tiles.map(([v, k, c], i) => {
    const x = 56 + i * tw;
    return `${i ? `<line x1="${x}" y1="84" x2="${x}" y2="150" stroke="${t.line}"/>` : ""}
<text x="${x + (i ? 24 : 0)}" y="128" class="sans" font-size="44" font-weight="600" letter-spacing="-1.5" fill="${c}">${esc(v)}</text>
<text x="${x + (i ? 24 : 0)}" y="152" class="mono" font-size="12" letter-spacing="1" fill="${t.muted}">${esc(k.toUpperCase())}</text>`;
  }).join("\n");

  // Graph: last 53 weeks, Sunday-first columns.
  const cell = 16.5, gap = 4, gx = 56, gy = 210;
  let cells = "", months = "";
  if (year.length) {
    const first = new Date(year[0].date + "T00:00:00Z");
    const pad = first.getUTCDay();
    const max = Math.max(1, ...year.map((d) => d.count));
    const lvl = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
    let lastMonth = -1, lastCol = -9;
    year.forEach((d, i) => {
      const k = i + pad, col = Math.floor(k / 7), row = k % 7;
      const x = gx + col * (cell + gap), y = gy + row * (cell + gap);
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" fill="${t.levels[lvl(d.count)]}"><title>${d.count} on ${d.date}</title></rect>`;
      const m = new Date(d.date + "T00:00:00Z").getUTCMonth();
      if (row === 0 && m !== lastMonth && col < 51) {
        lastMonth = m;
        if (col - lastCol < 3) return;
        lastCol = col;
        months += `<text x="${x}" y="${gy - 12}" class="mono" font-size="11" fill="${t.dim}">${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][m]}</text>`;
      }
    });
  } else {
    cells = `<text x="${W / 2}" y="${gy + 70}" text-anchor="middle" class="mono" font-size="13" fill="${t.dim}">contribution data unavailable</text>`;
  }
  const legX = W - 56 - 5 * (cell + gap) - 70;
  const legend = `<text x="${legX - 10}" y="${gy + 7 * (cell + gap) + 26}" text-anchor="end" class="mono" font-size="11" fill="${t.dim}">LESS</text>
${t.levels.map((c, i) => `<rect x="${legX + i * (cell + gap)}" y="${gy + 7 * (cell + gap) + 14}" width="${cell}" height="${cell}" rx="3.5" fill="${c}"/>`).join("")}
<text x="${legX + 5 * (cell + gap) + 6}" y="${gy + 7 * (cell + gap) + 26}" class="mono" font-size="11" fill="${t.dim}">MORE</text>`;
  const stamp = new Date().toISOString().slice(0, 10);
  const body = `${frame(W, H, t)}
<text x="56" y="52" class="sans" font-size="22" font-weight="600" fill="${t.fg}">On GitHub</text>
<text x="${W - 56}" y="52" text-anchor="end" class="mono" font-size="12" letter-spacing="1.4" fill="${t.dim}">REDRAWN NIGHTLY · ${stamp}</text>
${tileSvg}
${months}
${cells}
${legend}`;
  return svg(W, H, t, body, `${fmt(total)} contributions in the last year, current streak ${current} days, longest ${longest} days.`);
}

// ---------------------------------------------------------------- project cards
const VISUALS = {
  auction(t, x, y) {
    return `<g transform="translate(${x} ${y})">
<rect width="200" height="150" rx="16" fill="${t.panel2}" stroke="${t.line}"/>
<circle cx="22" cy="24" r="4" fill="#ff4d5e"/><circle cx="22" cy="24" r="4" fill="#ff4d5e" class="pulse"/>
<text x="34" y="28" class="mono" font-size="10.5" letter-spacing="1" fill="${t.fg}">LIVE · LOT #2481</text>
<text x="18" y="60" class="mono" font-size="10" letter-spacing="1" fill="${t.dim}">CURRENT BID</text>
<g class="sans" font-size="30" font-weight="600" letter-spacing="-1" fill="${t.fg}">
  <text x="18" y="94">$24,850<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;.45;.5;.95;1" dur="4s" repeatCount="indefinite"/></text>
  <text x="18" y="94" fill="${t.accText}" opacity="0">$25,100<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.45;.5;.95;1" dur="4s" repeatCount="indefinite"/></text>
</g>
<rect x="18" y="112" width="164" height="22" rx="11" fill="${t.acc}"/>
<text x="100" y="127" text-anchor="middle" class="mono" font-size="10.5" font-weight="600" fill="${t.accInk}">PLACE BID · 00:42</text>
</g>`;
  },
  phone(t, x, y) {
    const rows = ["Clients", "Measurements", "Orders", "Invoices"].map((r, i) =>
      `<rect x="14" y="${46 + i * 24}" width="102" height="18" rx="6" fill="${i === 1 ? t.acc : t.panel}" stroke="${t.line}"/>
<text x="24" y="${58.5 + i * 24}" class="sans" font-size="10.5" fill="${i === 1 ? t.accInk : t.fg}">${r}</text>`).join("");
    return `<g transform="translate(${x + 35} ${y - 8})">
<rect width="130" height="166" rx="22" fill="${t.panel2}" stroke="${t.line2}"/>
<rect x="48" y="9" width="34" height="6" rx="3" fill="${t.line2}"/>
<text x="16" y="36" class="sans" font-size="13" font-weight="600" fill="${t.fg}">MesureOS <tspan class="serif" font-weight="400" fill="${t.accText}">Pro</tspan></text>
${rows}
</g>`;
  },
  pass(t, x, y) {
    let qr = "";
    // Deterministic pseudo-QR pattern.
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++)
      if (((i * 7 + j) * 37) % 11 < 5 || (i < 2 && j < 2) || (i < 2 && j > 4) || (i > 4 && j < 2))
        qr += `<rect x="${i * 9}" y="${j * 9}" width="8" height="8" rx="1.5"/>`;
    return `<g transform="translate(${x} ${y})">
<rect width="200" height="150" rx="16" fill="${t.panel2}" stroke="${t.line}"/>
<text x="18" y="28" class="mono" font-size="10.5" letter-spacing="1" fill="${t.dim}">MEMBER PASS · FR EN DE</text>
<g transform="translate(18 44)" fill="${t.fg}">${qr}</g>
<text x="100" y="64" class="sans" font-size="12" font-weight="600" fill="${t.fg}">Abonnement</text>
<g>
  <rect x="100" y="74" width="84" height="22" rx="11" fill="${t.line2}"><animate attributeName="fill" values="${t.line2};${t.line2};${t.acc};${t.acc};${t.line2}" keyTimes="0;.4;.45;.95;1" dur="5s" repeatCount="indefinite"/></rect>
  <text x="142" y="89" text-anchor="middle" class="mono" font-size="10" fill="${t.fg}">en attente<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;.4;.45;.95;1" dur="5s" repeatCount="indefinite"/></text>
  <text x="142" y="89" text-anchor="middle" class="mono" font-size="10" font-weight="600" fill="${t.accInk}" opacity="0">actif ✓<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.4;.45;.95;1" dur="5s" repeatCount="indefinite"/></text>
</g>
<text x="18" y="132" class="mono" font-size="10" fill="${t.muted}">coach scan at the door</text>
</g>`;
  },
  chart(t, x, y) {
    const bars = [38, 52, 44, 66, 58, 80, 72, 96];
    const pts = [40, 46, 42, 58, 55, 70, 68, 84];
    const line = pts.map((p, i) => `${18 + i * 22 + 7},${132 - p}`).join(" ");
    return `<g transform="translate(${x} ${y})">
<rect width="200" height="150" rx="16" fill="${t.panel2}" stroke="${t.line}"/>
<text x="18" y="28" class="mono" font-size="10.5" letter-spacing="1" fill="${t.dim}">REVENUE · 1Y</text>
<text x="182" y="28" text-anchor="end" class="mono" font-size="10.5" fill="${t.accText}">+18.4%</text>
${bars.map((b, i) => `<rect x="${18 + i * 22}" y="${132 - b}" width="14" height="${b}" rx="3" fill="${i === bars.length - 1 ? t.acc : t.line2}"/>`).join("")}
<polyline points="${line}" fill="none" stroke="${t.acc2}" stroke-width="2" stroke-linejoin="round" stroke-dasharray="260" stroke-dashoffset="260"><animate attributeName="stroke-dashoffset" from="260" to="0" dur="1.6s" fill="freeze"/></polyline>
</g>`;
  },
};

function project(p, i, t) {
  const W = 590, H = 300;
  const body = `${frame(W, H, t)}
<text x="36" y="52" class="mono" font-size="11.5" letter-spacing="1.2" fill="${t.muted}">${String(i + 1).padStart(2, "0")} · ${esc(p.tag.toUpperCase())}</text>
<text x="36" y="100" class="sans" font-size="${Math.min(32, Math.floor(300 / (p.name.length * 0.56)))}" font-weight="600" letter-spacing="-1" fill="${t.fg}">${esc(p.name)}</text>
${p.lines.map((l, k) => `<text x="36" y="${134 + k * 22}" class="sans" font-size="15" fill="${t.muted}">${esc(l)}</text>`).join("")}
${chipRow(36, 204, p.tech.slice(0, 4), t, { size: 11.5 })}
<line x1="36" y1="246" x2="${W - 36}" y2="246" stroke="${t.line}"/>
<text x="36" y="274" class="mono" font-size="12.5" letter-spacing="0.6" fill="${p.url ? t.accText : t.dim}">${esc(p.cta)}${p.url ? " ↗" : ""}</text>
${VISUALS[p.visual](t, 354, 40)}`;
  return svg(W, H, t, body, `${p.name}: ${p.lines.join(" ")}`);
}

function sectionLabel(text, t) {
  const W = 1200, H = 56;
  const body = `<text x="4" y="38" class="sans" font-size="26" font-weight="600" letter-spacing="-0.6" fill="${t.fg}">${esc(text[0])} <tspan class="serif" font-weight="400" fill="${t.accText}">${esc(text[1])}</tspan></text>
<line x1="${Math.round(4 + (text[0].length + 1) * 26 * 0.54 + text[1].length * 26 * 0.42 + 24)}" y1="30" x2="${W - 4}" y2="30" stroke="${t.line2}"/>`;
  return svg(W, H, t, body, text.join(" "));
}

// ---------------------------------------------------------------- write
const s = await loadStats();
const files = [];
for (const [mode, t] of Object.entries(THEMES)) {
  const w = (name, content) => { writeFileSync(join(OUT, `${name}-${mode}.svg`), content); files.push(name); };
  w("hero", hero(t, mode));
  for (const l of cfg.links) w(`btn-${l.id}`, button(l, t, mode));
  w("now", now(t));
  w("label-work", sectionLabel(["Things I've", "built & led"], t));
  cfg.projects.forEach((p, i) => w(`project-${p.id}`, project(p, i, t)));
  w("label-stack", sectionLabel(["The", "stack"], t));
  w("stack", stack(t));
  w("stats", stats(t, s));
}

// ---------------------------------------------------------------- README
const pic = (name, alt, width, href) => {
  const img = `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg"><img src="assets/${name}-light.svg" alt="${esc(alt)}"${width ? ` width="${width}"` : ""}></picture>`;
  return href ? `<a href="${href}">${img}</a>` : img;
};
const yearTotal = s.days.slice(-365).reduce((a, d) => a + d.count, 0);
const showStats = yearTotal >= (cfg.statsMinContributions ?? 0);
console.log(`stats card: ${showStats ? "shown" : "hidden"} (${yearTotal} contributions, threshold ${cfg.statsMinContributions ?? 0})`);
const primary = cfg.links.find((l) => l.id === "site");
const projectCell = (p) => pic(`project-${p.id}`, `${p.name}: ${p.lines.join(" ")}`, "49%", p.url || undefined);
const pairs = [];
for (let i = 0; i < cfg.projects.length; i += 2) pairs.push(cfg.projects.slice(i, i + 2).map(projectCell).join(" "));

const readme = `<!-- Generated by scripts/build.mjs from profile.config.json. Edit those, not this file. -->

${pic("hero", `${cfg.name}, ${cfg.role} at ${cfg.company}. ${cfg.headline.join(" ")}`, "100%", primary?.url)}

<p align="center">
${cfg.links.map((l) => pic(`btn-${l.id}`, l.label, undefined, l.url)).join("&nbsp;")}
</p>

${pic("now", "What I'm working on right now", "100%")}

${pic("label-work", "Things I've built and led", "100%")}

${pairs.join("\n\n")}

${pic("label-stack", "The stack", "100%")}

${pic("stack", "Tech stack", "100%")}

${showStats ? pic("stats", "My GitHub contributions over the last year", "100%") : ""}

<p align="center"><sub>Every image here is a hand-drawn SVG with light and dark versions. A GitHub Action redraws the numbers every night.</sub></p>
`;
writeFileSync(join(ROOT, "README.md"), readme);
console.log(`wrote ${files.length} svgs + README.md`);
