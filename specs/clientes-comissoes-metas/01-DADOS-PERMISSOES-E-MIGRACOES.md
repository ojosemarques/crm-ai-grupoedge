# 01 · Persistir as evidências e obrigações com isolamento

## Dependências

Aceite da etapa 00 ou pendência factual isolada e bloqueada.

## Escopo e integração

Evoluir `prisma/schema.prisma` e migrations aditivas, com vínculos para Opportunity, Invoice, Payment, PaymentEvent, fatos comerciais e vendedor. Criar vigência, configuração de rampa, confirmação, alocação, apuração, obrigação e revisão auditável conforme lacunas confirmadas.

## Contratos e permissões

Valores em centavos e taxas em pontos-base. Chaves únicas por workspace e obrigação. Verificar workspace, vínculo e capacidade no servidor. Separar leitura, confirmação, recebimento, aprovação e baixa.

A primeira migração adiciona `CommercialSaleConfirmation` como histórico de revisões. Registra aceite e ativação efetivos, confirmação pelo operador, modalidade, valor contratual após desconto, entrada negociada e evidência de origem. A entrada negociada não comprova liquidação. As referências de oportunidade, vendedor e ator incluem o workspace na chave estrangeira. O runtime do schema privado pode ler e inserir revisões, com correções por nova linha. API e autorização de confirmação dependem da integração da etapa 02.

A segunda migração mantém o bruto em `Payment.amountCents`, acrescenta o líquido confirmado e a parte líquida comprovada como entrada, ambos nulos em registros sem evidência. O plano OTE aceita mês de rampa com evidência obrigatória. `CommercialCompensationPolicy` registra vigência por data civil e versão única por workspace, com o ator de registro. A migração não cria políticas nem altera a regra vigente.

A terceira migração cria obrigações com chave estável por workspace, vínculo com a política, competência, critérios de origem, marco e vencimento. Uma obrigação de venda exige oportunidade. Bônus e remuneração por coorte mensal podem existir sem oportunidade. As alocações apontam à despesa canônica por chave composta e podem repartir uma despesa histórica entre títulos, com evidência para cada parte. O serviço deve validar a soma contra o título e a despesa na mesma transação. Revisões pós-baixa têm chave por obrigação e evento para preservar a baixa original. A migração mantém regras e comissões atuais até a ativação controlada.

O fluxo atual usa `SALES_COMPLETE` para fechamento, `CONTRACTS_ACCEPT_RECORD` para aceite e `ACCOUNTS_READ` para leitura de contas. A delegação interna do fechamento não autoriza confirmação da equipe nem baixa. O serviço de Clientes deve validar o recurso real com o serviço de autorização, e o recebimento deve passar pelas permissões do serviço de pagamentos. `FINANCE_COMMISSIONS` agrupa operações de comissão hoje. O contrato novo precisa distinguir aprovação de baixa no servidor antes de expor os comandos. Em Meu OTE, o vendedor vem do contexto autenticado, sem filtro de identidade fornecido pelo cliente.

## Cenários e aceite

- [ ] Banco vazio e banco representativo migram. App antigo funciona no schema aditivo. IDs de outro workspace e operações sem capacidade são recusados.

## Migração, reversão e verificação em produção

Aplicar schema antes do app e app antes dos jobs. Reverter pela desativação do writer e rollback do app, preservando dados e auditoria.

## Evidência local e pendências

A cadeia Prisma passou com 122 migrations em PostgreSQL 17.10 descartável e no ensaio do schema privado com roles sintéticas. Prisma validate, geração do client, typecheck e ESLint do teste passaram. A suíte integrada direcionada teve 37 aprovações e cinco falhas. Houve divergência de saldos no teste de caixa/DRE, três timeouts de teste de venda e uma transação de intake expirada. A limpeza do schema do primeiro container também excedeu o limite de locks do PostgreSQL. O resultado não atende o gate desta etapa.

O teste específico de revisões, idempotência, valores e referências ao workspace passou com código de saída zero ao repetir em container dedicado com `max_locks_per_transaction=512`. A repetição inclui a limpeza do schema efêmero.

Com as três migrations aditivas, a cadeia de 124 migrations passou no schema privado descartável. Após reaplicar os grants de runtime, foram conferidas as cinco tabelas novas para as roles do Supabase e do CRM. O typecheck e o ESLint direcionado passaram. Financeiro passou com 5 testes em schema separado após o ajuste da asserção para medir o efeito sobre caixa e DRE a partir do saldo inicial do cenário. Pagamentos passou com 13 testes e OTE com 7. A execução isolada dos três novos testes de confirmação, vigência e obrigações passou após corrigir uma fixture que exercitava a chave primária antes da FK.

No ensaio de upgrade, o código do HEAD gerou dois recebimentos manuais sintéticos antes de aplicar as três migrations novas. O total bruto de 9.900 centavos e os dois registros foram preservados. Os campos líquidos ficaram nulos e nenhuma política ou obrigação foi ativada. O isolamento das rotas, ações e perfis depende dos testes das etapas consumidoras.
