# Relatório do banco de staging — PROD-06

## Decisão

**PROD-06 homologada para dados exclusivamente sintéticos.** O alvo preservado é
o projeto Neon Free `crm-politizai-staging-db` (`hidden-mode-30035631`), banco
`politizai_staging`, schema `public`, região AWS `sa-east-1` (São Paulo) e
PostgreSQL 18.6. Nenhuma credencial, connection string ou senha integra este
relatório.

Este aceite não promove o ambiente a produção, não autoriza dados reais e não
substitui os gates de web, worker, observabilidade e homologação das próximas
tasks.

## Complemento de falha isolada da PROD-10

Em 15 de setembro de 2026 foi criada uma branch Neon descartável com prefixo
`prod10-fault`, banco/schema e 60 migrations reconciliados. A aplicação isolada
iniciou com health/readiness 200. Ao aplicar `NOLOGIN` somente no usuário
runtime temporário e encerrar suas sessões, health permaneceu 200, readiness
passou a 503 e o job sintético continuou pendente, com zero tentativa/efeito.

Depois de restaurar `LOGIN`, readiness voltou a 200 e o job concluiu uma única
vez; o replay ficou ocioso e `externalEgress=false`. A branch, papéis,
referências de segredo, proxy, certificado e arquivos temporários foram
removidos. O staging principal permaneceu com 60 migrations, readiness 200 e
fingerprint seguro `585eb7002d47b032`. Detalhes estão em
[`REMOTE_DATABASE_FAILURE_REPORT.md`](./REMOTE_DATABASE_FAILURE_REPORT.md).

## Preflight e identificação do alvo

Antes de qualquer escrita, `pnpm exec tsx scripts/run-production-preflight.ts
--target=staging` retornou `READY_FOR_STAGING`. A conexão direta do migrator
confirmou:

- provider/projeto: Neon / `crm-politizai-staging-db`;
- ambiente: `STAGING`;
- banco/schema: `politizai_staging/public`;
- região: AWS São Paulo;
- papel: `crm_politizai_migrator`;
- TLS: criptografado, `sslmode=verify-full` e channel binding;
- endpoint: direto, sem pooling;
- fingerprint não sensível do alvo: `bcee0b8b790c27ab`.

Qualquer divergência nesses identificadores deve bloquear o procedimento. Os
valores de conexão permanecem fora do Git e não devem ser copiados para logs.

## Estado inicial observado

Snapshot anterior à mutação da PROD-06, em `2026-09-14T22:27:43.885Z`:

| Medida | Valor |
|---|---:|
| Tamanho do banco | 35.463.168 bytes |
| Tabelas em `public` | 297 |
| Migrations concluídas | 59 |
| Migrations incompletas/revertidas | 0 |
| Workspaces | 1 |
| Usuários/memberships | 1 / 1 |
| Leads / atividades / oportunidades | 0 / 0 / 0 |
| Audit logs | 2 |
| Locks aguardando | 0 |
| Fingerprint SHA-256 dos IDs estruturais | `3550c3bb414065333e17acd86180a236a55345547381028fd2a1db1ca3efe51a` |

O banco não estava vazio no início formal da PROD-06: as 59 migrations e o
bootstrap sintético já haviam sido aplicados pela etapa gratuita anterior. O
estado temporal original não foi recriado com reset destrutivo. O `migrate
deploy` foi executado em modo seguro e confirmou `No pending migrations to
apply`, preservando o estado válido.

## Migrations

O histórico persistido registra início em `2026-09-14T17:46:51.010692Z`, fim
em `2026-09-14T17:48:17.779353Z` e 84,415 segundos somados entre as 59
migrations. As três mais lentas foram:

| Migration | Duração persistida |
|---|---:|
| `20260910005226_relational_foundation` | 9,732 s |
| `20260912210000_omnichannel_inbox_foundation` | 5,399 s |
| `20260912040000_privacy_consent_retention` | 4,288 s |

Não houve erro nem lock aguardando na validação. O comando final
`pnpm db:migrate:deploy` durou 2,19 s e não reaplicou migration; `pnpm
db:status` durou 1,43 s e confirmou `Database schema is up to date!`.

## Dataset sintético

O comando `pnpm db:staging:homologate` é protegido por contrato remoto e por
confirmação explícita. Ele recusa produção, banco/schema divergentes, host fora
do Neon, processo diferente de migration, confirmação ausente e workspace
inesperado. Ele não aceita o seed demo local.

O dataset `PROD-06` cria ou reutiliza de forma idempotente:

- dois usuários sintéticos sem credencial interativa: um SDR e um visualizador;
- papéis mínimos e permissões necessárias ao ensaio;
- uma equipe de pré-vendas e a Fila Geral explícita;
- uma origem sintética, pipeline/etapa inicial e faixas P1/P2/P3;
- três políticas chamadas `SLA imediato — 0 minutos` com faixas 60/180 s;
- um único lead sintético pelo serviço transacional de entrada, sem egress;
- tarefa `Ligar agora`, ciclo de SLA, timeline, ownership e auditoria.

Duas execuções consecutivas mantiveram 1 lead, 3 membros e 1 equipe. A segunda
entrada retornou replay idempotente e o fingerprint SHA-256 do conjunto
lead/submissão/SLA/tarefa permaneceu
`4e0864c1fd4749ef8a5d811551d367d5253fc74b9e59ee8cdb222bdd0d986547`.
Nenhum dado local ou pessoal real foi importado.

## RBAC, isolamento e invariantes

