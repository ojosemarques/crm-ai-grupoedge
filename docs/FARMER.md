# Farmer, renovação, expansão e churn — CRM-54

## Limite do módulo

O módulo `farmer` organiza a atuação pós-venda sobre contas com assinatura e
carteira explícitas. Ele registra renovações, sinais de expansão, contrações e
churn confirmados por pessoas autorizadas. Não prevê comportamento, não infere
churn por inatividade ou satisfação, não reconhece receita contábil e não chama
provider externo.

## Fonte única da verdade

- `Renewal` guarda o estado corrente, snapshot financeiro, responsável, risco,
  data-alvo e próxima ação;
- `RenewalEvent` é a timeline append-only de criação, risco, próxima ação e
  decisão;
- `ExpansionSignal` separa evidência de oportunidade: nasce em revisão e só cria
  `Opportunity` após confirmação humana;
- `FarmerRevenueDecision` registra contração ou churn com valor anterior, novo
  valor, motivo, evidência e data efetiva;
- `RevenueMovement` continua sendo o ledger financeiro append-only. Renovação
  registra movimento de delta zero; contração e churn registram deltas negativos;
  correção cria `REVERSAL`, nunca altera ou exclui o movimento original;
- `ChurnEvent` distingue `logoChurn` de `revenueChurn` e é append-only;
- `FarmerReasonCodeVersion` preserva a versão dos motivos usados;
- runs e itens do backfill explicam candidato, criação, revisão ou descarte.

Valores monetários ficam em centavos e datas em `timestamptz`; a interface usa
`America/Sao_Paulo`. Ausência de dado permanece ausente e nunca vira risco,
renovação ou churn.

## Estados e decisões

```text
IN_REVIEW ── renovar ───────────────> RENEWED
     │
     ├──── não renovar ─────────────> NOT_RENEWED
     ├──── adiar + próxima ação ────> DEFERRED ── decisão ──> terminal
     └──── cancelar ────────────────> CANCELLED

RENEWED / NOT_RENEWED / CANCELLED ── reabrir com motivo ──> IN_REVIEW

Sinal de expansão ── revisão humana ──> REJECTED
                                  └──> LINKED → Opportunity + Task + StageHistory
```

Decisões terminais exigem código e comentário. Renovação aberta ou adiada exige
próxima ação. Risco diferente de `NONE` exige código e evidência. Revisão
otimista, chave idempotente e advisory lock protegem concorrência; evento e
`AuditLog` são gravados na mesma transação.

## Priorização, filtros e métricas

A fila usa ordem determinística:

1. próxima ação ausente ou vencida;
2. decisão de receita que requer revisão;
3. risco alto/crítico, priorizando maior MRR;
4. sinal de expansão pendente;
5. demais ações programadas e decisões registradas.

Os filtros cobrem owner, equipe, status, risco, janela, ação e MRR mínimo. O
drilldown reutiliza os mesmos filtros server-side e o escopo RBAC. Indicadores:

- renovações com data-alvo em 30, 60 e 90 dias;
- MRR em revisão;
- renovadas, não renovadas e adiadas;
- taxa de renovação = renovadas / decisões terminais; sem denominador retorna
  `null`, e adiadas não entram no denominador;
- renovações sem próxima ação;
- sinais de expansão pendentes.

As métricas completas de retenção, GRR e NRR continuam reservadas para a camada
única da CRM-57. A CRM-54 fornece fatos e drilldowns, sem antecipar forecast.

## RBAC e isolamento

Permissões server-side:

- `farmer.read`;
- `farmer.renewals.write`;
- `farmer.renewals.confirm`;
- `farmer.expansion.write`;
- `farmer.expansion.confirm`;
- `farmer.revenue.confirm`;
- `farmer.correct`;
- `farmer.config.manage`.

Administrador atua no workspace; gestor possui escopo de equipe; closer atua em
registros próprios; visualizador somente lê. Cada relação crítica inclui
`workspaceId`, e alterar URL ou payload não amplia o universo autorizado.

## Backfill conservador

O comando recusa produção, host remoto, banco diferente de `politizai_crm` e
schema diferente de `public`:

```bash
pnpm db:farmer:backfill -- --run-key=crm54:dry-run:manual
pnpm db:farmer:backfill -- --execute --run-key=crm54:execute:manual
```

O padrão é `DRY_RUN`. Assinatura ativa com data final pode virar apenas
candidata. Em `EXECUTE`, a renovação só nasce em `IN_REVIEW` quando existe
responsável humano; sem data ou owner, o item fica `REVIEW_REQUIRED`. O processo
nunca cria decisão, risco, expansão, contração ou churn. Repetir `runKey`
devolve replay sem efeitos novos.

## Superfície local

`/farmer` carrega dados autorizados em Server Component e usa APIs same-origin
para mutações. A tela mostra KPIs, filtros, fila priorizada, risco, renovação,
não renovação, contração, churn, sinais de expansão e detalhe com timeline,
evidências e ledger. Estados de loading, vazio, erro e acesso negado reutilizam
os padrões globais.

## Limitações deliberadas

- não há provider, telemetria de produto, ERP, contabilidade ou emissão fiscal;
- sinal de expansão não é venda nem receita e permanece estimativa até o fluxo
  comercial confirmar ganho;
- satisfação, ausência de atividade e fim de contrato não provam churn;
- decisões futuras permanecem no ledger pela data efetiva; execução agendada de
  mudanças futuras pertence à infraestrutura já existente de receita;
- operação com dados reais depende dos gates posteriores de segurança,
  privacidade, homologação e deploy.
