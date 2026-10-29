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
Essas 12 regras não enviam mensagens reais; conectores externos são executados
por workers específicos. Consulte `docs/AUTOMATIONS.md`.

Os novos leads do pipeline `Anúncios` do workspace `politizai` podem gerar um
aviso privado para Carlos pelo Telegram. O job é persistido com a entrada do
lead e enviado depois do commit, inclusive nos formulários públicos. O cron
recupera falhas; replay da entrada e conversões anexadas não criam novo aviso.
O envio exige `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN` e
`TELEGRAM_WEBHOOK_SECRET` server-side, além de Carlos ativo e conectado.
O vínculo usa a conexão `telegram-carlos-lead-alerts`, configuração versionada
`telegram-lead-alerts/v1` e um código de ativação de uso único, com expiração.
Somente o hash do código fica no banco. O webhook
`/api/integrations/telegram/webhook` exige o segredo do Telegram, aceita vínculo
apenas em conversa privada e impede que outro chat reutilize o código.
O aviso inclui nome, horário de recebimento e botão para a ficha autenticada;
telefone e respostas do formulário permanecem no CRM. O bot não aborda o lead.
