// Check minimo: se a conta de dinheiro ou o gate de spot quebrar, isso falha.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { netRate, pricer, recipeProfit, spotFit, spotToday } from "../calc.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

// --- taxa de mercado
assert.equal(netRate({ vp: false, ring: false }), 0.65);
assert.equal(+netRate({ vp: true, ring: false }).toFixed(3), 0.845);
assert.equal(+netRate({ vp: true, ring: true }).toFixed(4), 0.8775);

// --- fixture sintetica
const fake = { names: { Out: 1, In: 2 }, items: { 1: { p: 1000 }, 2: { p: 100 } }, npc: { Vendor: 10 } };
const p = pricer(fake);
assert.equal(p.priceOf("Out"), 1000);
assert.equal(p.priceOf("Vendor"), 10);
assert.equal(p.priceOf("Inexistente"), 0);
assert.equal(p.isNpc("Vendor"), true);

const r = recipeProfit({ output: "Out", yield: 2, craftsPerHour: 10, inputs: [{ item: "In", qty: 5 }] }, p, 0.65);
assert.equal(r.revenue, 1300);
assert.equal(r.cost, 500);
assert.equal(r.hour, 8000);
assert.equal(recipeProfit({ output: "Vendor", yield: 1, craftsPerHour: 1, inputs: [] }, p, 0.65).revenue, 10,
  "venda no NPC nao deve sofrer taxa");

// --- gate de spot: Total Stat e DP, nao AP exibido
const zone = { stat: 900, statCap: 1000, dp: 400, ap: 310, items: ["Out"] };
const pobre = spotFit(zone, { stat: 500, ap: 200, dp: 300 });
assert.equal(pobre.locked, true);
assert.equal(pobre.missStat, 400);
assert.equal(pobre.missDp, 100);

const ok = spotFit(zone, { stat: 950, ap: 310, dp: 420 });
assert.equal(ok.locked, false);
assert.equal(ok.overCap, false);
assert.equal(ok.headroom, 50);

// AP exibido alto nao libera zona se o Total Stat nao alcanca
assert.equal(spotFit(zone, { stat: 800, ap: 420, dp: 500 }).locked, true,
  "Total Stat e o gate real, nao o AP exibido");
// acima do teto deve ser sinalizado
assert.equal(spotFit(zone, { stat: 1200, ap: 400, dp: 500 }).overCap, true);

// --- drift usa so os itens com variacao conhecida
const t = spotToday(zone, p, { Out: 10 });
assert.equal(t.items.length, 1);
assert.equal(t.drift, 10);
assert.equal(spotToday({ items: [] }, p, {}).drift, null, "sem item rastreado, drift e null");

// --- dados reais
const daily = read("daily.na.json");
const rp = pricer(daily);
const spots = read("spots.json"), recipes = read("recipes.json"), classes = read("classes.json");

const unpriced = [];
for (const rc of recipes.recipes) {
  if (!rp.priceOf(rc.output)) unpriced.push(`${rc.id}:${rc.output}`);
  for (const i of rc.inputs) if (!rp.priceOf(i.item)) unpriced.push(`${rc.id}:${i.item}`);
}
assert.deepEqual(unpriced, [], "receita sem preco: " + unpriced.join(", "));

// coerencia dos spots: a escala atual do jogo vai ate ~2600 Total Stat e ~4 bi/h
const ids = new Set();
for (const s of spots.spots) {
  assert.ok(!ids.has(s.id), `id duplicado: ${s.id}`); ids.add(s.id);
  assert.ok(s.statCap >= s.stat, `${s.id}: teto abaixo do requisito`);
  assert.ok(s.stat > 0 && s.stat <= 3000, `${s.id}: Total Stat fora de escala (${s.stat})`);
  assert.ok(s.silver >= 10e6 && s.silver <= 6e9, `${s.id}: silver/hora fora de escala (${s.silver})`);
  assert.ok(["medido", "derivado"].includes(s.silverSource), `${s.id}: fonte do silver nao declarada`);
  // DP exibido e DP em Total Stat sao escalas diferentes; trocar os dois trava a zona errada.
  if (s.dpStat) assert.ok(s.dpStat > s.dp, `${s.id}: DP em Total Stat (${s.dpStat}) deveria superar o exibido (${s.dp})`);
}
// a progressao precisa cobrir do inicio ao endgame atual
assert.ok(Math.max(...spots.spots.map((s) => s.stat)) >= 2500, "falta o endgame atual (Edania Inner)");
assert.ok(Math.min(...spots.spots.map((s) => s.stat)) <= 250, "falta a faixa inicial");

const cids = new Set();
for (const c of classes.classes) {
  assert.ok(!cids.has(c.id), `classe duplicada: ${c.id}`); cids.add(c.id);
  for (const f of ["name", "weapon", "awakening", "range", "difficulty", "profile", "note"])
    assert.ok(c[f], `classe ${c.id} sem ${f}`);
  assert.ok(c.note.length > 40, `classe ${c.id}: nota curta demais para ser guia`);
}
console.log(`ok: ${spots.spots.length} spots (${Math.min(...spots.spots.map(s=>s.stat))}-${Math.max(...spots.spots.map(s=>s.stat))} stat), ${recipes.recipes.length} receitas, ${classes.classes.length} classes`);
