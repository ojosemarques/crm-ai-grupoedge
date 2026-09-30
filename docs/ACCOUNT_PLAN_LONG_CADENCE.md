# Cadência longa e plano de conta

Este documento registra o contrato funcional e a evidência executável da
Etapa 06 do roadmap. A cadência de tentativa de contato e o programa
consultivo continuam sendo mecanismos diferentes: `CadenceStep` conserva a
sequência D0, D1, D3, D7, D14, D21 e D30 para “não atendeu”; o plano de conta
acompanha uma decisão de compra institucional durante meses, dentro de uma
única oportunidade.

## Contrato funcional

### Uma oportunidade, vários episódios

Cada oportunidade possui no máximo um `OpportunityAccountPlan`. O plano pode
registrar episódios de descoberta, solução, piloto, espera do cliente,
contratação e nutrição institucional sem criar novos cards ou etapas
artificiais no pipeline.

As trilhas de stakeholder, entrega da Politizai, impedimento e decisão correm
em paralelo. Cada atualização registra marco, artefato, responsável e prazo.
O estado atual fica em `OpportunityPlanTrack`; o histórico imutável fica em
`OpportunityPlanTrackRevision`. Itens sem responsável são permitidos como
exceção operacional visível na fila, para que o problema seja atribuído em vez
de ficar oculto.

Propostas comerciais continuam no agregado canônico `Offer`. Uma revisão cria
outro registro de proposta na mesma oportunidade e atualiza o artefato da
trilha de entrega. Assim, Proposta v1 e Proposta v2 preservam valores e
histórico sem duplicar a oportunidade.

### Stakeholders e troca de gabinete

O plano mantém vínculos datados de stakeholders. Ao trocar o chefe de
gabinete, o registro anterior passa a `REPLACED`, recebe `endedAt` e aponta
para o sucessor. O novo stakeholder passa a `ACTIVE`. A oportunidade, o plano,
as propostas e os demais compromissos mantêm a mesma identidade.

### Espera planejada e retorno

Uma espera pactuada exige motivo, data de revisão e responsável. Ela cria uma
tarefa humana de retorno e permanece `PLANNED` até resposta, conclusão ou
cancelamento. Enquanto a data de revisão está no futuro, as revisões de
processo não classificam o card como estagnado ou excessivamente antigo. Ao
chegar a data, a tarefa aparece vencida em **Meu dia** e a exceção deixa de
suprimir a revisão de estagnação.

Registrar uma resposta encerra a espera e o episódio `CUSTOMER_WAIT`, cancela
as tarefas incompatíveis e cria exatamente uma tarefa humana para tratar a
resposta. O comando usa chave idempotente e revisão otimista, evitando retorno
ou tarefa duplicada.

### Desfechos e privacidade

| Evento | Efeito no plano |
|---|---|
| Resposta | Retoma a espera, cancela episódio de espera e cria um compromisso humano de tratamento. |
| Ganho | Cancela episódios, trilhas, esperas e tarefas abertas incompatíveis. |
| Perda | Cancela episódios, trilhas, esperas e tarefas abertas incompatíveis. |
| Opt-out | Registra `DO_NOT_CONTACT`, bloqueia os pontos de contato, cancela saídas pendentes e encerra compromissos incompatíveis. |

Mensagens recebidas pelo inbox e pelos adaptadores de WhatsApp também chamam
o mesmo cancelamento transacional. Os comandos do plano criam tarefas,
histórico e auditoria; eles não enviam mensagem externa. O teste de aceite
compara a contagem de `Message` antes e depois da simulação.

### Meu dia e acesso

A oportunidade exibe o plano junto ao card. **Meu dia** reúne tarefas abertas
de episódios, trilhas e esperas, ordenadas por vencimento, e oferece recortes
de vencidos e sem dono. A API aplica workspace, RBAC, escopo próprio/equipe e
regras de leitura por origem antes de devolver os compromissos.

## Matriz requisito → evidência

