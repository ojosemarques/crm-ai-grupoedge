# Testes, rollout e operação

Gate A: docs completos, decisão de identidade/crédito/coorte/permissão consistente e matriz do plano. Gate B: testes de filtros, idempotência, fatos/saldos e identidade. Gate C: UI/logs/servidor/atualização. Gate D: checks, main, deploy e smoke real. Não promover apenas por HTTP 200 de login.

Comandos oficiais: pnpm lint; pnpm typecheck; pnpm test; pnpm test:integration; pnpm test:e2e; pnpm build; pnpm security:scan. Primeiro dirigir integração a metrics/commercial-metrics, intake, activities/meetings/forms. Testes usam PostgreSQL local e schemas efêmeros validados pelo executor; nunca produção. Se replay histórico da cadeia falhar, registrar erro e usar ensaio isolado da mudança, sem alterar migrations anteriores.

Matriz: cenário 30/10/5/5/3/4; datas cruzadas, transferências, pessoa compartilhada confirmada/ambígua, replay/concorrência, tarefa manual/bulk, notas/canais, separação de pipeline, coortes, vazios/custos, OWN/TEAM/WORKSPACE, IDs/cursores de outro tenant, navegação/refresh/retomada/filtros. Comparar baseline para falhas antigas; não desabilitar teste.

Alvo registrado: GitHub origin confirmado; Vercel projectId local prj_XIAyc00k7rXhbpVDVqsdpeBVJiIF / team_2KDCjoyS40i1b48dnlCkrjvM; GitHub status do baseline aponta deployment 4gCRteFENhxT3Yp6z2FDqfQFRG4a/grupo-edge-crm. MCP retorna 404 e listagem só permite hub. Esse hub não é alvo alternativo. Resolver acesso legítimo e confirmar domínio/banco/worker antes de publicação; não criar outro projeto.

Antes do efeito: registrar alvo, SHA, ação/impacto/risco e rollback. Commit apenas arquivos próprios, sem git add indiscriminado; verificar main remota atual e estado combinado; push autorizado pelo pedido. Integração Git aciona produção: verificar projeto e gates primeiro. Sem migrations/backfill, rollback por versão anterior; se houver dados, spec 08 governa recuperação.

Smoke read-only: deployment READY e SHA; domínio correto; login existente; três visões autenticadas, filtros e evidências, cobertura/custos, refresh e logs sem falhas novas. Worker já recebe versão pelo cron Vercel /api/internal/worker/tick; confirmar na configuração real. Sem sessão de teste autorizada, declarar precisamente cobertura que faltou e não simular êxito.

## Ambiente confirmado e baseline reproduzido

CLI Vercel 59.16.0 autenticada confirmou grupo-edge-crm/prj_XIAyc00k7rXhbpVDVqsdpeBVJiIF, equipe Grupo Edge, origin e productionBranch main. Domínio verificado: crm-ai-grupoedge.vercel.app. Supabase confirmado: CRM POLITIZAI/zbzztpzviyjxpprqcegs, database postgres, schema crm, workspace politizai. A CLI não extrai Secrets de produção; não usar defaults locais como suposta evidência remota. Inspeção do banco feita pelo conector Supabase em leitura.

Baseline 536c860 reproduzido em /private/tmp com schema isolado: mesmo conjunto ampliado de seis suítes = 59 aprovados/3 falhas. Falhas: expectativa antiga de nove etapas em reuniões (há Proposta/Cliente), fixture unificada seleciona histórico inexistente e reconciliação comercial contaminada pelo estado deixado por reuniões. commercial-metrics isolada passou 9/9. Não enfraquecer controles nem reescrever testes antigos para ocultá-las. Nova suíte deve criar workspace próprio para não introduzir contaminação.
