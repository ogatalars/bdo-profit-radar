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

// Um ingrediente generico ("Grain") aceita varios itens; quem cozinha usa o
// mais barato do dia, entao a conta faz o mesmo.
export function resolveInput(i, priceOf) {
  const options = i.any?.length ? i.any : [i.item];
  let best = null;
  for (const name of options) {
    const price = priceOf(name);
    if (price > 0 && (!best || price < best.price)) best = { name, price };
  }
  return best ? { ...best, qty: i.qty, generic: i.any?.length ? i.item : null }
              : { name: i.item, price: 0, qty: i.qty, generic: null };
}

export function recipeProfit(r, { priceOf, isNpc }, rate) {
  const parts = r.inputs.map((i) => resolveInput(i, priceOf));
  const cost = parts.reduce((s, p) => s + p.price * p.qty, 0);
  const outPrice = priceOf(r.output);
  const revenue = r.yield * outPrice * (isNpc(r.output) ? 1 : rate);
  const perCraft = revenue - cost;
  const missing = parts.filter((p) => p.price <= 0).map((p) => p.name);
  return {
    parts, cost, revenue, perCraft,
    hour: perCraft * r.craftsPerHour,
    margin: cost > 0 ? (perCraft / cost) * 100 : 0,
    missing: outPrice > 0 ? missing : [...missing, r.output],
    priced: outPrice > 0 && missing.length === 0,
  };
}

// Zonas modernas tem dois gates: o AP exibido no perfil e o Total Stat (soma
// com cristais e buffs). O Total Stat e o que a zona realmente checa.
// Acima de statCap, o AP excedente rende so capPct% — por isso empilhar AP
// alem do teto da zona nao aumenta silver proporcionalmente.
// Zonas de Elvia e anteriores nunca foram publicadas em Total Stat: a fonte so
// da o AP exibido. Nesse caso o gate e o AP exibido, e dizemos isso na UI em
// vez de inventar um Total Stat equivalente.
export function spotFit(s, { stat, ap, dp }) {
  const usesStat = s.stat != null;
  const missStat = usesStat ? Math.max(0, s.stat - stat) : 0;
  const missAp = Math.max(0, s.ap - ap);
  const missDp = Math.max(0, s.dp - dp);
  const gateMiss = usesStat ? missStat : missAp;
  return {
    usesStat, missStat, missAp, missDp,
    locked: gateMiss > 0 || missDp > 0,
    overCap: usesStat && s.statCap != null && stat > s.statCap,
    headroom: usesStat && s.statCap != null ? s.statCap - stat : null,
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
