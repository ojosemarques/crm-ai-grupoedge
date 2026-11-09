# 09 · Validar o produto integrado e a versão em produção

## Dependências

Aceite da etapa 08 ou pendência factual isolada e bloqueada.

## Escopo e integração

Rodar checks do projeto e gate `.github/workflows/release-gate.yml`, verificar main, migrations, worker, perfis e domínio. Exercitar escrita em ambiente isolado.

## Contratos e permissões

Smoke real autenticado percorre Pipeline, Clientes, Recebíveis, Comissões, Métricas Metas, Meu OTE e Anúncios. Validar isolamento, privacidade pública, desempenho operacional e regressões financeiras.

## Cenários e aceite

- [ ] Resultados registrados com SHA, comandos e evidências redigidas. Toda lacuna de dado ou infraestrutura tem responsável e impacto. Deploy confirmado na fonte.

## Migração, reversão e verificação em produção

Confirmar ordem schema/app/jobs e rollback antes de publicar. Preservar baixas legítimas.

## Evidência de preparação

Na base local `1283c6d`, passaram 1.258 testes unitários em 231 arquivos, lint e verificações direcionadas de TypeScript. Em PostgreSQL descartável, a base de 121 migrations foi aplicada ao schema `crm` e atualizada com as oito migrations desta entrega. A atualização deixou a política sem registros e confirmou leitura/inserção de snapshots para runtime, sem atualização de snapshots pelo runtime nem leitura por `anon` ou `authenticated`.

Na produção, a leitura do histórico Prisma encontrou 77 de 121 migrations da base registradas e nenhuma tabela de políticas desta entrega. A primeira migration ausente no histórico cria um tipo e uma coluna que já existem em produção. Esse conflito inviabiliza executar a cadeia completa de forma segura. O caminho de publicação precisa verificar os pré-requisitos reais e aplicar as migrations desta entrega com os arquivos canônicos, preservando o histórico das 44 migrations anteriores fora do escopo. A validação descartável cobre a atualização e os grants, mas não certifica a cadeia histórica de produção.

O preflight em produção confirmou as oito tabelas de pré-requisito, quatro chaves compostas e quatro roles esperadas. O comando `node --import tsx scripts/run-commercial-compensation-migrations.ts` usa `DIRECT_URL` de sessão TLS, compara os checksums dos 77 registros e executa `prisma migrate status` com uma pasta temporária contendo os arquivos registrados e os oito da entrega. O modo de aplicação exige `--apply` e a impressão digital da prévia. Nenhuma migration histórica ausente entra no plano.

O projeto Vercel vinculado é `grupo-edge-crm`, com produção em `main` e domínio `crm-ai-grupoedge.vercel.app`. O deployment anterior foi confirmado como `READY` no SHA `1283c6d`. Os endpoints `/api/health`, `/api/ready` e `/login` retornaram 200 antes da mudança.

Antes da mudança, foi verificado um backup privado da estrutura das tabelas afetadas, sem cópia de registros de produção. O Prisma aplicou as oito migrations aditivas e o status seguinte mostrou 85 registros no conjunto isolado e zero pendências. A leitura posterior confirmou a política vazia, nenhuma obrigação e ausência de acesso público às tabelas privadas. O commit `8a79491` foi publicado na `main` e iniciou o deploy automático. [Release Gate](https://github.com/ojosemarques/crm-ai-grupoedge/actions/runs/42641770636).

O deployment de `8a79491` ficou `READY` e foi confirmado como alvo ativo do domínio canônico. Após o deploy, saúde, prontidão com banco e login responderam 200. Financeiro e Meu OTE retornaram 401 nas APIs sem sessão. Clientes e Métricas Metas redirecionaram para login. A página pública de Anúncios respondeu 200 sem campos de remuneração ou evidência privada. Em uma sessão autenticada, Financeiro e Métricas Metas carregaram e mostraram a política desativada. Outros perfis ainda precisam de smoke.

O Release Gate de `8a79491` falhou por vulnerabilidades altas e críticas em Next.js e Zod. A comparação do manifesto e do lockfile confirmou que as mesmas versões já estavam na base anterior. A correção fixa Next.js e ESLint do Next em `16.4.1` e Zod em `4.6.6`, inclusive nas referências transitivas a `4.6.1`. O lockfile foi regenerado pelo pnpm. A auditoria `pnpm audit --audit-level=high` retornou sucesso, com dois avisos baixos e cinco moderados. A reversão dos manifests e lockfile pelo commit de correção repõe as versões vulneráveis. [Next.js](https://github.com/advisories/GHSA-2464-fhr4-w9xw) · [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

O Next.js atualizado passou no build após substituir as três rotas de fechamento dos modais por páginas de slot no segmento raiz. Passaram também os cenários Chromium de Pipeline e Financeiro. O executor local retornou erro após os testes ao limpar o schema descartável por falta de locks compartilhados no PostgreSQL. A limpeza é independente dos resultados do build e dos dois cenários.

A correção de segurança entrou na `main` no commit `b8ec48c`. [Release Gate da correção](https://github.com/ojosemarques/crm-ai-grupoedge/actions/runs/42647008934). O smoke autenticado como administrador percorreu Anúncios, Clientes, detalhe e parcelas, Recebíveis, Comissões, Métricas Metas e Meu OTE. O perfil de administrador sem plano próprio mostrou o estado vazio esperado. A suíte de 24 testes de fechamento passou com o aumento do limite de locks no PostgreSQL descartável.

A Vercel confirmou `b8ec48c` como deployment `READY` e alvo do domínio canônico. Saúde, prontidão, login e a página pública de Tempo Real retornaram 200. As APIs de Financeiro, OTE e o tick do worker retornaram 401 sem sessão ou credencial. O HTML público conferido não continha campos de remuneração. As integrações adjacentes passaram em schemas separados com cinco testes de Financeiro, oito de OTE e 14 de Pagamentos.

A suíte transversal Chromium passou com 15 cenários de venda direta, Financeiro, OTE e Tempo Real em um mesmo banco descartável. A política e o plano sintéticos do Financeiro são limpos ao fim do cenário. O teste de OTE usa um vendedor separado das vendas diretas. A data sintética da semana anterior fica distinta de ontem também às segundas-feiras. A integração de frentes do Tempo Real passou no schema separado.

A Vercel confirmou `60e9414` ativo no domínio canônico. O Release Gate dessa versão falhou em cinco testes unitários do Meu OTE. O banco simulado não implementava a consulta de títulos históricos que a tela passou a executar. A correção inclui a consulta simulada e verifica que ela usa o workspace e o vendedor da sessão. [Gate de 60e9414](https://github.com/ojosemarques/crm-ai-grupoedge/actions/runs/42649275008)

O release `284db0c` passou no gate e foi confirmado como ativo no domínio canônico. Após ativar a política, o worker gravou snapshots de dia, semana e mês. A sessão administrativa conferiu Comissões de outubro com as etapas em revisão e Métricas Metas de novembro com dois closers, rampa comprovada e metas de Anúncios. A API pública de Anúncios respondeu 200 sem campos de remuneração. As APIs privadas de Financeiro e Meu OTE responderam 401 sem sessão. [Release Gate aprovado](https://github.com/ojosemarques/crm-ai-grupoedge/actions/runs/42650580022).
