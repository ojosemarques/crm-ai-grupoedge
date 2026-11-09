# 03 · Registrar recebimentos reais pelo caminho canônico

## Dependências

Aceite da etapa 02 ou pendência factual isolada e bloqueada.

## Escopo e integração

Integrar detalhe de Clientes com Invoice, InvoiceLine, Payment, PaymentEvent, `payment-service.ts` e `payment-worker-service.ts`. Permitir entrada e parcelas desiguais com datas próprias.

## Contratos e permissões

Validar total contratado, saldo, bruto e líquido, data efetiva, referência e alocação de entrada. Não recebido conserva saldo e motivo opcional. Preservar faturas emitidas e pagas, com revisão controlada de saldo futuro e estorno auditado.

O detalhe de Clientes já lista `Invoice` por contrato e direciona ao recebimento canônico de `/pagamentos/[invoiceId]` sob `PAYMENTS_READ`. O próximo comando deve preservar `PAYMENTS_MANAGE` e `FINANCE_MANAGE`, a chave de idempotência do recebimento e o lock de fatura compartilhado com o worker. `InvoiceLine` e `PaymentEvent` são append-only. A restrição de competência da fatura vale inclusive para faturas anuladas, portanto anular e chamar `createInvoice` para o mesmo período não cria uma revisão. Alterações de valor exigem revisão canônica rastreável do saldo futuro. Alterações de vencimento devem manter a identidade da cobrança e registrar o valor anterior, a revisão e o motivo. Uma cobrança com baixa conserva o pagamento e sua trilha.

## Cenários e aceite

- [ ] Teste concorrência e replay, parcial, parcela desigual, alteração futura e estorno. Uma baixa aparece no recebível, evento e Financeiro.

## Migração, reversão e verificação em produção

Rollback desativa operações novas. Preservar pagamentos canônicos. Em produção, conferir vínculos reais sem criar cobranças fictícias.

## Progresso local

O comando canônico de recebimento aceita líquido comprovado e parte líquida identificada como entrada. A prévia e o evento preservam esses valores. O bruto baixa o saldo da cobrança e o líquido alimenta caixa e métricas quando informado. O histórico sem líquido conserva a visualização anterior no caixa. Esse fallback não comprova liquidação líquida para comissão. Alocações acima do item de entrada ou acima do líquido são recusadas. Reenvio com valores diferentes produz conflito de idempotência.

As ações de cobrança permitem registrar não recebido e reagendar vencimento futuro com motivo. Ambas preservam o identificador, o saldo e a competência e deixam evento e auditoria. Cobranças com baixa real anterior exigem revisão financeira. Uma tentativa em andamento impede o reagendamento.

A redistribuição seleciona duas ou mais parcelas futuras sem baixa e conserva a soma em centavos. O servidor confere se o cronograma canônico já corresponde ao contrato vigente, valida a revisão de todas as parcelas selecionadas, preserva a entrada discriminada e aplica as alterações juntas. Cada mudança registra valor e data anteriores e novos, com chave de replay compartilhada. As linhas originais da fatura e a competência permanecem no histórico.

A correção antes da confirmação exige motivo, condições revisadas e evidência de aceite. A diferença entre os valores das cobranças selecionadas deve corresponder exatamente à diferença contratual. A operação emite nova versão, preserva o documento anterior, atualiza oportunidade e assinatura, registra a variação de MRR no ledger e revisa as cobranças na mesma transação. A primeira confirmação usa o total e a entrada vigentes. Venda já confirmada ou com comissão registrada e cobrança com baixa ou tentativa ativa exige revisão financeira. Para corrigir a entrada, selecione a cobrança que a contém ou a primeira cobrança quando a entrada anterior for zero. Entrada alocada em mais de uma cobrança exige revisão financeira.

Em Clientes, a ação Conferir parcela abre o mesmo formulário de recebimento e as ações de cobrança, limitados a uma fatura vinculada à venda e autorizada para a sessão. Data e hora do recebimento são interpretadas no fuso do workspace. As integrações passaram em schemas isolados com 14 testes de pagamentos, cinco de Financeiro e três de métricas. A cadeia de 125 migrations foi aplicada no banco descartável.

O build local e dois cenários Chromium passaram. O cenário de Clientes abriu o formulário pelo detalhe da venda. O de cobrança reagendou, registrou não recebido e conciliou 100 centavos brutos com 97 no caixa. O servidor local repetiu o aviso de stream encerrado durante o cenário de Clientes, com as asserções aprovadas. TypeScript, ESLint direcionado e 11 testes unitários passaram.

A cadeia de 126 migrations passou em PostgreSQL descartável. A primeira execução ampla em Docker teve 17 falhas de timeout e a execução E2E em Docker parou no seed por transação expirada. Em PostgreSQL nativo descartável, a integração focada e depois a suíte completa de fechamento passaram com 21 testes. O cenário cobre soma inválida, acesso sem autorização, cobrança fora da venda, concorrência com replay, revisão vencida, data nova, trilha e preservação das linhas. O build e o Chromium também passaram na instância nativa. O navegador confirmou a redistribuição de duas parcelas de R$ 1.000 em R$ 1.100 e R$ 900 no detalhe de Clientes. O servidor local repetiu o aviso de stream encerrado sem falhar o teste.

Com a revisão contratual, a suíte completa passou com 22 testes. O teste novo corrige uma cobrança com vencimento no próprio dia, verifica versão antiga intacta, novo contrato, assinatura, saldo, MRR e confirmação pelo novo total. O build e a repetição Chromium em schema novo passaram. O navegador aplicou um desconto de R$ 20, conferiu a nova condição, confirmou a venda e redistribuiu outras parcelas mantendo o novo total. A primeira execução do cenário foi interrompida por um seletor de teste, corrigido para usar o papel e nome acessível do campo.

Com a revisão da entrada, as 127 migrations foram aplicadas em PostgreSQL descartável. As suítes de fechamento e pagamentos passaram com 22 e 14 testes. O cenário de integração confirma a entrada revisada, rejeita alocação líquida um centavo acima do limite vigente e aceita o limite exato. O build e o cenário Chromium de administrador passaram com revisão simultânea do total e da entrada, confirmação comercial e redistribuição. O servidor local repetiu o aviso de stream encerrado durante o teste. A conciliação histórica e a homologação em produção seguem pendentes.
