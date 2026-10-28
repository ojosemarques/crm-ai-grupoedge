# Estado da execução

Pedido: specs, implementação, validação e produção diretamente na main. Baseline 536c860; entregas concorrentes de marketing/Meta preservadas. Os documentos preexistentes e arquivos dessa outra entrega ficam fora do commit.

| Marco | Estado | Evidência |
|---|---|---|
| M0 | especificado e revisado antes do código | specs 00–10 e decisões atualizadas pelos ensaios |
| M1 | implementado e testado | três rotas fixas, filtros de frente/pipeline/etapa/formulário/canal/pessoa/origem; períodos 7/30; retorno com instantes exatos |
| M2 | implementado e testado | participações separadas, Contact confirmado, review de ambiguidade, replay e histórico autorizado |
| M3 | implementado e testado | timeline comum paginada; criação manual e bulk auditáveis |
| M4 | implementado e testado | cenário 30/10/5/5/3/4; coortes, duração/amostras/ausências; servidor impede closer de agendar Anúncios |
| M5 | implementado e testado | duas sessões no navegador atualizam sem reload; classificador append-only idempotente com cutoff |
| M6 | núcleo publicado, dados reconciliados e smoke administrativo conferido; rollout do ajuste final acompanhado até READY | adendos finais e SHA/deployment confirmados na entrega |

## Validação local

- Unitários completos: 210 arquivos, 1117 testes aprovados no estado combinado de trabalho; inclui mudanças concorrentes de Meta, excluídas deste commit.
- Lint: exit 0, sem erros/warnings. Typecheck/build foram corrigidos e reexecutados após a descoberta de outcome REJECTED no enum histórico.
- Integração da entrega: 7 cenários novos aprovados, incluindo SQL exato de classificação/grant, imutabilidade, saldo financeiro, OWN e bloqueio no agendamento/board. Rodada combinada inicial: 5 arquivos/41 testes aprovados; rodada final menor: 4 arquivos/27 aprovados.
- Regressão adicional de reuniões/entradas/formulários: 54 aprovados, 1 falha preexistente na expectativa de nove etapas (estrutura atual tem onze).
- E2E/build finais: duas verificações Chromium aprovadas (25 s), três rotas, modo fixo, mobile 390px sem overflow, histórico das duas frentes e atualização entre sessões com replay idempotente.
- Suíte oficial completa de integração executada: conjunto principal 89 arquivos, 68 aprovados/21 com falhas; 505 testes aprovados/24 falhos/24 skipped. Baseline 536c860 reproduzido desde zero: 88 arquivos, 67 aprovados/21 com falhas; 499 aprovados/23 falhos/24 skipped. Suítes extras isoladas passaram em ambos. Há contaminação de fixtures/ordem, bootstrap que exige banco vazio e expectativas antigas. O contrato alterado de identidade em entry-automations foi atualizado e passou no teste dirigido; não foram desabilitados testes.
- Falhas variáveis de reconciliação e fixtures foram investigadas em recortes isolados; commercial-metrics isolado passou 9/9 no baseline. Os resultados globais não são anunciados como verdes.
- Scanner oficial deve ser reexecutado sobre o índice contendo os arquivos novos da entrega antes do commit.

## Produção e recuperação

Alvo: Vercel grupo-edge-crm/prj_XIAyc00k7rXhbpVDVqsdpeBVJiIF, equipe Grupo Edge/team_2KDCjoyS40i1b48dnlCkrjvM, produção main, domínio crm-ai-grupoedge.vercel.app. Supabase CRM POLITIZAI/zbzztpzviyjxpprqcegs, postgres/crm, workspace politizai/f99613d9-f4a1-449e-a19f-ed9ec3d46105. Worker Vercel usa a mesma versão no cron /api/internal/worker/tick.

Backup físico confirmado pela CLI Supabase: COMPLETED, id 2094133279, 2026-10-28T06:38:42.846Z; sete cópias anteriores disponíveis; PITR desabilitado. Nenhum restore destrutivo foi executado. Recuperação específica ensaiada em schema isolado: originais/fingerprints preservados, par de correção com saldo global invariável, idempotência e rollback de código compatível.

