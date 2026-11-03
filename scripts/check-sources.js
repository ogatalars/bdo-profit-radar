// Spots, classes e receitas sao tabelas copiadas de paginas de terceiros. Nao ha
// API publica de grind spots (Garmoth tem, mas bloqueia servidor por Cloudflare),
// entao nao da para atualizar sozinho. O que da e perceber quando a fonte mudou,
// em vez de deixar o dado envelhecer calado.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const DATA = new URL("../data/", import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));
const UA = "Mozilla/5.0 (compatible; bdo-profit-radar/1.0; +https://github.com/ogatalars/bdo-profit-radar)";
const STALE_DAYS = 180;

const sources = [];
const spots = read("spots.json");
for (const [id, s] of Object.entries(spots._meta.sources || {}))
  sources.push({ id, url: s.url, date: s.date, dataset: "spots.json" });
const classes = read("classes.json");
if (classes._meta.source)
  sources.push({ id: "classhub", url: classes._meta.source, date: classes._meta.listUpdated, dataset: "classes.json" });
for (const url of read("recipes.json")._meta.sources || [])
  if (url.startsWith("http")) sources.push({ id: url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 28), url, dataset: "recipes.json" });

const stateFile = "source-state.json";
const prev = existsSync(new URL(stateFile, DATA)) ? read(stateFile) : { sources: {} };
const now = new Date();
const state = { checkedAt: now.toISOString(), sources: {} };
const changed = [], stale = [], failed = [];

const pickDate = (html) =>
  html.match(/modified_time"\s+content="([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1] ||
  html.match(/Last updated ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] || null;

for (const s of sources) {
  try {
    const res = await fetch(s.url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) { failed.push(`${s.id}: HTTP ${res.status}`); continue; }
    const html = await res.text();
    // Hash do corpo sem scripts/estilos: muda quando o conteudo muda, nao a cada deploy do site.
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const published = pickDate(html);
    state.sources[s.id] = { url: s.url, hash, published, dataset: s.dataset };

    const before = prev.sources?.[s.id];
    if (before && before.hash !== hash)
      changed.push(`${s.id} (${s.dataset}) mudou${published ? ` — agora diz "${published}"` : ""}`);

    const ref = published ? new Date(published) : s.date ? new Date(s.date) : null;
    if (ref && !isNaN(ref)) {
      const days = Math.floor((now - ref) / 864e5);
      state.sources[s.id].ageDays = days;
      if (days > STALE_DAYS) stale.push(`${s.id} (${s.dataset}): fonte parada ha ${days} dias`);
    }
  } catch (e) { failed.push(`${s.id}: ${e.message}`); }
}

writeFileSync(new URL(stateFile, DATA), JSON.stringify(state, null, 1) + "\n");

console.log(`verificadas ${Object.keys(state.sources).length}/${sources.length} fontes`);
for (const [id, s] of Object.entries(state.sources))
  console.log(`  ${id.padEnd(14)} ${String(s.published ?? "?").padEnd(22)} ${s.ageDays != null ? s.ageDays + "d" : ""}`);
if (failed.length) console.log("\ninacessiveis:\n  " + failed.join("\n  "));
if (stale.length) console.log("\nENVELHECIDAS:\n  " + stale.join("\n  "));
if (changed.length) console.log("\nMUDARAM desde a ultima checagem:\n  " + changed.join("\n  "));

// Saida para o workflow decidir se abre issue.
if (process.env.GITHUB_OUTPUT) {
  const lines = [...changed.map((c) => `- ${c}`), ...stale.map((s) => `- ${s}`)];
  writeFileSync(process.env.GITHUB_OUTPUT,
    `needs_review=${lines.length ? "true" : "false"}\n` +
    `report<<EOF\n${lines.join("\n") || "nada a revisar"}\nEOF\n`, { flag: "a" });
}
