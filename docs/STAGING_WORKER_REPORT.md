# Homologação do worker em staging

## Complemento dirigido da PROD-10 — worker serverless remoto

O endpoint `POST /api/internal/worker/tick` foi concluído e homologado no
Vercel Hobby como execução **manual e controlada**, sem fingir processo 24×7.
Configuração inválida falha fechada; `SERVERLESS_WORKER_ENABLED=false` é uma
configuração válida e responde `503 WORKER_DISABLED` após autenticação. Sem
Bearer ou com segredo incorreto responde 401; query string responde 400.

Com o kill switch temporariamente habilitado, duas chamadas concorrentes sobre
um único job sintético resultaram em um `BATCH_COMPLETED` e um `BATCH_IDLE`.
O replay também ficou ocioso. O banco registrou um run, uma tentativa, um
efeito, backlog zero e `externalEgress=false`. Respostas contiveram somente
código, contagens agregadas, duração e correlation ID. Logs não revelaram o
segredo.

O mesmo SHA técnico `c5ad0b5c400b063f00ceab5cd7ba910e01537077`
executou web e endpoint. Ao final, o kill switch voltou a `false`; esta é a
postura deliberada do staging gratuito. Não há agendamento por minuto,
auto-restart ou disponibilidade 24×7 no Vercel Hobby.

## Decisão e escopo

- **Task:** PROD-08;
- **Data:** 14 de setembro de 2026;
- **Status:** concluída para a fase gratuita de construção, com runtime
  transitório;
- **Web:** Vercel Hobby `crm-politizai-staging`, preservada e protegida;
- **Banco:** Neon Free `politizai_staging/public`, AWS São Paulo;
- **Worker homologado:** entrypoint real `pnpm worker`, executado localmente em
  janela controlada contra o banco de staging;
- **Worker remoto 24x7:** não provisionado;
- **Egress e providers externos:** desabilitados.

A decisão definitiva da PROD-02 continua sendo uma Machine persistente na
região `gru`. Ela não foi substituída silenciosamente. Fly.io não foi contratado
porque o produto ainda está em construção e o usuário autorizou explicitamente
uma homologação gratuita temporária. Vercel Cron tampouco foi adotado: no plano
Hobby a frequência não atende ao polling atual, e converter o worker contínuo
em cron seria outra arquitetura.

Assim, esta evidência aprova o motor, a conexão e o comportamento do processo em
staging, mas **não** comprova disponibilidade contínua, reinício automático do
provider, health check externo ou operação 24x7. Esses itens continuam como gate
obrigatório antes de dados reais ou produção.

## Alvo confirmado

Antes de qualquer escrita, o alvo foi identificado sem imprimir segredo:

| Campo | Valor seguro |
|---|---|
| Provider | Neon |
| Ambiente | STAGING |
| Banco/schema | `politizai_staging/public` |
| Transporte | TLS obrigatório |
| Runtime | endpoint pooled, usuário restrito |
| Workspace | `politizai-staging` |
| Fingerprint runtime | `04711a1fdab8d279` |
| Backlog inicial | 0 jobs vencidos |

O processo recebeu somente `DATABASE_URL` pooled. `DIRECT_URL`, owner e migrator
não foram expostos ao worker. O contrato exigiu `APP_ENV=staging`, papel
`worker`, banco/schema/host esperados, confirmação literal, cookies seguros,
logs JSON, demo/seed/bootstrap desligados e `EXTERNAL_ADAPTERS_MODE=disabled`.

## Smoke remoto persistido

O comando `pnpm worker:staging:homologate` preparou exatamente um job sintético,
com prioridade 100 e chave estável `prod08:staging-worker:smoke:v1`. O script:

- recusa produção, banco não Neon, schema diferente de `public`, `DIRECT_URL`,
  worker desligado, adapter externo e confirmação ausente;
- recusa iniciar se houver job vencido alheio ao ensaio;
- usa a fixture sintética criada na PROD-06;
- agenda uma ação de saúde que encontra a próxima ação já restaurada e termina
  com `skipped=true`, sem alterar o lead;
- preserva um único `AutomationRun`, `Job`, `AutomationAttempt` e
  `AutomationEffect`;
