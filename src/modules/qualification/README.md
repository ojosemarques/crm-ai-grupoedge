# qualification

O módulo implementa a qualificação humana PACTO e o scoring explicável sem
misturar formulário, decisão humana ou sugestão de IA no estado vigente.

- `domain/pacto-contracts.ts`: dimensões, rótulos, orientações e contratos
  serializáveis usados pela apresentação;
- `application/pacto-qualification-service.ts`: leitura, rascunho, validação e
  registro separado de sinais automáticos;
- `domain/score-calculator.ts`: fórmula determinística e pura por versão;
- `application/lead-scoring-service.ts`: score provisório, score validado,
  recálculo, override, sugestão não vigente, RBAC e auditoria;
- `PactoAssessment`: estado atual consultável de cada dimensão;
- `PactoRevision` e `PactoRevisionDimension`: snapshots append-only de cada
  salvamento;
- `PactoSuggestion`: pré-qualificação do formulário ou sugestão da IA, sem
  promover automaticamente qualquer valor ao estado humano.

“Não investigado” representa ausência de evidência. Toda resposta investigada
exige evidência textual e identifica a origem Formulário, SDR, Closer ou IA,
sempre com autoria humana do rascunho/validação. O rascunho mantém status
`IN_PROGRESS`; somente `validate` produz `COMPLETED`. A prontidão para
qualificação exige o mínimo configurado no workspace e nenhuma dimensão
desqualificante. Esse sinal não altera etapa nem status do lead: transições
pertencem ao módulo `pipelines`.

O score varia de 0 a 100: dor 25, capacidade 30, decisão 15, intenção 20 e
contexto 10. P1 começa em 70, P2 em 40 e P3 em 0. Ausência rende zero e fica
marcada como lacuna, sem se transformar em penalidade. Cálculos e componentes
são append-only; `LeadCurrentScore` aponta para a revisão vigente. Sugestão de
IA nunca atualiza essa projeção, e override humano exige motivo.

As mutações usam lock transacional por lead, revisão otimista, RBAC no servidor,
atividade na timeline e `AuditLog`. O histórico não pode receber `UPDATE`,
`DELETE` ou `TRUNCATE` por triggers do PostgreSQL.
