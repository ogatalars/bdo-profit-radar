// Resolve item names -> market ids, verified against the live market.
// Names repeat across ids in BDO's db (7 different "Tungrad Earring"), so the
// db alone is not enough: the winner is the id that actually trades.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { items } from "./arsha.js";

const REGION = process.env.REGION || "na";
const CACHE = new URL("./.itemdb-cache.json", import.meta.url);

async function itemDb() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const db = await (await fetch("https://api.arsha.io/util/db?lang=en")).json();
  writeFileSync(CACHE, JSON.stringify(db));
  return db;
}

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

const wanted = new Set();
for (const s of read("spots.json").spots) for (const d of s.drops) wanted.add(d.item);
for (const r of read("recipes.json").recipes) {
  wanted.add(r.output);
  for (const i of r.inputs) wanted.add(i.item);
}

const db = await itemDb();
const byName = new Map();
for (const it of db) {
  const k = it.name.toLowerCase();
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(it.id);
}

const resolved = {}, ambiguous = [], missing = [];
for (const name of wanted) {
  const ids = byName.get(name.toLowerCase());
  if (!ids?.length) { missing.push(name); continue; }
  if (ids.length === 1) resolved[name] = ids[0];
  else ambiguous.push({ name, ids });
}

// Tie-break ambiguous names by real trade volume.
for (const { name, ids } of ambiguous) {
  const rows = await items(REGION, ids.map((id) => ({ id })));
  const best = rows
    .filter((r) => r.name.toLowerCase() === name.toLowerCase())
    .sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0))[0];
  if (best && best.totalTrades > 0) {
    resolved[name] = best.id;
    console.log(`  tie-break ${name}: ${best.id} (${best.totalTrades.toLocaleString()} trades) de [${ids}]`);
  } else missing.push(`${name} (ambiguo, nenhum com volume: ${ids})`);
}

// Every resolved id must actually exist on the market.
const check = await items(REGION, Object.values(resolved).map((id) => ({ id })));
const live = new Map(check.map((r) => [r.id, r]));
const dead = Object.entries(resolved).filter(([, id]) => !live.has(id));

writeFileSync(new URL("../data/items.json", import.meta.url), JSON.stringify(resolved, null, 2) + "\n");
console.log(`\nresolvidos ${Object.keys(resolved).length}/${wanted.size}`);
if (dead.length) console.log("sem resposta do mercado:", dead.map(([n]) => n).join(", "));
if (missing.length) { console.error("NAO ENCONTRADOS:\n  " + missing.join("\n  ")); process.exit(1); }
