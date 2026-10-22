# 07 — Fonte de verdade das métricas

| Métrica | Definição | Evento/fonte | Timestamp/crédito | Quantidade e correção | Meta/teste |
|---|---|---|---|---|---|
| Contatos efetivos | leads distintos com ao menos saldo positivo de contato confirmado | `CALL_CONNECTED`, `INBOUND_MESSAGE_RECEIVED`, `WHATSAPP_MESSAGE_SENT`, `INSTAGRAM_MESSAGE_SENT`, `EMAIL_SENT` | `occurredAt`; `creditedMemberId` | saldo por evento+lead; reversão negativa remove o marco | sem meta no painel; duplicidade e reversão |
| Ligações | tentativa outbound iniciada | `CALL_ATTEMPTED` | `occurredAt`; `creditedMemberId` | soma `quantity`; resultados connected/unanswered/failed não somam outra ligação | tentativa+resultado = 1 |
| Mensagens | envios confirmados em WhatsApp, Instagram e e-mail | `WHATSAPP_MESSAGE_SENT`, `INSTAGRAM_MESSAGE_SENT`, `EMAIL_SENT` | `occurredAt`; `creditedMemberId` | soma `quantity`; falha/agendamento/tarefa sem envio fora | múltiplos canais e falha |
| Reuniões agendadas | agenda criada ou movimento explícito para reunião | `MEETING_SCHEDULED` | `occurredAt`; `bookedByMemberId` ou `creditedMemberId` | soma ledger; produtor evita StageHistory de origem MEETING | agenda/etapa/reversão |
| Reuniões realizadas | comparecimento explicitamente registrado | `MEETING_COMPLETED` | `occurredAt`; `creditedMemberId` | soma `quantity`; horário passado não conta | completed vs no-show |
| Vendas | ganho comercial persistido | `SALE_WON` | `occurredAt`; `creditedMemberId` | quantidade e `valueCents`, inclusive correções | reabertura/estorno |
| Meta semanal | quota publicada de vendas em contagem, função Closer, cobrindo semana | `GoalPlan` + `GoalQuota(OPPORTUNITIES_WON)` | vigência do plano/timezone | alvo `BigInt`; ausência `null`, zero configurado preservado | sem plano, zero, plano vigente |

## Relação entre superfícies

- Prospecção/agenda/oportunidades produzem fatos idempotentes.
- O log operacional explica acontecimentos, mas não é somado ao ledger.
- Indicadores e TEMPO REAL leem `CommercialMetricFact`; o TEMPO REAL não soma o resultado de Indicadores aos fatos.
- `summarizeDashboardSellerActivity` fornece regras já existentes de crédito/detalhe; o snapshot limita-se às métricas listadas.

## Invariantes

1. `eventKey` é único por workspace.
2. `occurredAt` define período; `recordedAt` define freshness de ingestão.
3. Correção negativa é mantida e reconciliada.
4. Contato efetivo é distinto por lead, não soma canais do mesmo lead.
5. Mensagem enviada nunca é inferida de tarefa concluída.
6. Reunião realizada nunca é inferida por data passada.
7. Venda usa `SALE_WON`, não forecast/proposta/contrato.
8. DTO nunca devolve fatos brutos ou identificadores.

## Fixtures mínimas

- uma tentativa + um resultado da mesma ligação;
- um lead por dois canais;
- envio falho e envio confirmado;
- reunião de agenda e transição sem duplicação de origem;
- venda e correção negativa;
- membro ativo zero, membro inativo com fato;
- dois workspaces com datas/nomes parecidos;
- meta ausente, zero e positiva.
