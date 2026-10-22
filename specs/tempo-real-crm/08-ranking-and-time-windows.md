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

As ações continuam disponíveis no contrato de dados, mas não definem o ranking. Contatos efetivos e vendas não voltam a somar nas ações.

## Ordem

1. mais reuniões agendadas hoje, com crédito de quem agendou;
2. mais reuniões agendadas na semana;
3. nome por `localeCompare("pt-BR")`;
4. posição ordinal estável.

Pódio e tabela compartilham a mesma ordem. O resultado principal é “reuniões agendadas hoje”; a coluna e referências a execuções não são exibidas. Empates recebem posições sequenciais. Zero atividade permanece listável.

## Metas individuais recorrentes

Os perfis de Meu Dia são a fonte das metas, sem valores fixos na interface: Carlos, Jhon e Ede têm 75 contatos efetivos e 4 reuniões marcadas por dia (375 contatos-dia e 20 agendamentos por semana). Jhon e Ede têm 2 reuniões realizadas por dia, 10 por semana, cada. As metas existentes de ligações, mensagens e vendas são preservadas. Contatos semanais únicos e progresso semanal de contatos-dia mantêm seus grãos distintos.

## Meta

O plano publicado mais recente que cobre toda a semana e possui uma quota de função `CLOSER` para `OPPORTUNITIES_WON` é a meta. Não há composição de quotas sobrepostas. Sem essa configuração, `target=null`; alvo zero permanece zero com progresso não aplicável.
