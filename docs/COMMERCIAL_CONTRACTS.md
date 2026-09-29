# Contratos comerciais — CRM-48

## Limite do domínio

`Opportunity` e `Offer` continuam fontes oficiais da negociação e da proposta.
`CommercialContract` nasce por ação humana a partir dessas fontes e guarda um
snapshot: não reinterpreta nem reescreve oportunidade ou oferta. Ganho, contrato
emitido, aceite e vigência são fatos distintos.

Não há assinatura eletrônica, provider, egress, OAuth, credencial, banco remoto
ou validade jurídica presumida. O aceite é manual e local, exige permissão e
grava nome, papel, evidência, hash, ator e horário.

## Identidade e versões

- `contractNumber` é sequencial por workspace (`CTR-AAAA-000001`) e reservado
  sob advisory lock transacional.
- Uma oportunidade origina no máximo um contrato no workspace.
- A versão 1 copia conta, contato, oferta, produto, valores, condições e
  cláusulas do template vigente.
- Linhas e cláusulas são append-only. Versão emitida fica imutável; somente pode
  passar de `ISSUED` para `SUPERSEDED` sem alterar conteúdo.
- Renegociação cria uma nova versão `DRAFT` sequencial.
- A emissão cria HTML determinístico para impressão e SHA-256 dos snapshots.

## Estados

```text
DRAFT -> INTERNAL_REVIEW -> READY_TO_SEND
READY_TO_SEND + versão ISSUED -> SENT_SIMULATED
SENT_SIMULATED -> ACCEPTED | REJECTED
estado autorizado -> VOIDED
vigência encerrada -> EXPIRED
versão emitida -> SUPERSEDED + nova versão DRAFT
```

Transições são validadas no servidor, com revisão otimista e idempotência. Cada
mudança cria `ContractEvent`, `AuditLog` e atividade comercial.

## Templates e backfill

O seed cria template local versionado, com cláusulas demonstrativas e estado
`PENDING_LEGAL`. Variáveis são allowlisted e valores entram no HTML escapados.

```bash
pnpm db:contracts:backfill
pnpm db:contracts:backfill -- --execute --run-key=crm48:execute:manual-001
```

O backfill nunca cria contrato: marca `REVIEW_REQUIRED` quando há conta, contato
e oferta, ou `SKIPPED` quando falta fundação canônica. A mesma `runKey` é
idempotente.

## Métricas e futuro

A tela calcula no banco e no escopo autorizado rascunhos, aguardando aceite,
aceitos, vencimentos em 30 dias, divergências, taxa de aceite e média de versões.
Taxa sem decididos retorna `null`, não 0% falso. Antes de uso real são necessárias
revisão jurídica, alçadas, assinatura eletrônica, retenção e homologação de
provider — tudo fora da CRM-48.
