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
| M6 | integração e publicação em andamento | verificar resultados finais e produção abaixo antes de concluir |

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
