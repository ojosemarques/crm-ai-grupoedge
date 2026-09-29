# Scoring explicável

## Regra inicial

| Componente | Máximo | Evidência inicial |
|---|---:|---|
| Dor explícita | 25 | Dor/interesse informado ou Aflição PACTO validada |
| Capacidade compatível | 30 | Capacidade informada e depois validada com respeito |
| Decisor ou influenciador | 15 | Cargo como sinal provisório; Tomada de decisão como fato validado |
| Intenção em até 30 dias | 20 | Oportunidade agora no PACTO validado |
| Contexto compatível | 10 | Contexto institucional/operacional informado ou validado |

P1 corresponde a 70–100, P2 a 40–69 e P3 a 0–39. Componentes parciais recebem
50% do peso, com arredondamento para o inteiro mais próximo. O resultado final é
limitado entre 0 e 100.

Ausência de dado recebe zero e `missingData=true`; não é uma resposta negativa.
Penalidades são componentes separados e só aparecem quando há sinal explícito:
sem capacidade, nenhuma dor, curiosidade, contato inválido ou ausência de acesso
ao decisor. A normalização rejeita telefone inválido antes do scoring, portanto
esse sinal não é inferido de um dado ausente.

## Fontes e vigência

- `FORM_PROVISIONAL`: calculado no mesmo commit da entrada. Em duplicidade,
  substitui outro provisório, mas não sobrepõe score humano.
- `SDR_VALIDATED`: nasce no mesmo commit de uma validação PACTO.
- `AI_SUGGESTED`: registro separado; nunca se torna vigente automaticamente.
- `HUMAN_OVERRIDE`: exige score de 0 a 100, motivo e `leads.write`.

`LeadCurrentScore` é a fonte da pontuação e prioridade mostradas na lista, Meu
Dia e cartão. O ciclo de SLA preserva a classificação de sua submissão e não é
reescrito quando a pontuação muda.

## Histórico e concorrência

Cada `LeadScore` guarda regra, versão, algoritmo, fonte, input snapshot, motivo,
componentes, ator e instante. Score e componentes são append-only. Recálculo
sempre acrescenta um registro; nunca altera o anterior.

O serviço bloqueia o lead durante a troca da projeção e compara
`expectedRevision`. Duas alterações com a mesma revisão produzem um commit e um
erro `SCORE_CONCURRENT_UPDATE`. Falha posterior reverte score, componentes,
projeção, prioridade do lead, timeline e auditoria.

## Versionamento

`ScoringRuleVersion` possui pesos, penalidades e faixas em colunas relacionais.
O banco permite ativar/desativar a versão, mas rejeita a reescrita de seus
valores. Alterar a fórmula exige outra versão. Scores antigos continuam ligados
à versão original; somente um recálculo explícito usa a versão nova.