As decisões foram calculadas pelo `AuthorizationService` contra o staging:

- administrador autorizado no próprio workspace;
- SDR autorizado a alterar o próprio lead;
- visualizador autorizado a ler e impedido de escrever;
- workspace divergente bloqueado com `WORKSPACE_MISMATCH`.

O lead possui responsável operacional explícito, próxima ação, tarefa imediata
com `dueAt = receivedAt`, e os timestamps `assignedAt` e
`automaticAcknowledgedAt` iguais a `receivedAt`. Timeline e auditoria estão
presentes. O papel runtime tem DML necessário, mas não tem CREATE no banco ou
schema, membership de owner, `TRUNCATE`, `TRIGGER` ou DDL.

### Complemento de homologação PROD-10

Em 14 de setembro de 2026, o mesmo homologador passou a criar ou reutilizar uma
identidade sintética interativa de closer. A senha é obrigatória por
`STAGING_HOMOLOGATION_CLOSER_PASSWORD`, nunca é versionada ou impressa, fica no
Chaves do macOS e não sobrescreve credencial já existente. O papel replica a
matriz `OWN` do closer demonstrativo, sem privilégios administrativos.

Duas execuções após a correção mantiveram 4 membros, 2 leads, 1 equipe, 60
migrations, o fingerprint original do lead PROD-06 e um único AuditLog
`prod10.staging_closer.prepared`. Login remoto, acesso às próprias superfícies
comerciais e negação de administração foram comprovados.

O restore atual em branch Neon isolada reconciliou 298 tabelas, 60 migrations,
4 membros, 2 leads, 6 atividades, 0 oportunidades, 36 logs de auditoria e o
fingerprint `f519eaca4fa123f9b56730051db8bab1`. A branch temporária foi removida
após a verificação; somente a branch principal de staging permaneceu.

## Ensaio de recuperação

Foi criado no Neon o branch efêmero
`prod06-restore-20260914-1640` (`br-noisy-mode-acu3lg79`) a partir do branch
principal, com expiração automática de um dia. A consulta isolada retornou:

| Medida | Principal | Recuperação |
|---|---:|---:|
| Migrations | 59 | 59 |
| Workspaces | 1 | 1 |
| Members | 3 | 3 |
| Leads | 1 | 1 |
| Atividades | 3 | 3 |
| Tarefas | 1 | 1 |
| Audit logs | 8 | 8 |
| Checksum MD5 ordenado dos IDs de lead | `1aff67a9841daaf93a3c51b5f2e6382b` | `1aff67a9841daaf93a3c51b5f2e6382b` |

A consulta no branch levou 222 ms. Após a reconciliação, somente esse branch
temporário foi excluído. O console confirmou novamente um único branch, o
principal `production` do projeto de staging. O banco principal não foi
restaurado, resetado ou removido.

## Recuperação e rollback

- **Aplicação:** promover novamente o commit anterior conhecido e compatível;
  nunca tentar desfazer migration aditiva com `migrate dev` ou SQL improvisado.
- **Banco:** dentro da janela Free atual de seis horas, criar branch isolado no
  ponto anterior ao incidente, validar migrations, contagens, fingerprints e
  jornadas e só então planejar um cutover separado e autorizado.
- **Dados:** não restaurar sobre o staging principal durante diagnóstico. Uma
  troca de branch/endpoint exige nova autorização, atualização segura do cofre,
  readiness e plano de retorno.
- **Limite:** o plano Free não fornece o objetivo produtivo de retenção/PITR;
  seu histórico de seis horas é adequado apenas à construção atual.

## Limitações registradas

- Gates finais: `pnpm lint`, `pnpm typecheck`, 337 testes unitários, 51
  integrações críticas, 1 integração isolada do bootstrap, 4 integrações de
  resiliência, auditoria de dependências, scanner dos 968 arquivos rastreados e
  `pnpm build` foram aprovados. O CI remoto do commit técnico também foi
  aprovado na execução
  [34890542908](https://github.com/Menddon/crm-politizai/actions/runs/34890542908).
  O dry-run final encontrou zero schema de teste residual.
- O agregador amplo `pnpm test:integration` retornou status 1 porque colocou no
  mesmo schema dois testes que exigem runners próprios: o bootstrap exige banco
  vazio e a resiliência exige prefixo `politizai_test_resilience_`. Ambos
  passaram quando executados isoladamente por seus comandos corretos; o CI usa
  o conjunto crítico explícito de 51 testes. A composição do agregador amplo é
  uma pendência de infraestrutura de testes, não uma falha do banco remoto.
- O homologador concluiu corretamente, mas o driver `pg` emitiu o aviso de
  depreciação já conhecido sobre uma consulta iniciada enquanto o client ainda
  encerra a anterior. Não houve falha nem efeito duplicado; a compatibilidade
  deve ser saneada antes da atualização para `pg` 9.
- O auto-deploy do serviço Render preexistente foi alterado de `On Commit` para
  `Off` antes do push desta task. Assim, o commit da homologação não publica a
  aplicação; a PROD-07 deverá decidir explicitamente quando publicar.
- O staging permanece sem web e worker homologados por esta task.

## Estado final

O banco principal terminou com 37.593.088 bytes, 297 tabelas, 59 migrations,
1 workspace, 3 members, 1 lead, 3 atividades, 1 tarefa, 8 audit logs e zero
lock aguardando. Produção, deploy web, worker remoto, seed demo, dados reais e
providers externos não foram tocados.
