# 08 — Ranking e janelas de tempo

## Períodos

- Timezone: `Workspace.timeZone`; fallback de schema `America/Sao_Paulo`.
- Hoje: `[dia local 00:00, agora)`.
- Semana: `[segunda local 00:00, min(agora, sábado local 00:00))`.
- Sábado/domingo: Hoje continua civil; Semana preserva segunda–sexta.
- Feriados: tratados como dia útil porque não existe calendário canônico. A UI não afirma exclusão de feriado.
- Fronteira: fato exatamente em `to` pertence ao intervalo seguinte.
- DST: conversão por `parseWorkspaceLocalDateTime`, não por soma fixa de 24 h.
- Virada: servidor recalcula em todo polling.

## Elegibilidade

- Ativos: `commercialMemberWhere` para SDR/Closer, mesmo com zero.
- Históricos: membro não ativo/removido que possui fato creditado no período semanal permanece para auditabilidade.
- Sem nome recuperável: “Ex-membro”.
- O painel autenticado e o link público são sempre `WORKSPACE`; escopo TEAM/OWN é negado em vez de rotulado como geral.

## Fórmula

```text
mensagens = WhatsApp enviado + Instagram enviado + e-mail enviado
ações = ligações + mensagens + reuniões agendadas + reuniões realizadas
```

Contatos efetivos e vendas são resultados/desempates, não voltam a somar nas ações.

## Ordem

1. maior ações;
2. maior contatos efetivos;
3. maior reuniões realizadas;
4. maior vendas;
5. nome por `localeCompare("pt-BR")`;
6. posição ordinal estável.

Empates numéricos recebem posições sequenciais com desempate nominal; a UI explica que o ranking é de atividade auditável. Zero atividade é neutro e permanece listável.

## Meta

O plano publicado mais recente que cobre toda a semana e possui uma quota de função `CLOSER` para `OPPORTUNITIES_WON` é a meta. Não há composição de quotas sobrepostas. Sem essa configuração, `target=null`; alvo zero permanece zero com progresso não aplicável.