Dry-run com cutoff 2026-10-28 16:00:56.978776+00: 30.983 fontes elegíveis (25 Anúncios, 30.958 Prospecção), inclusive duas vendas. Snapshot anterior: 54.343 fatos, quantity 54.197 e soma valueCents 21.325.000 (soma técnica de tipos diferentes, não receita); hash SHA256 das linhas originais d06010d7e2b64fc72b71e707ef10c5d71b0311876468bbbad17c19f4d071d1a7. Originais não serão alterados; lotes <=500, auditoria e reconciliação por fonte. Plano anti-join read-only em 54 mil fatos: 56 ms, sem índice/migration especulativo.

Sessão administrativa existente encontrada no navegador Dia. Nenhuma credencial foi extraída e nenhum usuário/sessão foi criado. Publicação, grant OWN, aplicação histórica e smoke autenticado ainda aguardam execução neste checkpoint; registrar evidências finais em adendo.

## Snapshot exclusivo da release antes da integração

Índice separado com 70 arquivos próprios sobre abc4319, sem arquivos novos/alterados da entrega concorrente. Snapshot em /private/tmp; nenhum secret copiado para Git. Unitários completos: 210 arquivos/1113 testes aprovados. Integração dirigida: 5 arquivos/36 testes aprovados (commercial-fronts, commercial-metrics, advertising-workspace, lead-intake, entry-automations). Scanner oficial: aprovado, 1898 arquivos rastreados. Build e dois testes Chromium aprovados; essa cópia temporária inicialmente resolveu Node 24 e emitiu aviso de engine, então o typecheck e a validação final serão conferidos com PATH fixado no Node 22 exigido. No workspace original, build/E2E já passaram com Node 22. Revisão dos 70 arquivos não encontrou bloqueio de correção/segurança pendente. Suíte global de integração mantém limitações anteriores documentadas acima.

Correção final comprovada por teste vermelho/verde: uma ocorrência anulada por quantidade negativa deixa de integrar pessoas/atribuições/coortes distintas e seu drilldown, preservando os fatos de origem. Após o ajuste: 1114 unitários e 36 integrações aprovados no snapshot; build e dois E2E Node 22 aprovados (24,6 s); scanner aprovado. Typecheck Node 22 aprovado. Base main avançou para 7810c3e por alterações independentes de Meta em nove arquivos, inspecionadas e preservadas; a composição final recebe unidade/typecheck/lint antes do commit.

## Resultado da publicação e reconciliação de produção

- Commit funcional bfd33cbfc3dc52d31d9ada6e2962ca6aba464320 integrado na main; deployment dpl_ALuN87wmKMSY2cg8JM91Euc7utFS READY com alias crm-ai-grupoedge.vercel.app confirmado pela API Vercel. Sem migration física.
- Grant persistido: exatamente um metrics.read OWN para closer e uma auditoria; scope conferido novamente após a carga. Outros grants preservados.
- Classificação concluída: 30.983 fontes, 62 lotes de até 500, 61.966 linhas aditivas. Advisory lock, seleção/conferência de contagem no lote, cutoff fixo, chaves idempotentes e auditorias por lote. O conector SQL usou a mesma seleção e o SQL versionado do produtor, com checkpoint por UUID; nenhuma credencial de produção foi extraída.
- Reconciliação final: 0 fontes elegíveis restantes e 0 fontes com par/saldo divergente; 62 auditorias somam 30.983 fontes. Originais continuam 54.343, com o mesmo hash d06010d7e2b64fc72b71e707ef10c5d71b0311876468bbbad17c19f4d071d1a7. Saldos técnicos do snapshot permanecem quantity=54.197 e valueCents=21.325.000; estes totais misturam tipos e não são receita. Nenhum UPDATE/DELETE de fato, lead ou contato.
- Consulta efetiva após a carga: Hash Join/anti-join, 54.379 linhas efetivas, 284,693 ms de execução/3,14 ms de planejamento no EXPLAIN ANALYZE. Não foi criado índice especulativo.
- Smoke administrativo no Dia: as três visões carregaram com títulos e navegação exclusivos; Anúncios exibiu 19 entradas e seu drilldown abriu 19 evidências, mantendo modo, pipeline e instantes exatos no retorno. Prospecção mostrou custo de mídia não aplicável. Cobertura parcial e identidades sem vínculo confirmado aparecem explicitamente; não houve fusão histórica. Custo de Anúncios usou os fatos confirmados que já existem no módulo de mídia, em moedas separadas.
- Atualização: E2E comprovou alteração por outra sessão sem reload, replay sem nova entrada e filtros preservados. Em produção foram observados GETs adicionais 200 para /dashboard/prospeccao, sem navegação manual adicional no intervalo; isso comprova requisições automáticas, mas não estabelece SLA externo de 15s. O componente espera 15s e evita sobreposição; a duração do servidor integra a convergência. Escritas sintéticas permaneceram somente no banco local.
- Logs consultados do deployment: nenhum registro de erro dos dashboards/worker; houve um registro de nível error em /api/auth/login com HTTP 200, sem detalhes pessoais reproduzidos. A navegação autenticada funcionou. A consulta de logs não substitui monitoramento contínuo.
- Não foram instalados MCPs de Meta, criadas cadências/campanhas nem enviadas comunicações por esta entrega. Integrações e alterações concorrentes foram preservadas.

