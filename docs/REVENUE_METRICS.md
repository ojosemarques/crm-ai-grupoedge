# Métricas canônicas de receita — CRM-57

## Contrato

A CRM-57 consolida aquisição, funil, contrato, assinatura, caixa, retenção,
meta e forecast em uma camada única do monólito. Cada fato transacional continua
sendo a fonte da verdade; não existe tabela universal nem cálculo na interface.

O catálogo executável `crm57.1`, em
`src/modules/metrics/domain/revenue-metric-registry.ts`, declara por métrica: ID
estável, versão, objetivo, unidade, fontes, numerador, denominador, fórmula,
timestamp, período, timezone, `asOf`, coorte, filtros, dimensões, cancelamento,
reversão, deduplicação, cobertura, limitações, comparação, drilldown, permissão
e direção desejável.

Dinheiro permanece em centavos serializados como string; percentuais usam basis
points. Períodos são semiabertos `[from, to)` no timezone do workspace.

## Estados

| Estado | Significado |
|---|---|
| `AVAILABLE` | fato e cobertura suficientes; valor diferente de zero |
| `ZERO` | universo válido, cálculo executado e resultado zero |
| `NO_DENOMINATOR` | taxa impossível porque o denominador é zero |
| `UNAVAILABLE` | fonte ou corte necessário não existe |
| `NOT_APPLICABLE` | combinação de filtros e definição não é válida |
| `PARTIAL` | cálculo utilizável com cobertura/reconstrução incompleta |
| `SUPPRESSED` | resultado ocultado por escopo/permissão |

`null` nunca significa zero. API e UI entregam estado, razão, cobertura e
drilldown separadamente.

## Fontes e precedência

| Família | Fonte oficial | Regra temporal |
|---|---|---|
| aquisição | maior revisão `CONFIRMED` por `MarketingPerformanceFact.grainKey` | `periodStart`; fatos que cruzam limites não são rateados |
| funil | `LeadFormSubmission`, `LeadSlaCycle`, `StageHistory`, `MeetingHistory`, `OpportunityOutcomeSnapshot` | timestamp histórico, não estado atual inferido |
| bookings/TCV/MRR contratado | `CommercialContract.acceptedAt` + `ContractVersion` | aceite no intervalo |
| MRR ativo | ledger append-only `RevenueMovement` | `effectiveAt < corte`; reversões fecham a ponte |
| renovação/churn | `Renewal.decidedAt` e `ChurnEvent.effectiveAt` | somente decisão final/confirmada |
| caixa | `Payment.occurredAt` e `Payment.reversedAt` | confirmação soma e reversão subtrai no próprio período |
| inadimplência | `Invoice.dueAt` + pagamentos até `asOf` | fatura vencida não cancelada/voided |
| forecast/meta | `ForecastSnapshot` e itens imutáveis | snapshot visível com `asOf` menor ou igual ao corte |

Bookings, MRR contratado, MRR ativo e receita recebida são fatos diferentes.
Nenhum representa receita reconhecida contabilmente.

## Ponte de MRR

```text
MRR final = MRR inicial
          + New MRR + Expansion MRR + Reactivation MRR
          - Contraction MRR - Churned MRR
          + ajustes/reversões
```

`reconciled` só é verdadeiro quando os lados são idênticos. `RENEWAL`,
`REVERSAL` e sinais incompatíveis entram em ajustes visíveis.

## Retenção e coortes

- GRR/NRR usam apenas assinaturas com saldo positivo no início;
- GRR exclui expansão;
- NRR usa o saldo final da mesma coorte e exclui novas assinaturas do período;
- logo churn requer `ChurnEvent.logoChurn` confirmado;
- renovação usa `RENEWED / (RENEWED + NOT_RENEWED + CANCELLED)`;
- coortes da UI usam o mês civil de `Subscription.startsAt`; o mês em curso é
  censurado como `PARTIAL`.

Sem MRR inicial ou decisão, a taxa retorna `NO_DENOMINATOR`, nunca 0%.

## Comparações e séries

O período anterior equivalente segue `docs/METRICS.md`, preservando filtros,
escopo e timezone. Buckets civis são diários até 45 dias, semanais até 180 e
mensais acima disso. Fluxos agregam eventos; MRR é saldo no corte do bucket.
Bucket existente sem fato é zero; período inexistente não é criado.

## Filtros e RBAC

O serviço reutiliza `metrics.read` e o universo relacional autorizado:

- `WORKSPACE`: agregado do workspace;
- `TEAM`: fatos ligados ao universo das equipes autorizadas;
- `OWN`: fatos ligados ao universo próprio.

Custo de mídia é agregado e fica `SUPPRESSED` fora de `WORKSPACE`. Filtro
comercial sem correspondência segura no fato de mídia produz `NOT_APPLICABLE`;
o sistema não divide custo global por denominador filtrado. Campanha e criativo
legados são traduzidos por vínculos persistidos.

## Forecast e qualidade

Forecast usa somente snapshot imutável permitido pela CRM-56. Pipeline
ponderado fica `UNAVAILABLE` sem cobertura manual completa, e gap fica
`UNAVAILABLE` sem meta vinculada. Não existe modelo preditivo.

Qualidade expõe fechamento da ponte, cobertura de mídia, cobertura do forecast
e limitação histórica da inadimplência. Inadimplência em corte histórico é
`PARTIAL`: pagamentos são append-only, mas o cadastro da fatura é projeção
corrente.

## APIs e interface

Todas as rotas exigem sessão, workspace e `metrics.read`, com `no-store`:

- `GET /api/metrics/revenue/catalog`;
- `GET /api/metrics/revenue/summary`;
- `GET /api/metrics/revenue/series`;
- `GET /api/metrics/revenue/cohorts`;
- `GET /api/metrics/revenue/quality`;
- `GET /api/metrics/revenue/drilldown?metric=<id>`.

Drilldowns são paginados e informam entidade, timestamp, contribuição, unidade,
proveniência e link autorizado. Não há exportação nesta task.

`/metricas-receita` oferece resumo, ponte, série tabular acessível, retenção,
coortes, forecast, qualidade, catálogo e drilldowns por progressive disclosure.
Componentes não acessam Prisma.

## Persistência

Não foi criada migration, materialização ou backfill. CRM-39, CRM-49, CRM-54 e
CRM-56 já persistem os fatos exigidos; duplicá-los criaria duas fontes de
verdade. Materialização futura exigirá versão, fingerprint, corte e
reconciliação antes de substituir estas consultas.