| Requisito da Etapa 06 | Estado | Evidência executável | Contrato persistido |
|---|---|---|---|
| Separar D0–D30 do programa consultivo | **Concluído** | O teste conserva `CadenceStep` e cria o plano por outro serviço, sem vincular episódios à automação de “não atendeu” | `CadenceStep` e `OpportunityAccountPlan` |
| Episódios de descoberta, solução, piloto, espera, contratação e nutrição | **Concluído** | API e painel aceitam os seis tipos dentro da oportunidade | `OpportunityPlanEpisode` |
| Trilhas paralelas com marco, artefato, dono e prazo | **Concluído** | Comandos `UPSERT_TRACK`, painel e fila operacional | `OpportunityPlanTrack`, `Task` |
| Proposta revisada sem novo card | **Concluído** | Integração cria duas `Offer`, duas revisões do artefato e confirma uma única oportunidade | `Offer`, `OpportunityPlanTrackRevision` |
| Troca de chefe de gabinete com histórico | **Concluído** | Integração preserva Ana como `REPLACED` e Bruno como `ACTIVE` no mesmo plano | `OpportunityPlanStakeholder` |
| Espera planejada distinta de estagnação | **Concluído** | Varredura não cria violações enquanto a revisão está no futuro | `OpportunityPlannedWait`, `ProcessViolation` |
| Retorno na data pactuada | **Concluído** | Relógio avança 31 dias; Meu dia mostra o retorno vencido e a resposta gera uma tarefa humana | espera e `Task` vinculada |
| Resposta, ganho, perda e opt-out encerram ações incompatíveis | **Concluído** | Integração executa resposta/opt-out e a função transacional canônica para ganho/perda; inspeção confirma que a transição `WON`/`LOST` chama essa mesma função | episódios, trilhas, esperas e tarefas |
| Opt-out efetivo | **Concluído** | Integração confirma `Lead.contactPreference = DO_NOT_CONTACT`; serviço atualiza pontos e cancela saída pendente | `Lead`, `ContactPoint` e fatos de privacidade |
| Replay não duplica efeito | **Concluído** | Repetição da espera com a mesma chave devolve o resultado anterior | `OpportunityAccountPlanCommand` append-only |
| Nenhum envio externo automático | **Concluído** | A contagem de `Message` permanece igual durante toda a venda simulada | nenhuma mensagem criada pelo plano |
| Meu dia mostra vencidos e sem dono | **Concluído** | Integração encontra retorno vencido e trilha sem responsável; UI oferece os dois filtros | tarefas dos compromissos |
| RBAC, origem e isolamento de workspace | **Concluído** | Leitura/escrita reutilizam autorização de oportunidade; fila restringe escopo e origem | filtros por `workspaceId`, owner, equipe e origem |

## Cenário de aceite executado

1. Criar uma oportunidade institucional e iniciar descoberta e quatro trilhas.
2. Registrar Ana como chefe de gabinete e substituí-la por Bruno, preservando
   os dois registros datados.
3. Registrar Proposta v1 e Proposta v2 como ofertas e como versões do artefato
   de entrega, mantendo o mesmo `opportunityId`.
4. Abrir episódio de espera e espera pactuada com retorno em 30 dias; repetir o
   comando e confirmar que só existe um efeito.
5. Tornar a próxima ação antiga, executar a revisão e confirmar ausência de
   falso positivo enquanto a espera ainda está vigente.
6. Avançar o relógio em 31 dias e confirmar o retorno vencido em Meu dia.
7. Registrar resposta, encerrar espera e criar uma única tarefa humana.
8. Exercitar opt-out e confirmar bloqueio de contato e cancelamento.
9. Exercitar a função transacional usada por ganho e perda, confirmar o
   cancelamento e reinspecionar sua chamada na transição `WON`/`LOST`.
10. Comparar a contagem de oportunidades e mensagens: permanece um card e
    nenhuma mensagem é criada pelo plano.

## Evidência de validação

- schema Prisma válido;
- TypeScript aprovado;
- migration canônica `20260930110000_stage06_account_plan` aplicada junto à
  cadeia completa de 65 migrations em schema limpo;
- migration Supabase `20260930120000_stage06_account_plan` replica o DDL e
  registra o checksum da migration canônica;
- teste dirigido `account-plan.integration.test.ts`: 1 teste aprovado;
- `git diff --check` aprovado.

## Fontes oficiais da Clint e adaptação Politizai

- [Módulo de Atividades](https://ajuda.clint.digital/pt-BR/articles/11642894-como-funciona-o-modulo-de-atividades-da-clint): fila central, prazos, vencidos, dono e atividades personalizadas.
- [Data e hora das atividades](https://ajuda.clint.digital/pt-BR/articles/11704970-como-alterar-data-e-hora-das-atividades): cálculo de prazo e comportamento de retorno à etapa.
- [Gatilho de tempo na etapa](https://ajuda.clint.digital/pt-BR/articles/15345388-como-usar-gatilho-de-tempo-na-etapa): monitoramento do tempo de permanência do negócio.
- [Múltiplos negócios para um contato](https://ajuda.clint.digital/pt-BR/articles/11334931-por-que-um-contato-pode-ter-mais-de-um-negocio-em-andamento-na-clint): causas de criação de cards adicionais e uso do histórico para identificar a origem.

Plano de conta, episódios consultivos, trilhas, troca datada de chefe de
gabinete e espera pactuada são adaptações do processo da Politizai. O documento
não atribui essas estruturas específicas à Clint.