## Rodada ampla final e ajuste de compatibilidade

No snapshot final, a suíte ampla teve 19 arquivos com falhas/70 aprovados no conjunto principal, 511 testes aprovados/33 falhos/10 skipped. O conjunto isolado copilot-actions teve 16 aprovados/2 falhos; demais conjuntos isolados passaram. Os 7 cenários novos passaram dentro da rodada ampla. Não considerar a suíte completa verde.

A rodada expôs uma regressão própria: from/to explícitos eram validados, mas mantinham datas/preset do mês corrente para comparação. O ajuste normaliza para CUSTOM e deriva datas civis dos mesmos instantes no fuso do workspace, rejeitando limite sem o outro. Após o ajuste: copilot-actions + commercial-fronts = 2 arquivos/25 testes aprovados; build e dois E2E Node 22 aprovados (23,1s); 210 arquivos/1119 unitários aprovados e lint sem avisos. O último rollout de main inclui esse ajuste; seu SHA/deployment final são confirmados na entrega da execução.

Demais falhas da rodada ampla: cadeia/fixtures antigas já reproduzidas no baseline, expectativas de nove etapas versus onze, contagens antigas de grants, schema estrito do manager-copilot incompatível com o DTO anterior e buscas aleatórias de formulário. Esta última foi reproduzida no baseline 536c860 fixando apenas o telefone sintético da fixture em 87661154: a busca que contém o dígito 1 encontra o telefone e contradiz a expectativa zero. O código do baseline não foi alterado; a fixture temporária foi restaurada depois do ensaio. Não desabilitar testes nem alterar serviços alheios para mascarar essas falhas.

Limites de cobertura: smoke de produção administrativo; OWN/TEAM/WORKSPACE, negações e transferência foram ensaiados localmente. Não se usou a sessão real de outro funcionário para simular seu perfil. Fontes históricas sem intervalo comprovado continuam com cobertura parcial, por decisão explícita de não fabricar atribuição.

## Fechamento do filtro de canal

O aceite dirigido demonstrou uma lacuna nos gráficos legados: ao selecionar EMAIL, 30 leads permaneciam no universo em vez do único lead com fato nesse canal. Teste vermelho reproduzido; correção adiciona interseção por IDs agrupados de fatos canônicos autorizados no período, com saldo positivo e limite 50 mil, sem ampliar visibilidade. Após: métricas/fronts/ledger 3 arquivos/30 testes aprovados; Copilot isolado 18/18; 1119 unitários aprovados; lint, build Node 22 e dois E2E aprovados (24s). Misturar as fixtures Copilot/metrics produziu uma falha de SLA ausente, enquanto a suíte oficial isolada do Copilot passou. Não mascarar essa dependência de ordem.

O ajuste de período 2bf070b72492a8af1f61e1aa489498eed125d0ef também chegou a READY no domínio. O commit de fechamento inclui o ajuste de canal e preserva as entregas concorrentes publicadas de aquisição/Meta. A prova do deployment final acompanha a resposta final da execução; as mudanças de dados e reconciliações acima permanecem válidas, sem outra carga necessária.
