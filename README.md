# BDO Profit Radar

Site estático que mostra, para Black Desert Online: o que o mercado central está
negociando hoje, quais profissões estão dando lucro, e qual spot de grind rende
mais para o seu AP/DP.

Sem backend, sem banco, sem custo. Um workflow do GitHub Actions tira um snapshot
do mercado por dia e commita um JSON; o GitHub Pages serve a página, que só lê
esse arquivo.

## Como funciona

```
GitHub Actions (1x/dia)          GitHub Pages
  scripts/build-daily.js   ->    data/daily.<regiao>.json   ->  index.html
  varre o mercado inteiro        ~6 KB, já diferenciado         calcula no browser
```

O snapshot do dia é comparado com o do dia anterior. É daí que saem as duas
colunas que a API não entrega prontas:

- **procura do dia**: `totalTrades` é acumulado desde sempre, então a diferença
  entre dois snapshots é quanto foi vendido nas últimas 24h.
- **variação**: preço de hoje contra o de ontem.

`data/snapshot.<regiao>.json` guarda só preço e total de vendas por item, para o
diff do dia seguinte. É o único estado que existe.

## Rodando local

```bash
node scripts/build-daily.js      # REGION=na|eu|sa, padrão na
node scripts/test.js             # checa a conta de dinheiro
python3 -m http.server 8777      # abre http://localhost:8777
```

Sem dependências: Node 22 (`fetch` nativo) e qualquer servidor estático.

## Calibrando

Os **preços** são reais e ao vivo. As **taxas** não — são estimativas da
comunidade e ficam todas em JSON para você corrigir:

| arquivo | o que ajustar |
|---|---|
| `data/spots.json` | `trashPerHour`, `perHour` de cada drop, AP/DP exigidos |
| `data/recipes.json` | `yield` (rendimento por craft) e `craftsPerHour` |
| `data/npc-prices.json` | itens que não passam pelo mercado central |

Se um número do site não bate com a sua hora real de grind, o errado é a taxa no
JSON, não o preço. Ajuste e mande PR.

## O que este projeto não sabe

Vale saber antes de confiar no número:

- **Taxa de drop é estimativa.** O preço é ao vivo, a quantidade por hora não.
  Dois jogadores com o mesmo AP fazem horas diferentes no mesmo spot.
- **Nem tudo passa pelo mercado.** `Ancient Spirit Dust`, `Trace of Savagery` e
  `Hard Black Crystal Shard` não são negociados no mercado central hoje — estão
  contabilizados dentro do trash loot. Sal, açúcar e água mineral são de vendor,
  com preço fixo em `npc-prices.json`.
- **O ajuste por classe é heurística**, não medição: ±6% conforme o perfil da
  classe (AoE amplo x burst) bater ou não com a densidade do spot. Serve para
  desempatar spots próximos, não para decidir reroll.
- **Jackpot distorce a média.** Spots como Crypt e Star's End dependem de um
  acessório raro. A média por hora existe, a sua hora pode ser zero.
- **A API oscila.** Categorias do mercado respondem 500 em janelas de minutos. O
  build insiste em três passadas e, se ainda faltar preço de algum item, aborta
  sem escrever — o site continua com o dado de ontem em vez de mostrar número
  errado.

## Fonte

Preços do mercado central via [Arsha API](https://api.arsha.io). Projeto sem fins
lucrativos, não afiliado à Pearl Abyss.
