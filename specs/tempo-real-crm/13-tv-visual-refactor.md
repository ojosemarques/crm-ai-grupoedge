# Refatoração visual do painel de TV — 22/10/2026

## Aceite

- Reproduzir as duas composições fornecidas: leaderboard carvão/menta (imagens 1 e 2 idênticas) e painel branco com moldura azul (imagem 3).
- Ranking com resumo, contagem regressiva da semana, três cards de pódio, medalha dourada e tabela. Painel claro com indicadores, fluxo de atividade, gráfico circular, série diária e pódio.
- Remover o shell administrativo apenas na rota exata `/tempo-real`, mantendo autenticação e autorização no servidor. Navegação compacta própria, tela cheia, pausa e alternância manual/automática.
- Usar dados canônicos reais. Nomes, valores e rótulos representam o CRM; não inserir usuários, fotos, metas ou séries fictícias das referências.
- Manter compartilhamento revogável, polling sem sobreposição, estado de conexão e proteção do bearer.
- Layout legível e sem cortes em 1920×1080 e 1366×768; adaptação móvel e reduced-motion.
- Validar domínio, shell, TypeScript/lint/build, E2E autenticado/público e capturas reais. Publicar na main e verificar o artefato de produção.

## Execução

1. Layout e componentes visuais das duas referências.
2. Série diária de segunda a sexta e fim da semana no DTO, derivados dos fatos já carregados.
3. Controles de apresentação, foco e compartilhamento.
4. Verificação visual e funcional; commit/push; CI/deploy e smoke de produção.

## Limites e rollback

Sem dependências ou migrações novas. O DTO acrescenta somente agregados diários já presentes no escopo semanal. Rollback por revert do commit e promoção do deployment anterior; recarregar os navegadores das TVs ao reverter o contrato da API.

## Evidências

- 184 arquivos / 902 testes unitários aprovados no estado integrado; domínio e shell: 23 testes dirigidos.
- Lint completo, TypeScript, scanner de secrets e build de produção aprovados.
- `pnpm test:e2e -- tests/e2e/realtime-dashboard.spec.ts`: 2 testes aprovados em 6,7 s sobre o artefato compilado, com schema efêmero e 114 migrations desde zero. O schema foi removido ao final.
- QA em Chromium com fixture isolada preenchida: 1920×1080, 1366×768 e 390×844, incluindo limites internos de tabela/pódio e ausência de sobreposição entre painéis.
- Equipe de 32 profissionais verificada com quatro linhas por página, pausa e continuação da paginação entre ciclos de slide.
- Descoberta no QA: primeira requisição abortada pelo Strict Mode atrasava a montagem; cleanup agora libera a referência imediatamente e respostas abortadas não atualizam o estado.
- Projeto Vercel confirmado pela CLI: `prj_XIAyc00k7rXhbpVDVqsdpeBVJiIF`, `grupo-edge-crm`, equipe Grupo Edge, Node 22, Next.js. O conector retornou 404 para esse escopo; fallback CLI autenticado.
- Capturas com fixture são evidência de layout, não de resultados comerciais de produção.
- Fluxo autenticado/público verificou criação pela interface, tela cheia, pausa por 61 s, ciclo de 60/120 s, suspensão durante o compartilhamento, reset do contador, proteção da rota privada e revogação refletida sem reload.
- Falha transitória preserva o placar com aviso; retomada recupera `Ao vivo`. Um 404 público limpa os dados revogados.
- A primeira rodada integrada encontrou um erro temporário em Formulários, alterado simultaneamente fora deste escopo. A correção entrou em `125f1f8`; o build e E2E finais validaram a base combinada, sem copiar ou descartar alterações alheias.

## Produção

- Commit técnico publicado na `main`: `138f7e5c1f0f42589de104aef7ff7b7ca9b95bc8`.
- Deployment `dpl_3Sk7Y8o9VLJA3TrwrAGHL3KfokK8`, URL `https://grupo-edge-htkjharpm-ejosemarquess-gmailcoms-projects.vercel.app`, estado `Ready`, com alias canônico `https://crm-ai-grupoedge.vercel.app`. Build 2m46s + 23s pós-build.
- Smoke autenticado real: rota privada anônima 307; login e API privada 200; série diária com cinco dias; duas telas renderizadas com dados do CRM e sem shell administrativo.
- TV pública em 1366×768: página 200 com `no-referrer`; ciclo Ranking → Desempenho em 60s; três leituras observadas; máximo de uma requisição simultânea; revogação refletida sem reload; zero erros de navegador; zero compartilhamentos ativos ao final no workspace testado.
- Capturas locais, sem versionar dados comerciais: `.cache/realtime-tv-production/{ranking,desempenho}-1920x1080.png` e `.cache/realtime-tv-production/publico-{ranking,desempenho}-1366x768.png`.
- Logs de erro do deployment filtrados por `*tempo-real*`: zero registros na janela de 22/10/2026 14:10–14:25 UTC.
- CI do commit técnico: `https://github.com/ojosemarques/crm-ai-grupoedge/actions/runs/39794431587`. O próprio run preserva o resultado do Quality gate, o relatório e o SBOM associados ao SHA técnico.
