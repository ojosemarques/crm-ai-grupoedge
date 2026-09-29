# Protocolo de execução — expansão Revenue OS

## Autoridade e escopo

Uma mensagem contendo backlog não autoriza execução. Somente uma autorização
explícita `EXECUTAR CRM-XX` permite a task correspondente. Ao concluir ou
encontrar erro não resolvido, o agente para; não inicia a próxima.

Cada task deve preservar alterações não relacionadas, commits, backup, schema
`public`, IDs e os 82 schemas legados protegidos. São proibidos deploy, banco
remoto, provider real e credencial sem autorização explícita do escopo.

## Estados de task

- `NÃO INICIADA`: existe somente no backlog;
- `EM ANDAMENTO`: autorização confirmada e inspeção iniciada;
- `BLOQUEADA`: dependência/decisão impede conclusão e foi registrada;
- `CONCLUÍDA E VALIDADA`: fluxo, testes, permissões, dados, auditoria e docs do
  escopo passaram com evidência.

## Estados de capacidade/integracão

Estes estados não são sinônimos e devem aparecer literalmente nos relatórios:

1. `IMPLEMENTADO`: código/migration existe; testes ainda podem faltar;
2. `VALIDADO LOCALMENTE`: suíte local e banco descartável passaram;
3. `VALIDADO EM SANDBOX`: provider real de teste e casos de falha passaram;
4. `CONECTADO`: credencial e handshake ativos no ambiente declarado;
5. `ATIVO EM HOMOLOGAÇÃO`: usuários/processos piloto e dados reconciliados;
6. `ATIVO EM PRODUÇÃO`: ativação explícita, monitorada e reversível.

Um estado só avança com evidência daquele nível. Mock não é sandbox; credencial
salva não é conexão; conexão não é homologação; build não é deploy.

## Checkpoint inicial obrigatório

1. ler AGENTS.md/CLAUDE.md e instruções;
2. ler guias relevantes do Next.js instalado;
3. `git status`, branch, log, diff e SHA local/remoto;
4. confirmar dependência anterior em `EXECUTION_STATUS.md` e no código/testes;
5. inspecionar schema, migrations, serviços, rotas, testes e docs afetados;
6. confirmar banco/host/schema e `pnpm db:status` quando houver persistência;
7. medir/fingerprinting antes de migration/backfill;
8. registrar código parcial de task futura sem completá-lo.

Divergência material interrompe a task antes da escrita.

## Planejamento de alteração

- delimitar agregados, fonte oficial e invariantes;
- escolher `expand/migrate/reconcile/switch/contract` quando houver schema;
- mapear permissões e escopo por recurso;
- mapear fatos históricos, auditoria e idempotência;
- definir estados vazio/erro/loading/sem permissão/indisponível;
- separar mudanças internas de dependências externas;
- preparar rollback e critérios de parada.

## Implementação

- UI nunca importa Prisma nem decide regra comercial;
- handlers/actions validam, autenticam e chamam serviços;
- serviço filtra workspace antes de ler ou mutar;
- mutação relevante grava estado, evento/outbox e auditoria atomicamente;
- jobs possuem lock, retry limitado, idempotency key e dead-letter;
- dinheiro, timezone e enums seguem convenções existentes;
- integração usa adapter/inbox/outbox; n8n nunca usa banco;
- IA produz sugestão estruturada e requer confirmação humana sensível;
- nenhum valor decorativo ou fato inventado.

## Testes mínimos proporcionais

### Documentação apenas

- consistência de links/termos/status;
- `git diff --check`;
- lint e typecheck se referências versionadas puderem afetar o projeto.

### Domínio/persistência

- unitários de regra;
- integração em `politizai_test_*` efêmero;
- workspace, RBAC, concorrência, idempotência, rollback e auditoria;
- migration em vazio e upgrade/backfill;
- contagem/fingerprint e query/indexes.

### UI

- testes direcionados e E2E;
- loading, vazio, erro, sem permissão e conflito;
- teclado, foco, leitor de tela, mobile e overflow;
- nenhum dado falso.

### Integração externa

- mock/fault injection local;
- sandbox com credencial aprovada;
- assinatura, rate limit, retry, replay, cursor e revogação;
- reconciliação e prova de não duplicidade;
- indisponibilidade não pode quebrar o domínio.

### Gate de entrega

Conforme o impacto: `pnpm lint`, `pnpm typecheck`, `pnpm test`, integração,
E2E, `pnpm audit`, `pnpm build` e `pnpm db:status`. Comando não executado é
registrado como não validado, nunca aprovado.

## Git e artefatos

- alterar somente arquivos do escopo;
- não versionar `.env`, `.next`, `node_modules`, backup, dump ou relatório;
- executar scan de segredo antes do commit;
- commit nomeado pela task;
- push para `main` somente quando autorizado na task;
- confirmar repositório `PRIVATE` e SHA local/remoto igual;
- commit/push não significam deploy.

## Resposta final de cada task

1. estado encontrado;
2. decisões/premissas;
3. correção ou entrega;
4. arquivos modificados;
5. comandos e resultados exatos;
6. permissões, dados, histórico e auditoria validados;
7. itens não executados e riscos;
8. status/checkpoint e próxima task autorizável;
9. confirmação de ausência de deploy quando aplicável.

## Tratamento de erro

Reproduzir com segurança, registrar comando/mensagem/causa/escopo, corrigir só
o mínimo autorizado e repetir o teste. Se não concluir, marcar bloqueada e
parar. Não enviar ou iniciar tasks posteriores na fila.

## Protocolo da PROD-01

O repositório privado e o backup local validado são proteção permanente. Antes
de contract migration, dados reais ou produção, criar backup novo, validar
restore e seguir `LOCAL_DATABASE_BACKUP.md`. Testes continuam proibidos em
`public` ou host remoto e removem seus schemas em `finally`.