- grava auditoria com `externalEgress=false`;
- pausa a regra sintética após a verificação.

O entrypoint real iniciou como `prod08-staging-transient-job`, processou o job e
recebeu `SIGTERM`. O resultado verificado no Neon foi:

| Evidência | Resultado |
|---|---|
| Processo | iniciou e encerrou com código 0 |
| Job/Run | `SUCCEEDED` / `SUCCEEDED` |
| Tentativas | 1 |
| Recibos de efeito | 1 |
| Repetição da chave | 1 run persistido |
| Efeito de domínio | ignorado com segurança porque a próxima ação existe |
| Backlog final | 0 |
| Regra do smoke | `PAUSED` |
| Egress externo | false |
| Fingerprint do ensaio | `fc98791f77366be7f105` |

O próprio `SIGTERM` validou shutdown gracioso e desconexão. O lock expirado
simula queda no meio do processamento: a tentativa abandonada termina com
`WORKER_LOCK_EXPIRED` e um novo worker continua sem repetir o efeito.

## Matriz de validação

| Cenário | Evidência | Resultado |
|---|---|---|
| Job normal em staging | smoke persistido no Neon | PASS |
| Retry e backoff | integração dirigida do motor | PASS |
| Falha terminal/dead-letter | job `FAILED` no limite | PASS |
| Replay autorizado | Gestor reprocessa; histórico preservado | PASS |
| Dois workers concorrentes | `SKIP LOCKED`: um sucesso e um ocioso | PASS |
| Lock expirado/reinício | tentativa antiga falha e a seguinte conclui | PASS |
| Item duplicado | mesmo job/run e um único efeito | PASS |
| Backlog | 0 antes e depois do smoke remoto | PASS |
| Kill switch de configuração | `false` é válido e bloqueia processamento com `503 WORKER_DISABLED` | PASS |
| Kill switch operacional | `SIGTERM` encerra lote e conexão | PASS |
| Provider/egress | todos desligados; efeito interno apenas | PASS |
| Auto-restart remoto | nenhum runtime remoto gratuito provisionado | DEFERRED |
| Health/readiness remoto do worker | exige host persistente | DEFERRED |
| Limites de CPU/memória do provider | exige host persistente | DEFERRED |

Os oito testes de integração dirigidos usam schema efêmero local e validam o
motor sem tocar no Neon. O smoke remoto valida separadamente alvo, pool,
entrypoint, persistência e shutdown. Essa separação evita usar o banco remoto
como runner de testes destrutivos.

## Operação temporária

Durante a fase gratuita, o worker fica **desligado por padrão**. Em uma janela
autorizada, o operador recupera a URL runtime do Keychain, deriva o host sem
imprimi-lo, carrega o contrato de staging e executa `pnpm worker`. O processo é
encerrado com `SIGTERM` ou `SIGINT`; jobs continuam no PostgreSQL para o próximo
tick. Nunca se deve usar owner/migrator, carregar `.env` local ou habilitar
adapter real nesse fluxo.

O script de homologação é deliberadamente mais restritivo e deve receber:

```text
STAGING_WORKER_HOMOLOGATION_CONFIRMATION=RUN_TRANSIENT_STAGING_WORKER
STAGING_WORKER_HOMOLOGATION_WORKSPACE_SLUG=politizai-staging
```

Esses nomes não são segredos. Connection strings e credenciais permanecem no
Keychain/cofre e não aparecem neste documento.

## Pendências obrigatórias antes de produção

1. aprovar cobrança e provisionar o host persistente definido no ADR, ou aprovar
   formalmente outra arquitetura em nova decisão;
2. configurar uma réplica, reinício automático, recursos e health/readiness;
3. implantar o mesmo SHA da web e segredos separados;
4. validar queda real do processo, recuperação pelo provider e observabilidade
   contínua;
5. medir backlog, latência, pool e custo durante uma janela prolongada;
6. manter todos os adapters externos desligados até autorizações específicas.

Nenhum projeto de produção, Fly app, cron, domínio, Redis, fila externa,
provider comercial ou egress foi criado nesta task.
