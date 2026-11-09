# 05 · Apurar as duas coortes e o variável mensal

## Dependências

Aceite da etapa 04 ou pendência factual isolada e bloqueada.

## Escopo e integração

Usar fatos ADVERTISING de `realtime-dashboard-facts.ts` e vínculo estável de `unique-meeting-booking-facts.ts`. Integrar rotina de períodos e fechamento ao worker após validar execução.

## Contratos e permissões

Meta agenda 40%, presença 50%, faixa pelo menor atingimento exato. Configurar valores de comissão nas faixas 100/80/60% a partir do plano privado e aplicar zero abaixo de 60%. Bônus próprio a partir de 100%. Evidências e remuneração só em superfícies autorizadas.

## Cenários e aceite

- [ ] Testar duplicatas, mudanças de dono, remarcação entre períodos, no-show, ausência de base, pendência que altera faixa e fatos tardios. Auditorias diária/semanal/mensal compartilham regras e chaves idempotentes.
- [ ] Em cenário sintético com 200 leads, 100 agendados e 100 realizadas em 100 reuniões elegíveis, os atingimentos são 125% e 200%. A faixa usa 125% e a barra exibe 100%. Para 100 leads, 40 agendados e 16 realizadas em 40 elegíveis, o atingimento final é exatamente 80%.
- [ ] Confirmar que a rota pública de tempo real e sua API não incluem remuneração nem evidência financeira.

## Migração, reversão e verificação em produção

Adicionar agenda somente após validar worker e cobertura. Preservar snapshots fechados e corrigir por ajuste rastreável.

## Progresso local

O cálculo de domínio compara as duas metas com razões exatas, limita somente a barra visual e distingue falta de base, evidência ausente e reunião pendente que pode mudar a faixa. A projeção separa a primeira chegada válida de cada lead, o primeiro agendamento creditado até o corte e a ocorrência efetiva de cada cadeia de remarcação. Quatro testes unitários passaram.

A entrada vem da classificação de Anúncios usada pelo Tempo Real e usa o responsável gravado no evento ou uma atribuição histórica válida até a chegada. Backfill que usa o dono atual fica sem evidência até existir atribuição histórica. Para presença, o crédito vem do responsável pelo agendamento e o resultado vem da revisão efetiva do histórico da reunião. O corte de gravação é separado do corte de ocorrência para correções tardias.

O worker existente grava revisões privadas para dia, semana de segunda a domingo e mês. A rotina acompanha o período atual e reprocessa o anterior quando recebe fatos tardios. Para plano SDR configurado e competência fechada, gera comissão e bônus em títulos próprios, com calendário da política. Mudança posterior de faixa preserva a revisão anterior e encaminha o título afetado para revisão. As superfícies privadas de consulta e reprocessamento de competências anteriores à janela do worker permanecem pendentes. A ativação depende dos valores e da cobertura reais, sem fallback para as taxas legadas.

A cadeia de 129 migrations e 25 testes de integração passaram em PostgreSQL descartável. Os cenários cobriram atribuição histórica após troca do dono atual, exclusão de Prospecção Ativa, estorno da chegada, remarcação entre meses, reunião de lead do mês anterior, idempotência do worker, títulos separados e revisão tardia. O payload público de Anúncios permaneceu sem campos de remuneração ou evidência privada.
