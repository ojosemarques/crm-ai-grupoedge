# Jornada e atribuição de marketing — CRM-38

## Limite da entrega

A CRM-38 cria a fonte canônica local para landing pages, formulários, sessões,
touchpoints, conversões e resultados de atribuição. Ela não conecta Meta Ads,
Google Ads, analytics, cookies de terceiros, pixels, custo de mídia, ROAS ou
qualquer provider. A tela `/aquisicao` e a API correspondente operam somente no
PostgreSQL local e não fazem egress.

## Fonte da verdade e evidência

- `LandingPage` e `MarketingForm` são definições correntes; suas versões são
  imutáveis e reproduzem o contrato usado na captura;
- `MarketingSession` usa um identificador público opaco. Ela pode permanecer
  anônima ou ser associada a um Contact conhecido sem armazenar cookie bruto;
- `MarketingTouchpoint` é um fato append-only. UTM é normalizada, referrer é
  reduzido ao hostname, landing URL ao path e click ID somente ao tipo + SHA-256;
- `AttributionConversion` representa o evento canônico medido. A entrada de
  lead cria uma conversão direta ligada à `LeadFormSubmission`;
- `AttributionRun` fixa período, modelo e versão. `AttributionCredit` distribui
  exatamente 10.000 basis points por conversão, inclusive no bucket desconhecido;
- `AcquisitionDataQualityIssue` separa divergência, ausência e revisão de um
  fato aceito. Resolver o achado não apaga o fato histórico.

O sistema apresenta fatos, inferências e informação ausente separadamente. Um
resultado de atribuição é correlação segundo uma regra declarada, nunca prova de
causalidade ou incremento comercial.

## Modelos versionados

O seed cria três modelos locais:

| Chave | Regra | Resultado |
|---|---|---|
| `first-touch` | primeiro toque elegível na janela | 10.000 bps no primeiro fato |
| `last-touch` | último toque elegível na janela | 10.000 bps no último fato |
| `linear` | divisão determinística entre toques | soma exata de 10.000 bps; resto por ordem estável |

A versão guarda algoritmo, janela, configuração, hash e versão da política. Uma
mudança cria nova versão; não reescreve resultados antigos. Sem toque elegível,
o resultado vai para `UNKNOWN` com 10.000 bps. Quando há evidência encontrada,
mas parte foi excluída por privacidade/qualidade, a cobertura é `PARTIAL`.

## Privacidade

A finalidade `marketing-attribution-analytics` e sua base permanecem
`PENDING_LEGAL`. Portanto, fatos de aquisição podem ser preservados localmente
para revisão, mas não ficam elegíveis à atribuição. `REVIEW_REQUIRED` não é
convertido em `ALLOW`, não autoriza contato e não autoriza integração. Essa
decisão é registrada por Contact quando disponível.

Não são persistidos URL completa de referrer, click ID aberto, IP, user agent ou
segredo. Nenhum valor de evidência é exportável sem a permissão específica.

## Entrada e outbox

Manual, CSV, webhook local e simulador continuam chamando o mesmo
`LeadIntakeService`. Quando o payload inclui `acquisition`, o serviço cria
sessão/touchpoint, conversão, links da submissão e outbox na mesma transação.
Falha em qualquer etapa reverte todo o conjunto. O evento
`marketing.conversion.recorded` é marcado `DELIVERED_LOCAL`; não existe consumer
externo ou tentativa de rede nesta entrega.

## Backfill conservador

```bash
pnpm db:marketing:backfill -- --mode=dry-run --limit=2000
pnpm db:marketing:backfill -- --mode=execute --limit=2000
```

O comando recusa produção, host remoto, banco diferente de `politizai_crm` e
schema diferente de `public`. Ele deriva somente origem, campanha e criativo já
presentes nas colunas relacionais da submissão. O touchpoint legado recebe
`LEGACY_REVIEW_REQUIRED`, `attributionEligible=false` e uma pendência explícita;
não se inventam UTM, sessão, landing page, formulário ou click ID históricos.
Dry-run não cria fatos. Execução e replay usam chaves idempotentes persistidas.

## Operação local

1. aplique migrations e execute o seed;
2. abra `/aquisicao` como Administrador ou Gestor;
3. selecione período e modelo;
4. execute o cálculo local;
5. inspecione cobertura, resultados e pendências antes de interpretar qualquer
   correlação.

Administrador gerencia definições/modelos e revisões. Gestor lê, calcula e
resolve revisões. SDR, Closer e Visualizador possuem somente leitura da jornada
no escopo desta fundação. Toda autorização é repetida no servidor.

## Fora do escopo

## Performance de mídia local — CRM-39

A CRM-39 acrescenta `MarketingChannel → MarketingAdAccount →
MarketingCampaign → MarketingAdGroup → MarketingAd → MarketingCreative` sem
substituir `AcquisitionCampaign` ou `AcquisitionCreative`. O vínculo legado usa
exclusivamente IDs relacionais explícitos. Nome parecido nunca cria união.

`MarketingPerformanceFact` registra grão diário, período, timezone, moeda,
dimensões, investimento em centavos, impressões, alcance, cliques, visualizações,
leads/compras/receita reportados e evidência da linha original. Cada correção
gera uma revisão com `supersedesFactId`; rollback restaura a revisão confirmada
anterior quando existe e gera uma revisão `VOIDED` somente ao desfazer o fato
inicial. Uma importação já superada é registrada como não corrente, sem alterar
o fato vigente. Trigger
impede UPDATE/DELETE. O leitor escolhe somente a revisão mais recente de cada
`grainKey`, evitando soma de versões e dupla contagem.

O fluxo `/aquisicao/midia` é local: prévia persistida, confirmação explícita,
idempotência, auditoria, replay e rollback. Limites: 512 KiB, 2.000 linhas,
valores não negativos e bloqueio de células textuais semelhantes a fórmula.
Não há provider, token, egress, conexão a plataforma de anúncios ou banco remoto.

A reconciliação compara leads reportados pela mídia com submissões CRM apenas
quando a campanha possui ponte legada exata. Tolerâncias são versionadas;
divergências viram pendências revisáveis e nunca corrigem o CRM automaticamente.
Providers e credenciais externas continuam reservados a tasks futuras.

## Fonte Meta Ads preparada pela CRM-40

O conector Meta Ads somente leitura pode alimentar a hierarquia e os fatos de
performance da CRM-39 sem criar automaticamente touchpoints, conversões,
créditos de atribuição ou vínculos com pessoas. `sourceProvider`, versão da API,
execução, IDs externos e cobertura de métricas preservam proveniência. Ações
reportadas pela plataforma ficam em `MarketingProviderActionFact`, inclusive as
desconhecidas, para evitar que mudança de taxonomia vire conversão inventada.

Sem uma ponte relacional exata, os dados permanecem apenas como performance
observada. A validação externa está adiada; nenhuma conta ou dado real foi
consultado.

## Fonte Google Ads preparada pela CRM-41

O conector Google Ads usa a mesma hierarquia e fatos da CRM-39, com IDs externos
exatos e `sourceProvider=GOOGLE_ADS`. Custo em micros, interações, conversões,
valor de conversões, all conversions, CTR, CPC e CPM permanecem métricas do
provider em colunas próprias. Elas não criam touchpoint, Contact, conversão
canônica, crédito ou receita CRM.

Zero informado e ausência são diferenciados por `availableMetrics` e
`missingMetrics`. Revisões tardias são append-only. Vários assets de um anúncio
permanecem registros separados; não há redução destrutiva para um “criativo”
arbitrário. A validação externa está adiada e nenhum egress ocorreu.
