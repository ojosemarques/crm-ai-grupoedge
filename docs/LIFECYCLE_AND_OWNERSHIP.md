# Lifecycle de receita e responsabilidade funcional

## Conceitos separados

`RevenueLifecycle` responde onde o Contact ou a Account está na relação de
receita. Ele não substitui `Lead.status`, `PipelineStage`,
`Opportunity.status` nem `Account.status`: esses campos continuam respondendo
respectivamente pela operação de pré-vendas, funil, negociação e cadastro.

O ciclo canônico é `UNKNOWN`, `PROSPECT`, `LEAD`, `QUALIFIED`, `OPPORTUNITY`,
`CUSTOMER`, `ONBOARDING`, `ACTIVE`, `RENEWAL`, `CHURN` e `INACTIVE`. A projeção
corrente guarda versão, origem, qualidade da evidência e revisão.
`LifecycleHistory` guarda cada intervalo e é append-only por trigger: somente o
fechamento único de `exitedAt` é permitido.

## Regras e responsabilidade obrigatória

As transições da regra `revenue-lifecycle-v1` são persistidas em
`LifecycleRuleVersion`. Avanços para `ACTIVE`, `RENEWAL` e `CHURN` nunca são
inferidos por backfill. Correção fora da matriz exige `lifecycle.override` e
confirmação explícita.

| Estágio | Função obrigatória |
|---|---|
| Lead, Qualificado | SDR |
| Oportunidade, Cliente | Closer |
| Onboarding, Ativo | Customer Success |
| Renovação | Farmer |

`OwnershipAssignment` aceita exatamente um destino: `WorkspaceMember` ou
`Queue`. Há no máximo uma atribuição ativa por agregado e função. Os agregados
suportados são Contact, Account, Lead e Opportunity; as funções são Marketing,
SDR, Closer, Customer Success, Farmer, Financeiro e RevOps. A atribuição
operacional existente (`LeadAssignment`) continua sendo a fonte do roteamento
do Lead; o novo registro é uma projeção funcional temporal criada na mesma
transação.

## Transferência

`OwnershipTransfer` separa pedido e aceite. O owner atual permanece vigente até
o destino aceitar; rejeitar ou cancelar não troca responsabilidade. Aceite cria
uma nova atribuição e encerra a anterior na mesma transação serializável. Pedido,
aceite, rejeição, cancelamento e conclusão geram auditoria.

## Dual write e idempotência

- entrada e redistribuição de Lead projetam ownership SDR do Lead e Contact;
- criação de Opportunity projeta ownership Closer da Opportunity/Contact e
  avança o Contact para `OPPORTUNITY` com evidência explícita;
- locks consultivos por workspace/agregado/função e chaves de idempotência
  impedem duplicidade concorrente;
- `CustomerHandoff`, `LeadAssignment`, etapas e status legados não são
  reescritos.

## Backfill local

Use primeiro:

```bash
pnpm db:lifecycle:backfill -- --mode=dry-run
pnpm db:lifecycle:backfill -- --mode=execute
```

O executor recusa produção, host remoto, banco diferente de `politizai_crm` e
schema diferente de `public`. A inferência é conservadora: Lead persistido vira
`LEAD`; qualificação concluída vira `QUALIFIED`; oportunidade aberta vira
`OPPORTUNITY`; Account sem evidência fica `UNKNOWN`. Nenhum ganho vira
automaticamente ativação, renovação ou churn. Runs e itens permitem medir
cobertura e repetir a execução sem duplicar fatos.

## Rollback operacional

A leitura nova pode ser desligada sem alterar os fluxos legados. A migration é
aditiva; rollback destrutivo das tabelas não é autorizado. Para recuperar o
estado anterior, restaure o backup do `public` conforme
`docs/LOCAL_DATABASE_BACKUP.md` em ambiente isolado e investigue antes de
qualquer ação no banco operacional.
