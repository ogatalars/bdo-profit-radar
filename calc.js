// Logica de dinheiro, compartilhada entre a pagina e os testes.

// Taxa do mercado central: base 35%, Value Pack devolve +30%, Rich Merchant Ring +5%.
export const netRate = ({ vp = true, ring = true } = {}) =>
  0.65 * (1 + (vp ? 0.3 : 0) + (ring ? 0.05 : 0));

export function pricer(daily) {
  const priceOf = (name) => {
    const id = daily.names?.[name];
    if (id != null) return daily.items?.[id]?.p ?? 0;
    return daily.npc?.[name] ?? 0;
  };
  // Item de vendor/trash nao passa pelo mercado, entao nao sofre taxa.
  const isNpc = (name) => daily.names?.[name] == null && daily.npc?.[name] != null;
  return { priceOf, isNpc };
}

export function recipeProfit(r, { priceOf, isNpc }, rate) {
  const cost = r.inputs.reduce((s, i) => s + priceOf(i.item) * i.qty, 0);
  const revenue = r.yield * priceOf(r.output) * (isNpc(r.output) ? 1 : rate);
  const perCraft = revenue - cost;
  return {
    cost, revenue, perCraft,
    hour: perCraft * r.craftsPerHour,
    margin: cost > 0 ? (perCraft / cost) * 100 : 0,
    priced: priceOf(r.output) > 0 && r.inputs.every((i) => priceOf(i.item) > 0),
  };
}

export function spotIncome(s, trashUnit, { priceOf, isNpc }, rate, classAdj = 1) {
  const trash = s.trashPerHour * trashUnit;
  const drops = s.drops.map((d) => ({
    name: d.item, perHour: d.perHour,
    value: d.perHour * priceOf(d.item) * (isNpc(d.item) ? 1 : rate),
  }));
  const market = drops.reduce((a, d) => a + d.value, 0);
  return { trash, market, drops, total: (trash + market) * classAdj };
}
