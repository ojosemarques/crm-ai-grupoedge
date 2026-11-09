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
