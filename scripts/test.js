// Check minimo: se a conta de dinheiro quebrar, isso falha.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { netRate, pricer, recipeProfit, spotIncome } from "../calc.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

// --- taxa de mercado
assert.equal(netRate({ vp: false, ring: false }), 0.65);
assert.equal(+netRate({ vp: true, ring: false }).toFixed(3), 0.845);
assert.equal(+netRate({ vp: true, ring: true }).toFixed(4), 0.8775);

// --- fixture sintetica: numeros conferiveis na mao
const fake = { names: { Out: 1, In: 2 }, items: { 1: { p: 1000 }, 2: { p: 100 } }, npc: { Vendor: 10 } };
const p = pricer(fake);
assert.equal(p.priceOf("Out"), 1000);
assert.equal(p.priceOf("Vendor"), 10);
assert.equal(p.priceOf("Inexistente"), 0);
assert.equal(p.isNpc("Vendor"), true);
assert.equal(p.isNpc("Out"), false);

// 2 outputs * 1000 * 0.65 = 1300 de receita; 5 inputs * 100 = 500 de custo
const r = recipeProfit({ output: "Out", yield: 2, craftsPerHour: 10,
  inputs: [{ item: "In", qty: 5 }] }, p, 0.65);
assert.equal(r.revenue, 1300);
assert.equal(r.cost, 500);
assert.equal(r.perCraft, 800);
assert.equal(r.hour, 8000);

// output de NPC nao paga taxa de mercado
const rn = recipeProfit({ output: "Vendor", yield: 1, craftsPerHour: 1, inputs: [] }, p, 0.65);
assert.equal(rn.revenue, 10, "venda no NPC nao deve sofrer taxa");

// spot: trash e preco fixo de NPC, drop passa pela taxa
const s = spotIncome({ trashPerHour: 100, drops: [{ item: "Out", perHour: 2 }] }, 3000, p, 0.65);
assert.equal(s.trash, 300000);
assert.equal(s.market, 1300);
assert.equal(s.total, 301300);
assert.equal(spotIncome({ trashPerHour: 100, drops: [] }, 3000, p, 0.65, 1.06).total, 318000);

// --- dados reais: todo item citado precisa ter preco
const daily = read("daily.na.json");
const rp = pricer(daily);
const spots = read("spots.json"), recipes = read("recipes.json");
const unpriced = [];
for (const sp of spots.spots) for (const d of sp.drops) if (!rp.priceOf(d.item)) unpriced.push(`${sp.id}:${d.item}`);
for (const rc of recipes.recipes) {
  if (!rp.priceOf(rc.output)) unpriced.push(`${rc.id}:${rc.output}`);
  for (const i of rc.inputs) if (!rp.priceOf(i.item)) unpriced.push(`${rc.id}:${i.item}`);
}
assert.deepEqual(unpriced, [], "itens sem preco: " + unpriced.join(", "));

// nenhum spot pode render 0, e ninguem deve render absurdo (sinal de dado errado)
for (const sp of spots.spots) {
  const inc = spotIncome(sp, spots._meta.trashUnitDefault, rp, netRate());
  assert.ok(inc.total > 1e6, `${sp.id} rende quase nada: ${inc.total}`);
  assert.ok(inc.total < 5e9, `${sp.id} rende absurdo (dado suspeito): ${inc.total}`);
}
console.log(`ok: ${spots.spots.length} spots, ${recipes.recipes.length} receitas, todos com preco`);
