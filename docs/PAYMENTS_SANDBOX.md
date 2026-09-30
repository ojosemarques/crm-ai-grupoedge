# Pagamentos em sandbox local — CRM-50

## Recebimentos operacionais

A tela de pagamentos também registra recebimentos reais declarados pelo operador,
sem capturar ou transferir dinheiro. Esse fluxo usa `MANUAL_RECEIPT`, com conta
financeira, data, valor, forma, referência de comprovante, prévia e confirmação.
Ele atualiza a cobrança e o caixa uma única vez e fica disponível no Copilot.
Consulte [a operação integrada](EDGE_OS_OPERATIONS.md#financeiro-e-pós-venda).

O restante deste documento descreve exclusivamente o simulador local. Pagamentos
`LOCAL_PAYMENT_SANDBOX` são excluídos dos totais reais. Iniciar ou repetir uma
simulação pela aplicação é bloqueado em produção.

## Escopo e limites

O módulo demonstra o ciclo financeiro operacional sem processar dinheiro real.
Não existe egress, provider, credencial, captura de cartão, PIX, banco remoto,
ERP, contabilidade, emissão fiscal ou deploy. A chave de assinatura padrão é
conhecida e serve somente ao teste local; `NODE_ENV=production` desabilita o
sandbox.

## Fluxo

1. Um humano autorizado cria o rascunho de `Invoice` a partir de uma
   `Subscription` ativa. `InvoiceLine` congela o snapshot comercial.
2. A emissão explícita abre a cobrança. A tentativa cria `PaymentAttempt`,
   `OutboxEvent` e `Job` na mesma transação.
3. O worker usa o adaptador determinístico: `SUCCESS`, `DECLINED`, `TIMEOUT`,
   `PERMANENT_FAILURE`, `CHARGEBACK` ou `UNMATCHED`.
4. Sucesso do adaptador é apenas `PROVIDER_ACCEPTED`. Só o callback local
   assinado e reconciliado cria `Payment`.
5. Duplicidade é idempotente; nonce repetido é rejeitado; valor, moeda,
   referência ou ordem divergentes abrem `PaymentReconciliationIssue`.
6. Confirmação, reversão e chargeback atualizam a projeção da cobrança e criam
   `PaymentEvent` append-only. Nenhuma dessas ações cria `RevenueMovement`.

## Segurança e minimização

O callback aceita no máximo 128 KiB, somente em loopback, com rate limit local,
timestamp dentro de cinco minutos, HMAC timing-safe, `eventId` e nonce únicos.
A assinatura é validada antes de qualquer mutação. O banco guarda apenas o
contrato tipado do evento, hashes e metadados operacionais seguros; segredos e
dados de meio de pagamento não entram em log, auditoria ou banco.

## Operação e recuperação

`pnpm worker` processa jobs de pagamento antes das filas menos urgentes. Retry
usa backoff e o padrão é no máximo três tentativas. Falha terminal fica em
dead-letter e só pode ser reprocessada por `payments.reprocess`, com motivo e
auditoria. Divergência exige `payments.reconcile`; vincular cria novo job sem
reescrever o receipt original.

A tela `/pagamentos` lista também divergências sem cobrança correspondente para
quem possui `payments.reconcile`. O operador pode vincular e reprocessar ou
descartar com justificativa. Ambas as decisões são explícitas, passam pelo
serviço de domínio e preservam receipt, evento e auditoria.

`pnpm db:payments:backfill` executa dry-run. A opção `--execute` persiste apenas
o inventário de assinaturas já cobertas ou que exigem confirmação humana. O
comando nunca cria cobrança, tentativa, pagamento ou receita.

## Testes e demonstração

Os testes unitários validam contratos, centavos, assinatura e cenários do
sandbox. A integração cria o domínio completo em schema efêmero, valida
idempotência, imutabilidade, RBAC, retry/dead-letter, replay, chargeback,
reconciliação e ausência de novo movimento de receita. A UI está em
`/pagamentos`; quando não houver assinatura ativa, mostra estado vazio honesto.
