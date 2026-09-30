# Atividades e gates de venda consultiva

Este documento registra o contrato funcional e as evidências executáveis da
Etapa 05 do roadmap de paridade funcional com a Clint. O escopo continua sendo
o CRM comercial da Politizai. O perfil `MANDATO` acrescenta controles à venda
consultiva sem alterar a verdade financeira: oportunidade ganha, contrato,
fatura e pagamento permanecem fatos distintos.

## Contrato funcional

### Evidência consultiva

Uma oportunidade de produto com perfil `MANDATO` preserva evidências humanas
versionadas dos seguintes tipos:

- diagnóstico;
- comprador ou decisor econômico;
- patrocinador;
- caso de uso;
- critério de piloto;
- escopo da proposta;
- decisão.

Cada registro informa resumo, pessoa relacionada quando aplicável, fonte
opcional, autor e instante de confirmação. Uma nova versão substitui a versão
vigente sem apagar a anterior. O servidor revalida a versão da oportunidade,
o workspace, o RBAC e a idempotência antes de persistir.

O gate usa somente PACTO validado por pessoa. Sugestão de IA, formulário ou
rascunho não substitui uma revisão `VALIDATED` apta. A avaliação aceita é
registrada junto ao histórico da entrada na etapa, com snapshot das evidências
usadas naquele momento.

### Atividades de etapa

A definição versionada do pipeline contém tipo, título, script, prazo relativo,
obrigatoriedade e política de reentrada. Ao entrar em uma etapa, o servidor
cria uma tarefa para cada definição aplicável e a vincula simultaneamente à
definição e ao `StageHistory` daquela entrada.

As políticas são:

- `RECREATE_ON_REENTRY`: cada nova entrada cria uma instância e calcula o
  vencimento novamente a partir do instante da reentrada;
- `ONCE_PER_OPPORTUNITY`: depois da primeira instância, novas entradas não
  duplicam a atividade.

Ao sair da etapa, instâncias ainda abertas são encerradas como superadas. Uma
tarefa avulsa não possui vínculo com definição de etapa e conserva seu próprio
prazo. Atividades obrigatórias precisam ser concluídas antes do avanço.

### Avanço, fechamento e revisão

O avanço permanece uma ação humana no serviço de oportunidades. Para o perfil
`MANDATO`, o servidor combina os gates de evidência com as regras já existentes
de reunião realizada, proposta registrada, próxima ação, confirmação sensível,
motivo de perda, revisão otimista e permissão por origem/equipe.

Toda etapa aberta conserva um próximo compromisso com prazo futuro e
responsável. Perda e adiamento registram motivo. A revisão gerencial sinaliza,
sem mover o card:

- ausência ou vencimento excessivo da próxima ação;
- tempo excessivo na etapa;
- valor ou TCV incerto;
- comprador, decisor ou patrocinador incerto em Mandato.

Marcar uma oportunidade como ganha encerra o processo comercial e registra o
snapshot do resultado. Essa ação não cria pagamento, fatura, assinatura ou
confirmação de receita recebida.

## Matriz requisito → evidência

| Requisito da Etapa 05 | Estado | Evidência executável | Contrato persistido |
|---|---|---|---|
| Diagnóstico, comprador/patrocinador, caso de uso, piloto, proposta e decisão ligados ao avanço de Mandato | **Concluído** | Serviço de gates, painel da oportunidade e teste que bloqueia a proposta até completar o conjunto exigido | `OpportunityEvidence`, `OpportunityGateEvaluation` |
| Evidência humana versionada e revalidada no servidor | **Concluído** | Comando idempotente `SAVE_EVIDENCE` com revisão otimista e auditoria | versões vigentes e superadas de `OpportunityEvidence` |
| PACTO humano exigido no gate | **Concluído** | `assertConsultativeSalesGates` consulta apenas revisão `VALIDATED` e apta; integração comprova o bloqueio | snapshot de `pactoRevisionId` em `OpportunityGateEvaluation` |
| Atividades com tipo, script e prazo relativo | **Concluído** | instanciação de tarefas na entrada da etapa e fila `/atividades` | `PipelineTemplateActivityDefinition`, `Task`, `OpportunityStageActivityInstance` |
| Reentrada recalcula prazo conforme política | **Concluído** | integração comprova duas entradas, sequências distintas e novo vencimento | `reentryPolicy`, `entrySequence`, vínculo com `StageHistory` |
| Tarefas avulsas permanecem independentes | **Concluído** | integração preserva a tarefa avulsa; fila distingue origem `STAGE` de `STANDALONE` | ausência de instância para tarefa avulsa |
| Próximo compromisso e responsável | **Concluído** | gates de oportunidade aberta e tarefa atribuída ao dono | `nextActionTaskId`, `nextActionAt`, `assigneeMemberId` |
| Perda e adiamento exigem motivo | **Concluído** | perda reutiliza motivo configurado; `DEFER` exige motivo e revisão futura | `LossReason`, `OpportunityDeferral`, tarefa e auditoria |
| Revisão de estagnação, tempo, valor e decisor sem autoavanço | **Concluído** | integração preserva reconhecimento, resolve condição corrigida e mantém a etapa; varredura retorna `autoTransitions: 0` | `ProcessViolation` e trilha de reconhecimento/resolução |
| Ganho não equivale a pagamento | **Concluído** | integração compara a quantidade de `Payment` antes/depois do ganho | `Opportunity`, `Offer` e snapshot comercial separados de `Invoice`/`Payment` |

