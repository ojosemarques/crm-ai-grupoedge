# Runbooks operacionais de staging e release candidate fechado

## Fronteira de produção após a PROD-12

As evidências consolidadas estão em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md), com
recortes em [migrations](./PROD12_MIGRATION_REPORT.md),
[deployment](./PROD12_DEPLOYMENT_REPORT.md),
[rollback](./PROD12_ROLLBACK_REPORT.md) e
[aceite](./PROD12_ACCEPTANCE_REPORT.md).

- projeto Vercel permitido: `crm-politizai-production`, sem Git, com somente o
  deployment fechado `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n` ativo;
- projeto Neon permitido: `steep-credit-26086628`, banco
  `politizai_production/public`, 60 migrations e nenhum dado operacional;
- ponto de recuperação preservado:
  `prod12-pre-migration-20260916` (`br-delicate-river-ac1k3pf7`);
- `AUTOMATION_WORKER_ENABLED=false` e `SERVERLESS_WORKER_ENABLED=false`;
- não executar migration adicional, seed, bootstrap, novo deploy, domínio ou
  integração sem autorização posterior;
- o Neon Free não protege a branch e oferece apenas 6 horas de histórico;
  confirmar projeto, branch, banco, role e fingerprint antes de toda mutação;
- qualquer tela de upgrade, cartão ou cobrança é condição de parada.

## Rollback do release candidate

1. interromper novas mutações e confirmar correlation ID/deployment;
2. manter worker e adapters desativados;
3. para aplicação, promover somente um deployment previamente identificado e
   protegido; não executar migration durante rollback de código;
4. validar `/api/health` e `/api/ready` antes e depois da promoção;
5. restaurar o candidato `bf15b079` se o artefato anterior falhar;
6. banco só pode ser restaurado após análise explícita; a branch
   `prod12-pre-migration-20260916` representa o estado vazio anterior às
   migrations e não deve ser removida sem nova autorização;
7. registrar a decisão sem copiar URL, segredo, Authorization ou payload.

## Regra comum de triagem

1. Anote correlation ID, horário, deployment e workspace bucket; não copie
   payload, telefone, e-mail, cookie ou URL de banco.
2. Confirme se o evento está no projeto `crm-politizai-staging` e no banco
   `politizai_staging/public`.
3. Reconheça o alerta no console somente após assumir responsabilidade.
4. Verifique evidência agregada e o registro relacionado por serviço autorizado.
5. Mitigue pelo serviço de domínio normal; não altere tabela manualmente.
6. Registre resultado no incidente. Resolver não apaga alerta ou auditoria.
7. Em dúvida sobre escopo, segredo ou dado real, interrompa e escale.

## `runbook-api` e `runbook-api-latency`

- validar `/api/health` e depois `/api/ready`;
- separar 4xx esperado de 5xx e correlacionar com o deployment;
- verificar retomada do Neon Free e pool antes de redeploy;
- nunca registrar corpo de request;
- falha persistente de readiness: congelar novas mutações e manter staging
  protegido.

## `runbook-auth`

- confirmar agregados de `auth.login.failed`, sem buscar senha ou IP em log;
- verificar rate limit compartilhado e lockout persistido;
- manter Vercel Authentication ativa;
- suspeita de credencial: invalidar sessões e rotacionar pelo cofre, sem enviar
  segredo ao chat.

## `runbook-jobs`, `runbook-worker` e `runbook-automations`

- verificar backlog, `runAt`, tentativas, lock e falha terminal;
- no staging gratuito, ausência do worker contínuo é conhecida: executar janela
  transitória somente com autorização;
- para o endpoint serverless, manter `SERVERLESS_WORKER_ENABLED=false` fora da
  janela; habilitar pelo cofre, invocar com Bearer, observar correlation ID e
  voltar o kill switch a `false` após reconciliar backlog;
- `503 WORKER_DISABLED` é estado operacional esperado; configuração inválida,
  401 e 400 por query devem ser investigados sem registrar Authorization;
- retry/replay deve usar o serviço autorizado e preservar idempotency key;
- nunca habilitar provider externo para “destravar” um job;
- antes de produção, provisionar o processo persistente aprovado no ADR e
  validar auto-restart/health.
- na infraestrutura gratuita de produção, o worker permanece desligado; não
  usar self-ping, GitHub Actions ou cron esparso como substituto de 24×7.

## `runbook-outbox`

- confirmar que adapters continuam `disabled`;
- revisar erro seguro, tentativa e receipt sem abrir payload;
- outbox externa não deve ser entregue nesta fase;
- dead-letter exige análise e replay humano, nunca atualização direta.

## `runbook-sla`

- abrir os leads do recorte autorizado;
- distinguir sem tentativa, até 60 s, 61–180 s e acima de 180 s;
- preservar a política **SLA imediato — 0 minutos**;
- redistribuir somente por serviço autorizado, com evento e auditoria.

## `runbook-dsr`

- confirmar identidade, finalidade, prazo, legal hold e escopo;
- execução destrutiva automática permanece desligada;
- escalar ao responsável de privacidade antes de qualquer operação irreversível.

## Incidente e escalonamento

Em staging, Matheus Mendonça é release owner, migration owner, incident
commander, rollback owner, worker owner e responsável por custos/cotas. Pode
pausar o worker, autorizar rollback e interromper a homologação. A concentração
é aceita somente no staging sintético. Substituto, on-call e owners de
jurídico/privacidade/segurança continuam obrigatórios antes da produção. Ver
[`OPERATIONAL_OWNERS.md`](./OPERATIONAL_OWNERS.md).

## Falha do banco

- health deve permanecer 200; readiness deve refletir 503 enquanto o banco não
  estiver disponível;
- não marcar job como concluído sem tentativa/efeito persistidos;
- após retorno, validar readiness 200 e permitir que o próximo tick retome o
  item com idempotência;
- nunca desligar o banco principal de staging para ensaio; usar somente recurso
  descartável identificado por `prod10-fault`.
