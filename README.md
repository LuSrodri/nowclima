# nowclima

**Ao vivo:** https://nowclima.lusrodri.workers.dev

Digite o nome de uma cidade, bairro ou distrito e veja:

- uma **imagem característica do lugar**, gerada por IA de acordo com o tempo e a hora do dia de lá (chuva, céu limpo, pôr do sol, noite…);
- a **previsão hora a hora para os próximos 7 dias**, do modelo **WeatherNext 3** do Google DeepMind, com a faixa provável (percentis 10–90 do ensemble de 64 cenários);
- o **"agora" recalculado minuto a minuto** (interpolação entre as horas do modelo), relógio no fuso do lugar e verificação de nova rodada do modelo a cada minuto.

## Como funciona

```
navegador (Vite + TypeScript, sem framework)
   │  /api/search   → Photon (OpenStreetMap): cidades, bairros, distritos
   │  /api/forecast → WeatherNext 3 via BigQuery  ──(fallback)──▶ WeatherNext 2 via Open-Meteo
   │  /api/image    → Gemma 4 escreve a cena real do lugar → FLUX.2 [klein] 4B gera a imagem
   ▼
Cloudflare Worker (TypeScript) + KV (cache de previsões e imagens) + Workers AI
```

### Previsão: WeatherNext 3

O WeatherNext 3 roda **toda hora**: as rodadas intermediárias cobrem 48 h e as de 00/06/12/18 UTC cobrem 15 dias, com passo nativo de 1 h e resolução de 0,1°. O app junta a rodada mais recente (primeiras 48 h) com a rodada longa mais recente (até 168 h), consulta a célula da grade mais próxima e entrega média, p10 e p90.

Derivados calculados no app: umidade relativa (Magnus, a partir do ponto de orvalho), sensação térmica (índice de calor da NWS / wind chill), direção do vento (componentes u/v), probabilidade de chuva (a partir dos percentis de precipitação) e condição do céu (nuvens + chuva + temperatura).

O acesso aos dados do WeatherNext 3 precisa de aprovação do Google (de 5 a 7 dias úteis). **Enquanto ele não estiver configurado, o app usa automaticamente o WeatherNext 2** (ensemble de 64 membros, aberto via Open-Meteo) e avisa isso no rodapé.

### Imagem: FLUX.2 [klein] no Workers AI

Grátis dentro da cota diária do Workers AI (10 mil neurons/dia ≈ 150 imagens 1280×720). Cada imagem é guardada no KV por lugar + céu (limpo, nublado, chuva, neve, névoa) + período do dia (amanhecer, dia, entardecer, noite), então cada combinação só é gerada uma vez. O limite diário fica em `IMAGE_DAILY_LIMIT` no `wrangler.jsonc`. Quando o limite é atingido, o app mostra um céu ilustrado no lugar da foto.

## Rodando localmente

```bash
npm install
npm run build        # gera o frontend em dist/
npx wrangler login   # Workers AI sempre roda na nuvem, mesmo em dev
npm run dev          # Vite em http://localhost:5173 + Worker em :8787
```

## Ativando o WeatherNext 3

1. Peça acesso no [formulário de dados do WeatherNext](https://developers.google.com/weathernext/guides/access-forecast) com o e-mail da sua conta Google Cloud.
2. Depois da aprovação, assine a listagem no BigQuery Analytics Hub. Isso cria um *linked dataset* no seu projeto contendo `weathernext_3_0_0_0p1deg`.
3. Crie uma service account com os papéis **BigQuery Job User** (no projeto) e **BigQuery Data Viewer** (no dataset vinculado), e baixe a chave JSON.
4. Configure os segredos:

```bash
npx wrangler secret put GCP_SERVICE_ACCOUNT_JSON < service-account.json
npx wrangler secret put GCP_PROJECT_ID     # ex.: meu-projeto
npx wrangler secret put WN3_TABLE          # ex.: meu-projeto.weathernext_3.weathernext_3_0_0_0p1deg
```

Para desenvolvimento local, use `.dev.vars` (veja `.dev.vars.example`).

As consultas filtram pela partição `init_time` e pela geografia, e `WN3_MAX_BYTES_BILLED` limita quantos bytes cada consulta pode faturar. O resultado fica 5 minutos em cache por célula da grade.

> Os termos do WeatherNext tratam os dados em tempo real como experimentais ([GDM Real-Time Weather Forecasting Experimental Data Terms of Use](https://developers.google.com/weathernext/guides/access-forecast)). Leia os termos antes de expor o app publicamente com o WeatherNext 3 ativado. As previsões não substituem alertas oficiais da defesa civil.

## Deploy

```bash
npm run deploy   # vite build + wrangler deploy (o KV é criado automaticamente)
```

## Estrutura

```
src/
  shared/    tipos, física da previsão (umidade, sensação, chuva) e posição do sol
  worker/    API: geocodificação, provedores WeatherNext 3/2, autenticação Google, imagem
  client/    interface: busca, herói com imagem, faixa hora a hora em SVG, 7 dias
```

## Créditos

- Previsão: [WeatherNext](https://developers.google.com/weathernext) (Google DeepMind / Google Research). Os dados históricos são CC BY 4.0.
- Fallback: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
- Busca de lugares: [Photon](https://photon.komoot.io/) / © colaboradores do OpenStreetMap.
- Imagens: FLUX.2 [klein] (Black Forest Labs) e Gemma 4 (Google) no Cloudflare Workers AI.