## Evidência de validação

- schema Prisma válido;
- TypeScript aprovado;
- ESLint aprovado;
- migration canônica `20260930070000_stage05_consultative_sales_gates`
  aplicada com a cadeia completa de 64 migrations em schema limpo;
- migration de produção Supabase
  `20260930080000_stage05_consultative_sales_gates` mantém o mesmo DDL e
  registra o checksum da migration canônica;
- 14 testes aprovados nos três arquivos direcionados:
  `consultative-sales-gates.integration.test.ts`,
  `pipeline-templates.integration.test.ts` e
  `opportunities-sales.integration.test.ts`.

## Cenários de aceite

1. **Gate de proposta.** Criar uma oportunidade Mandato com PACTO humano
   validado. Tentar registrar proposta sem todas as evidências requeridas,
   observar rejeição sem efeito parcial, registrar os artefatos e concluir o
   avanço.
2. **PACTO não humano.** Manter apenas sugestão ou rascunho de PACTO e comprovar
   que o gate continua bloqueado.
3. **Atividade na entrada.** Entrar em etapa com atividade configurada e
   conferir tipo, script, dono e vencimento relativo na tarefa e na fila.
4. **Reentrada.** Sair e voltar à etapa. A política
   `RECREATE_ON_REENTRY` cria nova instância com novo vencimento; a política
   `ONCE_PER_OPPORTUNITY` não duplica a tarefa.
5. **Tarefa avulsa.** Criar tarefa manual, trocar de etapa e comprovar que o
   prazo e a identidade da tarefa não foram recalculados.
6. **Atividade obrigatória.** Tentar avançar com atividade obrigatória aberta,
   receber bloqueio, concluir com resultado e avançar.
7. **Compromisso e desfecho.** Bloquear etapa aberta sem próxima ação e
   responsável; bloquear perda ou adiamento sem motivo.
8. **Revisão gerencial.** Gerar cards sem ação, com tempo excessivo, valor
   incerto e decisor incerto. A fila deve sinalizar cada causa sem alterar
   etapa ou status.
9. **Concorrência e replay.** Repetir evidência com a mesma chave e executar
   duas ações sobre a mesma revisão; deve haver um efeito e um conflito de
   versão controlado.
10. **RBAC e isolamento.** Vendedor acessa somente oportunidade autorizada;
    gestor revisa seu escopo; outro workspace não lê nem altera evidência,
    atividade ou revisão.
11. **Separação financeira.** Marcar oportunidade como ganha e confirmar que
    nenhum pagamento, fatura, contrato ou assinatura foi criado pelo evento.

## Fontes oficiais da Clint

As fontes abaixo já fazem parte do benchmark mantido neste repositório:

- [Como criar um modelo de etapas e atividades](https://ajuda.clint.digital/pt-BR/articles/10365143-como-criar-um-novo-modelo-de-etapas-e-atividades-na-central-de-modelos): tipo, script e prazo relativo à entrada na etapa.
- [Como funciona o módulo de atividades](https://ajuda.clint.digital/pt-BR/articles/11642894-como-funciona-o-modulo-de-atividades-da-clint): atividades da etapa, avulsas, vencidas e concluídas em uma fila operacional.
- [Como alterar a data e a hora das atividades](https://ajuda.clint.digital/pt-BR/articles/11704970-como-alterar-data-e-hora-das-atividades): prazo da atividade e comportamento após retorno à etapa.
- [Alerta visual de tempo nas etapas](https://ajuda.clint.digital/pt-BR/articles/15181526-como-configurar-alerta-visual-de-tempo-nas-etapas-de-negocios): atenção gerencial para cards parados.
- [Como funciona um negócio](https://ajuda.clint.digital/pt-BR/articles/9741298-como-funciona-um-negocio): etapa, responsável, valor, atividade e histórico no card.
- [Status de negócio](https://ajuda.clint.digital/pt-BR/articles/4891402-como-alterar-o-status-de-um-negocio) e [motivos de perda](https://ajuda.clint.digital/pt-BR/articles/5599489-como-configurar-os-seus-motivos-de-perda): fechamento comercial e motivo configurável.

Os requisitos de PACTO humano, mapa de stakeholders, caso de uso, piloto e
separação entre ganho e pagamento são adaptações do processo consultivo da
Politizai. Eles complementam o comportamento público da Clint e não são
apresentados como funções proprietárias equivalentes da plataforma externa.
