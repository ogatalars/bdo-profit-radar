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

// Zonas modernas tem dois gates: o AP exibido no perfil e o Total Stat (soma
// com cristais e buffs). O Total Stat e o que a zona realmente checa.
// Acima de statCap, o AP excedente rende so capPct% — por isso empilhar AP
// alem do teto da zona nao aumenta silver proporcionalmente.
export function spotFit(s, { stat, ap, dp }) {
  const missStat = Math.max(0, s.stat - stat);
  const missDp = Math.max(0, s.dp - dp);
  const missAp = Math.max(0, s.ap - ap);
  return {
    locked: missStat > 0 || missDp > 0,
    missStat, missDp, missAp,
    overCap: stat > s.statCap,
    headroom: s.statCap - stat,
  };
}

// O silver/hora e a referencia da zona; o que varia com o dia e o preco dos
// drops de mercado dela. Devolvemos os dois lados separados, sem misturar
// numero medido com estimativa de preco.
export function spotToday(s, { priceOf }, movers = {}) {
  const items = (s.items || []).map((name) => ({
    name, price: priceOf(name), change: movers[name] ?? null,
  })).filter((i) => i.price > 0);
  const tracked = items.filter((i) => i.change != null);
  const drift = tracked.length
    ? tracked.reduce((a, i) => a + i.change, 0) / tracked.length
    : null;
  return { items, drift };
}
