# TEMPO REAL unificado — correção de produto

## Requisitos

- Um único sistema visual premium/minimalista, com modos Geral e Ranking; tema escuro padrão e tema claro opcional, independentes do slide e persistidos por navegador/link.
- Geral: dia e semana operacional lado a lado, contatos únicos, ligações, mensagens enviadas, reuniões marcadas/realizadas, execuções e vendas; meta semanal de vendas e evolução diária.
- Ranking: atividade semanal, resultado diário e semanal por vendedor, metas por atividade sem duplicar metas coletivas nem inventar divisão entre pessoas.
- Dois slides, 60 segundos cada, pausa, seleção manual, paginação completa, tela cheia, polling resiliente e compartilhamento anônimo revogável.
- Fonte: `CommercialMetricFact`, a mesma consumida por Prospecção Ativa, logs de execução e Indicadores; não somar novamente os totais dessas telas.
- Metas diárias: `DailyGoalProfile` de vendedores ativos. Mensagens da meta consideram WhatsApp/Instagram, como Meu Dia; o total enviado inclui também e-mail, com rótulos distintos.
- Semana: segunda a sexta no timezone do workspace. Só aceitar GoalPlan publicado com início na segunda da semana e fim no sábado ou na segunda seguinte. Não usar meta mensal como semanal.
- Metas semanais de atividade derivadas do perfil diário são identificadas como diária × 5. Contatos da meta acumulam resultados individuais diários; o indicador geral permanece único por período, como Indicadores.
- Quotas coletivas somadas somente em escopos disjuntos; quotas individuais não são somadas novamente à quota coletiva que já cobre a pessoa. Meta ausente/zero não vira 100%; cobertura incompleta é exibida.

## Execução e prova

1. Contratos/agregação de metas e execuções; testes de período, atribuição e deduplicação.
2. Dois modos no mesmo layout/tema; controles de preferência e compartilhamento.
3. Unitários, integração real dos fatos/perfis/quotas, comparação com os agregadores canônicos.
4. E2E: 4 combinações modo/tema, persistência, 60/120 s, tela cheia, compartilhamento e revogação; 1920×1080, 1366×768 e móvel.
5. Main/CI/deploy, captura e smoke real, link público utilizável.

## Limites

Sem novas dependências ou migrations. Não alterar produtores nem reprocessar dados de produção. Não fabricar metas; usar as configurações existentes e mostrar ausência/cobertura parcial. Manter isolamento do workspace e DTO público sem IDs ou dados de leads.

## Estado

Implementação e validação local concluídas; rollout e smoke produtivo pendentes.

## Evidências locais — 22/10/2026

- `pnpm lint`, `pnpm typecheck`: exit 0.
- `pnpm test`: 187 arquivos, 916 testes aprovados.
- `pnpm test:integration -- tests/integration/realtime-dashboard-schema.integration.test.ts`: 3 testes aprovados, incluindo exclusão de plano mensal e leitura real de fatos/perfis/quotas. Schema local efêmero descartado pelo runner.
- `pnpm test:e2e -- tests/e2e/realtime-dashboard.spec.ts`: build otimizado e 2 testes aprovados. Cobertura: tema independente/persistente, Geral/Ranking, 60/120 s, pausa, fullscreen, diálogo, acesso em contexto anônimo, revogação sem reload, 32 vendedores/paginação, falha e recuperação de conexão.
- QA: 12 capturas (2 modos × 2 temas × 3 resoluções), sem sobreposição ou corte vertical; sem overflow do documento no build de produção. Inspeção visual em Full HD e 1366×768.
- `pnpm security:scan`: política aprovada. Mantidos bearer estrito, hash-only, RBAC, escopo de workspace e DTO público sem IDs de pessoas/leads.
- Sem mudanças de dependências, migrations, produtores ou dados comerciais.
