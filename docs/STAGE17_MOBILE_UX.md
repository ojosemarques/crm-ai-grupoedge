# Etapa 17 — UX móvel operacional

A operação usa a aplicação web responsiva. Não existe aplicativo nativo nesta entrega; por isso, push nativo não se aplica. As notificações persistidas continuam disponíveis na central do CRM e pelo atalho visível no cabeçalho móvel.

## Jornadas críticas

- A navegação móvel fixa dá acesso a Meu dia, funil, inbox, atividades e painel sem depender do menu lateral.
- Conta e contato 360 oferecem atalhos para ligação governada, agendamento e histórico. A ligação abre a telefonia interna com o lead autorizado já selecionado; esse fluxo registra conversa, chamada, eventos técnicos e auditoria. Um link `tel:` direto não é usado porque contornaria privacidade, permissões e histórico.
- O agendamento abre a agenda com o lead autorizado selecionado. Ao confirmar, a reunião, a tarefa e o histórico operacional são persistidos.
- Inbox, Kanban, dashboard e construtor de agentes preservam ações críticas em telas pequenas, com alvos de toque ampliados e formulários sem zoom automático no iOS.
- Busca global, central de notificações, estados vazios, erros recuperáveis, navegação por teclado, foco visível e redução de movimento continuam compartilhados entre desktop e web móvel.
