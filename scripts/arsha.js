const BASE = "https://api.arsha.io";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(BASE + path, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status >= 500 && i < tries - 1) { await sleep(400 * (i + 1)); continue; }
    throw new Error(`${res.status} ${path.slice(0, 80)}`);
  }
}

export const hotList = (region) => req(`/v2/${region}/GetWorldMarketHotList`);
export const waitList = (region) => req(`/v2/${region}/GetWorldMarketWaitList`);
export const category = (region, main, sub) =>
  req(`/v2/${region}/GetWorldMarketList?mainCategory=${main}&subCategory=${sub}`);

// Some item ids make the upstream return 500 even alone. Split on failure so one
// bad id costs its batch, not the whole run.
async function batched(region, endpoint, pairs, size) {
  if (!pairs.length) return [];
  const out = [];
  for (let i = 0; i < pairs.length; i += size) {
    const chunk = pairs.slice(i, i + size);
    out.push(...(await resolveChunk(region, endpoint, chunk)));
  }
  return out;
}

async function resolveChunk(region, endpoint, chunk) {
  const ids = chunk.map((p) => p.id).join(",");
  const sids = chunk.map((p) => p.sid ?? 0).join(",");
  try {
    const r = await req(`/v2/${region}/${endpoint}?id=${ids}&sid=${sids}&lang=en`, 2);
    return Array.isArray(r) ? r : [r];
  } catch (e) {
    if (chunk.length === 1) return [];
    const mid = Math.ceil(chunk.length / 2);
    const [a, b] = await Promise.all([
      resolveChunk(region, endpoint, chunk.slice(0, mid)),
      resolveChunk(region, endpoint, chunk.slice(mid)),
    ]);
    return [...a, ...b];
  }
}

export const items = (region, pairs) => batched(region, "item", pairs, 40);
export const priceInfo = (region, pairs) => batched(region, "GetMarketPriceInfo", pairs, 20);
