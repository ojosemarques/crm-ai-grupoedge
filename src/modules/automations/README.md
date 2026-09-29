# automations

Fronteira do motor local entregue nas CRM-21, CRM-22 e CRM-23:

- `domain`: contratos de evento/ação e avaliação determinística de condições;
- `application/automation-engine-service.ts`: publicação, execução manual,
  ativação/pausa, cancelamento e reprocessamento;
- `application/automation-worker-service.ts`: claim concorrente, retry,
  retomada e recibos idempotentes;
- `application/automation-action-registry.ts`: porta obrigatória para serviços
  de domínio;
- `application/predefined-entry-automation-actions.ts`: efeitos idempotentes
  das cinco regras de entrada, sem repetir intake, score, distribuição ou SLA;
- `application/predefined-lifecycle-automation-actions.ts`: efeitos das regras
  6 a 12, com revalidação do estado persistido e mensagens apenas simuladas;
- `application/lifecycle-automation-scheduler.ts`: cadências, lembretes,
  cancelamentos e varredura determinística de saúde do processo;
- `application/notification-service.ts`: central individual, isolamento por
  destinatário e leitura auditada;
- `application/automation-observability-service.ts`: estado persistido dos
  jobs, runs e tentativas, com filtros por regra, status, lead e período;
- `worker.ts`: loop local iniciado por `pnpm worker`.

As 12 automações são predefinidas e seedadas. A gestão e o histórico ficam em
`/automacoes`; cada usuário consulta suas notificações em `/notificacoes`.
Não existe editor visual livre, integração externa, mensagem real, onboarding
ou nutrição automática. Consulte `docs/AUTOMATIONS.md`.
