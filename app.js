import { netRate as calcNet, pricer, recipeProfit, spotFit, spotToday } from "./calc.js";

const $ = (s) => document.querySelector(s);
const fmt = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + " bi";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",") + " mi";
  if (a >= 1e3) return Math.round(n).toLocaleString("pt-BR");
  return Math.round(n).toString();
};
const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(1).replace(".", ",") + "%";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DAILY, SPOTS, RECIPES, CLASSES;

const netRate = () => calcNet({ vp: $("#vp").checked, ring: $("#ring").checked });
const P = () => pricer(DAILY);
const currentClass = () => CLASSES.classes.find((c) => c.id === $("#cls").value);

async function load() {
  const region = $("#region").value;
  $("#status").textContent = "carregando dados...";
  const bust = `?v=${Date.now()}`;
  const [daily, spots, recipes, classes] = await Promise.all([
    fetch(`data/daily.${region}.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    fetch(`data/spots.json`).then((r) => r.json()),
    fetch(`data/recipes.json`).then((r) => r.json()),
    fetch(`data/classes.json`).then((r) => r.json()),
  ]);
  if (!daily) { $("#status").textContent = `sem snapshot para a regiao ${region.toUpperCase()}.`; return; }
  DAILY = daily; SPOTS = spots; RECIPES = recipes; CLASSES = classes;
  if (!$("#cls").options.length) {
    $("#cls").innerHTML = classes.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    $("#cls").value = "witch";
  }
  const when = new Date(daily.generatedAt);
  $("#status").innerHTML = `mercado <b>${region.toUpperCase()}</b> &middot; snapshot de ${when.toLocaleString("pt-BR")}` +
    (daily.prevAt ? ` &middot; comparado com ${new Date(daily.prevAt).toLocaleString("pt-BR")}`
                  : ` &middot; <span class="dim">primeiro snapshot desta regiao</span>`);
  renderAll();
}

function renderAll() {
  $("#netpct").textContent = (netRate() * 100).toFixed(1).replace(".", ",") + "%";
  renderMarket(); renderJobs(); renderSpots(); renderClasses();
}

function renderMarket() {
  const tb = $("#t-demand tbody"); tb.innerHTML = "";
  for (const r of DAILY.demand) {
    const it = DAILY.items[r.id];
    tb.insertAdjacentHTML("beforeend", `<tr><td class="name">${esc(it.n)}</td>
      <td class="num">${fmt(it.p)}</td><td class="num">${fmt(r.sold)}</td>
      <td class="num">${fmt(r.sold * it.p)}</td></tr>`);
  }
  if (!DAILY.demand.length) tb.innerHTML = `<tr><td colspan="4" class="dim">precisa de dois snapshots. Volte amanha.</td></tr>`;

  const tm = $("#t-movers tbody"); tm.innerHTML = "";
  for (const r of DAILY.movers) {
    const it = DAILY.items[r.id];
    tm.insertAdjacentHTML("beforeend", `<tr><td class="name">${esc(it.n)}</td>
      <td class="num">${fmt(it.p)}</td>
      <td class="num ${r.dp >= 0 ? "up" : "down"}">${pct(r.dp)}</td>
      <td class="num dim">${fmt(it.s)}</td></tr>`);
  }
  if (!DAILY.movers.length) tm.innerHTML = `<tr><td colspan="4" class="dim">precisa de dois snapshots. Volte amanha.</td></tr>`;
}

function renderJobs() {
  const rate = netRate(), p = P();
  const rows = RECIPES.recipes.map((r) => ({ r, ...recipeProfit(r, p, rate) }))
    .filter((x) => x.priced).sort((a, b) => b.hour - a.hour);
  const tb = $("#t-jobs tbody");
  tb.innerHTML = rows.map((x) => `<tr>
      <td class="name">${esc(x.r.name)}</td><td class="dim">${esc(x.r.job)}</td>
      <td class="num">${fmt(x.cost)}</td><td class="num">${fmt(x.revenue)}</td>
      <td class="num ${x.margin >= 0 ? "up" : "down"}">${pct(x.margin)}</td>
      <td class="num ${x.hour >= 0 ? "up" : "down"}"><b>${fmt(x.hour)}</b></td></tr>`).join("")
    || `<tr><td colspan="6" class="dim">sem precos suficientes.</td></tr>`;
}

function renderSpots() {
  const p = P();
  const me = { stat: +$("#stat").value, ap: +$("#ap").value, dp: +$("#dp").value };
  const cls = currentClass();
  const rows = SPOTS.spots.map((s) => ({ s, ...spotFit(s, me), ...spotToday(s, p, DAILY.changes || {}) }))
    .sort((a, b) => (a.locked - b.locked) || (b.s.silver - a.s.silver));
  const visible = $("#hideLocked").checked ? rows.filter((x) => !x.locked) : rows;
  const best = visible.find((x) => !x.locked);

  // Classe suporte rende em grupo; burst prefere alvo concentrado. Sinal
  // textual, nao multiplicador: nao ha medicao publica por classe e por spot.
  const suits = (s) => {
    if (!cls) return null;
    const group = s.party !== "Solo";
    if (cls.profile === "suporte" && group) return `${cls.name} brilha em grupo`;
    if (cls.profile === "aoe" && !group) return `AoE de ${cls.name} limpa bem solo`;
    return null;
  };

  const head = cls ? `<div class="note"><b>${esc(cls.name)}</b> &middot; ${esc(cls.weapon)} /
    ${esc(cls.awakening)} &middot; ${esc(cls.range)} &middot; perfil ${esc(cls.profile)} &middot;
    dificuldade ${esc(cls.difficulty)}<br>${esc(cls.note)}</div>` : "";

  $("#spot-list").innerHTML = head + (visible.map((x) => {
    const s = x.s, tag = suits(s);
    const miss = [x.missStat && `${x.missStat} Total Stat`, x.missDp && `${x.missDp} DP`]
      .filter(Boolean).join(" e ");
    const itemsTxt = x.items.map((i) =>
      `${esc(i.name)} ${fmt(i.price)}${i.change != null
        ? ` <span class="${i.change >= 0 ? "up" : "down"}">${pct(i.change)}</span>` : ""}`).join(" &middot; ")
      || '<span class="dim">drops principais fora do mercado central</span>';
    return `<div class="card ${x.locked ? "locked" : ""}">
      <h3>${esc(s.name)}
        ${x === best ? '<span class="tag ok">melhor que voce alcanca</span>' : ""}
        ${x.locked ? `<span class="tag no">faltam ${miss}</span>` : ""}
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ""}
        ${x.overCap && !x.locked ? '<span class="tag">acima do teto da zona</span>' : ""}
      </h3>
      <div class="meta">${esc(s.region)} &middot; ${esc(s.party)} &middot;
        pede <b>${s.stat}</b> Total Stat e <b>${s.dp}</b> DP &middot;
        AP exibido ${s.ap}${s.dpStat ? ` &middot; DP em Total Stat ${s.dpStat}` : ""} &middot;
        teto ${s.statCap} (excedente rende ${s.capPct}%)</div>
      <div class="big">${fmt(s.silver)} <span style="font-size:13px;color:var(--dim)">silver/hora
        <span class="tag">${s.silverSource}</span></span></div>
      ${x.drift != null ? `<div class="breakdown">drops de mercado hoje:
        <b class="${x.drift >= 0 ? "up" : "down"}">${pct(x.drift)}</b> na media</div>` : ""}
      <div class="breakdown">${itemsTxt}</div>
      <div class="breakdown"><i>${esc(s.note)}</i></div>
    </div>`;
  }).join("") || `<p class="dim">nenhum spot com esses stats. Desmarque "so o que eu consigo" para ver a progressao.</p>`);
}

function renderClasses() {
  const q = $("#clsSearch").value.trim().toLowerCase();
  const prof = $("#clsProfile").value, diff = $("#clsDiff").value;
  const rows = CLASSES.classes.filter((c) =>
    (!prof || c.profile === prof) && (!diff || c.difficulty === diff) &&
    (!q || `${c.name} ${c.weapon} ${c.awakening}`.toLowerCase().includes(q)));
  $("#class-list").innerHTML = rows.map((c) => `<div class="card">
      <h3>${esc(c.name)}
        <span class="tag">${esc(c.profile)}</span>
        <span class="tag">${esc(c.difficulty)}</span>
        <span class="tag">${esc(c.range)}</span></h3>
      <div class="meta">${esc(c.weapon)} &rarr; ${esc(c.awakening)}</div>
      <div>${esc(c.note)}</div>
    </div>`).join("") || `<p class="dim">nenhuma classe com esse filtro.</p>`;
}

const TABS = ["market", "jobs", "spots", "classes"];
function showTab(name) {
  if (!TABS.includes(name)) name = "market";
  document.querySelectorAll("nav button").forEach((o) => o.setAttribute("aria-selected", o.dataset.tab === name));
  for (const t of TABS) $(`#tab-${t}`).hidden = t !== name;
}
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
addEventListener("hashchange", () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

["#vp", "#ring"].forEach((s) => $(s).addEventListener("change", () => DAILY && renderAll()));
["#cls", "#stat", "#ap", "#dp", "#hideLocked"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderSpots()));
["#clsSearch", "#clsProfile", "#clsDiff"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderClasses()));
$("#region").addEventListener("change", load);
load().catch((e) => ($("#status").textContent = "erro ao carregar: " + e.message));
