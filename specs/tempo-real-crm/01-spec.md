# 01 — Especificação de produto

## Histórias

- Como gestor, vejo o ritmo comercial de hoje e da semana numa TV sem interação contínua.
- Como gestor autorizado, gero, rotaciono ou revogo um link público de leitura.
- Como vendedor no escritório, entendo o ranking como volume de atividade auditável, sem linguagem punitiva.
- Como responsável por segurança, provo que o bearer não libera shell, APIs administrativas, IDs ou PII.

## Requisitos funcionais

1. `Trabalho → TEMPO REAL` abre `/tempo-real` somente com `realtime.read` em `WORKSPACE`.
2. Duas visões principais: Geral e Ranking; troca automática a cada 60 s.
3. Troca manual reinicia o ciclo de 60 s.
4. Polling normal a cada 15 s, sem requisições sobrepostas, com backoff máximo de 120 s.
5. Falha preserva a última leitura e marca atraso/offline.
6. Geral mostra Hoje e Semana: contatos efetivos, ligações, mensagens, reuniões agendadas/realizadas, vendas e valor.
7. Meta semanal de vendas usa apenas quota publicada `OPPORTUNITIES_WON` para função `CLOSER` cobrindo a semana operacional; sem quota, retorna `null`.
8. Ranking semanal: ações = ligações + mensagens + reuniões agendadas + realizadas.
9. Desempates: ações, contatos efetivos, reuniões realizadas, vendas e nome.
10. SDR e Closer ativos entram mesmo com zero; ex-membros com fatos na semana entram com nome histórico disponível.
11. Público abre `/tempo-real-publico#<token>` sem sessão e consome só `/api/public/tempo-real`.
12. Token é 256 bits, armazenado apenas como SHA-256, mostrado somente na geração/rotação.
13. Rotação invalida imediatamente o anterior; revogação falha fechada.
14. Fullscreen disponível e layout funcional em 1920×1080, 1366×768, desktop e tablet.

## Não funcionais

- SLA: fato persistido aparece em até 20 s em condição normal.
- API p95 alvo < 1 s em carga representativa.
- `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` no público.
- Sem token em path/query, logs da aplicação, telemetry, audit ou erros.
- Sem IDs internos, e-mail, telefone, lead/contato ou evento bruto no DTO público.
- A página por 8 h não acumula timers/listeners/requisições.

## Estados

`loading`, `live`, `partial`, `stale`, `offline`, `empty-day`, `empty-week`, `goal-missing`, `denied`, `invalid-or-revoked`, `blocking-error`, `fullscreen`.

## Edge cases

- Hoje inclui o dia civil mesmo no fim de semana; Semana considera segunda 00:00 até `min(agora, sábado 00:00)`.
- Feriado não é excluído: calendário comercial canônico não existe; isso fica explícito.
- Intervalos são semiabertos e calculados no servidor.
- Meta zero configurada é diferente de meta ausente; percentual fica não aplicável para alvo zero.
- Correções negativas são preservadas; cards nunca truncam o ledger antes da regra canônica.
- Nomes ausentes usam “Ex-membro”; avatar usa iniciais porque o schema não possui avatar.

## Aceite binário

- [ ] Totais de Hoje/Semana equivalem aos fatos canônicos do mesmo intervalo.
- [ ] Ligação tentativa + resultado conta uma ligação.
- [ ] Mensagem com falha não conta.
- [ ] Reunião realizada exige `MEETING_COMPLETED`.
- [ ] Fato de sábado não entra na Semana; pode entrar em Hoje.
- [ ] Meta ausente mostra “Não configurada”, não `0%`.
- [ ] Empate é determinístico pela sequência documentada.
- [ ] Slides trocam em 60 s e retornam em 120 s.
- [ ] Troca manual reinicia o contador.
- [ ] Refresh falho mantém leitura e mostra stale/offline.
- [ ] Link válido abre sem cookie; token inválido/revogado retorna 404 uniforme.
- [ ] Token A nunca seleciona workspace B.
- [ ] Payload público não contém IDs internos/PII.
- [ ] Menu, página e API autenticada negam capability ausente.
- [ ] Migration, build, testes, QA visual e smoke de produção possuem evidência real.

## Glossário

- **Fato:** linha imutável/corrigível de `CommercialMetricFact`.
- **Freshness:** instante do fato mais recentemente registrado dentro do recorte.
- **Semana operacional:** segunda a sexta, sem exclusão de feriado por falta de fonte canônica.
- **Ação:** unidade transparente usada apenas para ordenar o ranking.
- **Bearer:** segredo cuja posse concede leitura do placar público até revogação.
