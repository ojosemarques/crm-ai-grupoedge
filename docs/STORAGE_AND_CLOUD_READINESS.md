# Armazenamento e prontidão para nuvem — PROD-01

## Resultado local da execução inicial

O código foi preservado em `Menddon/crm-politizai`, repositório GitHub privado,
branch `main`. Nenhum deploy, Vercel, Neon ou banco remoto foi usado. O dump do
banco permanece somente no diretório local ignorado `.backups/`.

Antes da limpeza, o checkout ocupava aproximadamente 1,9 GB: 1,2 GB em
`node_modules`, 697 MB em `.next` e cerca de 36 MB de código/artefatos menores.
O banco tinha 1.527 MB e o volume PostgreSQL ocupava aproximadamente 1,6 GB. O
schema `public` representava cerca de 31 MB; o restante vinha principalmente de
schemas de validações antigas.

## O que foi removido na execução inicial

Somente 58 schemas cujo nome aparecia literalmente em executores ou em
`docs/EXECUTION_STATUS.md` foram removidos. O banco caiu de 1.527 MB para 971
MB sem mudança nas contagens de `public`. A estimativa inicial por catálogo
somava índices/toast duas vezes; por isso, o espaço efetivo é a diferença real
do banco/volume, e não aquela soma inflada.

Schemas removidos:

```text
crm02_integration, crm07_final, crm08_final2, crm09_final, crm09_final2,
crm10_final2, crm11_final, crm12_e2e, crm12_final, crm12_final2,
crm13_e2e2, crm13_final, crm13_final4, crm14_e2e1, crm14_full1,
crm15_e2e, crm15_e2e_final, crm15_final, crm16_e2e, crm16_e2e_final,
crm16_final, crm16_migration_retry, crm18_e2e, crm18_e2e_full,
crm18_queue_isolated, crm18_target, crm19_full1, crm19_target2,
crm20_e2efull1, crm20_full1, crm21_final, crm21_final2, crm22_final,
crm22_final4, crm23_final, crm24_directed_final, crm24_e2e, crm24_e2e_b,
crm24_full, crm24_full_final, crm25_final1, crm25_full1, crm25_full2,
crm26_e2e, crm26_final, crm27_checkpoint, crm28_integration_final,
crm28_integration_final2, crm28_prod_final, crm28_prod_regression,
politizai_crm30_integration_test, politizai_demo_crm29_test,
politizai_demo_crm30_e2e, politizai_demo_reset_validation,
politizai_design02_e2e, politizai_design03_e2e,
politizai_design03_integration, politizai_design04_integration
```

Depois do gate completo, foram removidos exclusivamente os 676.632 KiB de
`.next` e os relatórios regeneráveis deste checkout. `.next` volta com
`pnpm build`; relatórios voltam ao executar Playwright/Vitest. Nenhum build foi
executado depois da remoção final.

## O que foi preservado na execução inicial

- `public`, IDs, histórico, auditoria, migrations e todas as tabelas comerciais;
- volume `politizai-crm_postgres_data` e banco `politizai_crm`;
- `node_modules`;
- 82 schemas que naquele momento ainda não possuíam segunda evidência
  documental; eles foram investigados e removidos somente na revalidação após
  a CRM-38 descrita abaixo;
- código-fonte, migrations, assets e configurações locais necessárias;
- backup lógico validado.

Esses 82 schemas foram preservados corretamente na execução inicial: o prefixo
sozinho não era prova. A investigação posterior correlacionou conteúdo,
migrations, horário e origem antes de adicioná-los individualmente à allowlist.

## Medição final da execução inicial

| Item | Antes | Depois | Observação |
|---|---:|---:|---|
| Checkout | 1.920.524 KiB | 1.243.888 KiB | redução de 676.636 KiB na remoção final |
| `.next` | 676.632 KiB | ausente | regenerável por `pnpm build` |
| `node_modules` | 1.209.744 KiB | 1.209.744 KiB | preservado |
| Banco `politizai_crm` | 1.527 MB | 971 MB | 58 schemas comprovados removidos |
| Volume PostgreSQL | aproximadamente 1,6 GB | 1.331.544 KiB | volume preservado |
| Espaço livre na remoção final | 15.747.024 KiB | 16.406.200 KiB | ganho observado de 659.176 KiB |
| Backup de `public` | inexistente | 1.495.503 bytes | local, validado e ignorado pelo Git |

O banco terminou com zero schemas do padrão efêmero `politizai_test_*`. Os 82
schemas sem evidência documental suficiente foram deliberadamente preservados.
As diferenças entre a redução lógica de `.next` e o espaço livre observado são
compatíveis com alocação e contabilização do APFS. O espaço recuperado no banco
é medido pela queda de 1.527 MB para 971 MB; a medição inicial do volume havia
sido coletada em granularidade arredondada.

## Revalidação de 12 de setembro de 2026

Após a CRM-33, o checkout começou a revalidação com 1.250.484 KiB, dos quais
1.209.744 KiB pertenciam a `node_modules`; `.next` já estava ausente. O banco
ocupava 1.021.032.115 bytes, o volume Docker era reportado como 1,246 GB e o
disco possuía 17.425.060 KiB livres. A diferença em relação à medição histórica
decorre da migration e dos dados canônicos posteriores, preservados nesta task.

O gate criou 519.948 KiB de `.next` e 4 KiB de `test-results`. Ambos foram
removidos ao final por caminhos absolutos previamente validados e não simbólicos.
O checkout terminou com 1.252.000 KiB, incluindo o novo backup; `node_modules`
continuou com 1.209.744 KiB. A remoção final recuperou 191.808 KiB de espaço
livre observável imediatamente no APFS (de 16.611.996 para 16.803.804 KiB),
embora tenha eliminado 519.952 KiB lógicos do checkout. Comparado ao início da
revalidação, o espaço livre global ficou 621.256 KiB menor por atividade de
build, testes e armazenamento do sistema fora do checkout; nenhum cache ou
volume de outro projeto foi apagado para mascarar essa variação.

O banco terminou com os mesmos 1.021.032.115 bytes, 74 tabelas, 25 registros de
migration, 528 leads, 146 usuários, 18 equipes, 1.162 atividades, 59
oportunidades e 3.170 logs. O volume foi reportado como 1,229 GB e permaneceu
montado. O dry-run encontrou zero candidatos; os 82 schemas legados continuam
preservados por falta de segunda evidência, e não restou schema
`politizai_test_*`. O backup novo tem 1.834.456 bytes e foi restaurado com
sucesso em banco local temporário já removido.

## Revalidação após a CRM-35

Em 12 de setembro de 2026, a PROD-01 foi novamente autorizada quando `main`
local e remota apontavam para `03563db2231bf2343c4eeced1d3d9b732dec461f`.
O GitHub CLI confirmou `Menddon/crm-politizai` como `PRIVATE`. Alterações
locais incompletas de uma task posterior foram preservadas na branch privada
`safety/crm36-pre-prod01-20260912`; elas não foram incluídas em `main` nem
executadas pela PROD-01.

O novo backup exclusivo de `public` possui 2.348.631 bytes, checksum
`9300e0fb23c3bd201ace730a0052207253b17d1ff85d28cb235a20efc76eb001` e
restauração de ensaio aprovada. A validação reconciliou 89 tabelas, 26
migrations concluídas, 531 leads, 146 usuários, 18 equipes, 1.183 atividades e
59 oportunidades. O login do smoke test acrescentou somente um fato append-only
ao `audit_logs`, que passou de 3.216 para 3.217; os fingerprints de Lead,
Activity e Opportunity permaneceram idênticos.

O dry-run continuou com zero candidatos removíveis, zero schema
`politizai_test_*` e 82 schemas legados preservados por falta de segunda
evidência. Como `.next` e os relatórios regeneráveis já estavam ausentes no
checkout principal, nenhuma remoção adicional foi necessária. `node_modules`,
o volume PostgreSQL, `public` e todos os dados comerciais foram preservados.

| Item | Início da revalidação | Final | Leitura correta |
|---|---:|---:|---|
| Checkout principal | 1.270.524 KiB | 1.273.112 KiB | aumento de 2.588 KiB pelo backup e documentação |
| `node_modules` | 1.209.744 KiB | 1.209.744 KiB | preservado |
| Código e metadados fora de dependências/backups | não recalculado | cerca de 35.104 KiB | exclui `.git`, `.backups`, `.next` e `node_modules` |
| `.next` no checkout principal | ausente | ausente | nenhum build foi feito depois da limpeza final |
| Banco `politizai_crm` | 1.026.217.651 bytes | 1.026.274.995 bytes | variação do smoke test autenticado, sem remoção comercial |
| Schema `public` | 28.524.544 bytes | 28.524.544 bytes | preservado |
| Volume Docker | 1,218 GB | 1,185 GB | volume preservado; valor reportado pelo Docker após atividade local |
| Espaço livre do disco | 16.277.016 KiB | 17.021.060 KiB | ganho observado de 744.044 KiB após remover o checkout temporário de validação |

Não foi atribuído espaço recuperado a schemas nesta revalidação: nenhum
candidato atendia a allowlist. O ganho global observado veio da remoção do
ambiente temporário criado para validar o commit limpo, não de `public`, do
volume ou de dependências do checkout principal.

## Revalidação após a CRM-36

Em 12 de setembro de 2026, `main` local e remota apontavam para
`b10f8865cbe7638e1ec0d6f9645ae6919f75deb3`; o GitHub CLI confirmou a conta
`Menddon` e o repositório `Menddon/crm-politizai` como `PRIVATE`. Alterações
locais parciais de uma tarefa posterior foram preservadas em stash de segurança
durante os gates e não foram incluídas na PROD-01.

O checkout iniciou com 1.308.904 KiB, incluindo 1.209.744 KiB de
`node_modules`, 19.424 KiB de backups e `.next` ausente. O banco tinha
1.029.052.083 bytes, `public` tinha 106 tabelas e o volume era reportado como
1,187 GB pelo Docker. O dry-run e a confirmação de manutenção encontraram zero
candidatos removíveis e preservaram os 82 schemas legados sem segunda evidência;
nenhum schema `politizai_test_*` permaneceu depois dos gates.

O backup atualizado de `public` possui 2.641.918 bytes, checksum
`40b59535564f9f051a116db488ebb9d9cc5395bb6967b31af83d7aedc2f4fbb7` e
restauração de ensaio aprovada. Lint, typecheck, 148 testes unitários, 217 de
integração, quatro CRM-29, 58 E2E de produção, um E2E local, audit, build e
status das migrations passaram. Health, login, dashboard e auditoria
responderam HTTP 200 no banco principal; o login adicionou somente o fato
append-only esperado à auditoria.

Ao final, foram removidos novamente somente os 584.652 KiB de `.next` e os 4
KiB de `test-results` criados pelos gates. O checkout limpo de validação ficou
com 1.281.916 KiB, `node_modules` permaneceu com 1.209.744 KiB e os backups
locais totalizaram 22.004 KiB. O banco terminou com 1.029.093.043 bytes após o
AuditLog legítimo do smoke test; o volume foi reportado com 1,17 GB e permaneceu
montado.

O espaço livre do APFS passou de 15.352.656 KiB antes dos gates para 14.626.552
KiB depois da limpeza final. Portanto, esta revalidação não reivindica ganho
líquido global: caches e armazenamento do sistema/Docker cresceram durante os
testes, embora 584.656 KiB regeneráveis tenham sido eliminados do checkout.
`node_modules`, `public`, o banco e o volume PostgreSQL permanecem preservados.
Nenhum deploy, Vercel, Neon ou banco remoto fez parte desta revalidação.

## Revalidação após a CRM-38 e segundo lote forense

Em 12 de setembro de 2026, o inventário encontrou 82 schemas legados ainda
presentes. Eles não foram selecionados apenas pelo prefixo: cada nome foi
correlacionado com a task/validação indicada, pertencia ao usuário local
`politizai`, continha `_prisma_migrations`, possuía somente tabelas também
existentes no `public`, apresentava a sequência cronológica de migrations da
respectiva fase e não tinha conexão cliente. A allowlist literal em
`src/shared/core/database/test-schema-lifecycle.ts` é o registro canônico dos
nomes removidos.

O dry-run estimou 602.415.104 bytes em 82 candidatos. A execução confirmada
removeu somente esses schemas, em transações individuais. Somados aos 58 do
primeiro lote, 140 schemas legados comprovados foram removidos pela PROD-01.
Ao final não existia schema não sistêmico fora de `public`.

| Item | Antes desta revalidação | Final | Resultado |
|---|---:|---:|---|
| Checkout | 1.598.876 KiB | 1.542.076 KiB | medição após o primeiro push; inclui novo backup e `.next` ausente |
| `.next` | ausente no início; 633.228 KiB após gates | ausente | removido sem novo build posterior |
| `node_modules` | 1.209.780 KiB | 1.209.780 KiB | preservado |
| Banco `politizai_crm` | 1.034.237.619 bytes | 380.630.707 bytes | redução lógica de 653.606.912 bytes |
| Volume PostgreSQL | 1,226 GB | 773,7 MB | volume preservado e montado |
| Schemas removidos | 82 candidatos | 82 removidos | zero candidato residual |
| Backup de `public` | — | 3.083.798 bytes | restaurado em ensaio e checksum validado |
| Espaço livre APFS | 12.824.908 KiB | 12.359.076 KiB | sem ganho líquido global alegado |

A redução do banco e a exclusão lógica de 633.232 KiB de build/relatório são
comprovadas. O espaço livre global caiu 465.832 KiB durante os gates por efeitos
de build, testes, Docker e APFS fora dos artefatos medidos; por isso este
relatório não transforma a redução lógica em um ganho físico fictício.

`public` terminou com 132 tabelas, 31 migrations, 531 leads, 146 usuários, 18
equipes, 1.183 atividades e 59 oportunidades. Os fingerprints de IDs de leads,
atividades, oportunidades e usuários não mudaram. O smoke de login acrescentou
somente um log append-only esperado.

## Revalidação após a CRM-39

A nova autorização encontrou o código já protegido no GitHub privado e o banco
já sem schemas temporários residuais. Portanto, esta rodada não repetiu a
criação do repositório nem apagou schema: confirmou `Menddon/crm-politizai`
como `PRIVATE`, executou dry-run e confirmação com zero candidatos e preservou
`public` integralmente.

| Item | Início | Final antes do commit de medição | Resultado |
|---|---:|---:|---|
| Checkout | 1.562.356 KiB | 1.549.148 KiB | `.next` final ausente; variação observada de -13.208 KiB |
| `.next` | ausente | ausente | 641.808 KiB criados pelos gates e removidos ao final |
| `node_modules` | 1.209.780 KiB | 1.209.780 KiB | preservado |
| Backups locais | 33.700 KiB | 36.788 KiB | novo dump e metadados ignorados pelo Git |
| Código/metadados fora de `.git`, backups, dependências e build | — | 41.306.674 bytes | código-fonte preservado |
| Banco `politizai_crm` | 381.433.523 bytes | 381.433.523 bytes | nenhuma tabela ou dado comercial removido |
| Volume PostgreSQL | 659.161.724 bytes | 608.862.844 bytes | volume preservado; variação física após ensaios e descarte efêmero |
| Schemas removidos nesta rodada | 0 | 0 | somente `public` permaneceu como schema não sistêmico |
| Espaço livre APFS | 13.639.008 KiB | 13.247.132 KiB | sem ganho líquido global alegado após builds/testes |
| Backup novo de `public` | — | 3.154.009 bytes | checksum e restauração aprovados |

A limpeza lógica final eliminou 641.812 KiB regeneráveis (`.next` e relatório
Playwright), mas o espaço livre global terminou 391.876 KiB abaixo do início
por atividade de build, Docker e APFS. O relatório não transforma essa diferença
em ganho fictício. Nenhum diretório de outro projeto, imagem, container, volume,
`node_modules`, Vercel, Neon ou banco remoto foi tocado.

## Revalidação após a CRM-41

A autorização encontrou `main` sincronizada com o GitHub privado e alterações
parciais da CRM-42 no checkout. Para não misturar escopos, o estado parcial foi
preservado no commit privado
`2ef45e56b2f9f04635f46e7a0f82a5d854550053` da branch
`safety/crm42-pre-prod01-20260912-1547`; `main` foi validada separadamente. A
varredura do conjunto versionável não encontrou credencial externa ou chave
privada. `.env`, backups, builds, clientes gerados e relatórios continuaram
ignorados.

Um clone limpo revelou que o typecheck dependia de `next-env.d.ts` gerado em
execução anterior. Conforme a documentação instalada do Next.js 16.3.4, o
arquivo continua ignorado e `pnpm typecheck` agora chama `next typegen` antes de
`tsc`. A correção está em `main` no commit
`e85930a84268b59284d7c66557254b902931c374`, idêntico no remoto.

| Item | Início | Final | Resultado |
|---|---:|---:|---|
| Checkout | 2.431.616 KiB | 1.572.556 KiB | redução de 859.060 KiB no checkout |
| `.next` | 859.480 KiB antes da remoção | ausente | removido; nenhum build posterior no checkout principal |
| `node_modules` | 1.209.780 KiB | 1.209.780 KiB | preservado |
| Código fora de `.git`, backups, dependências e build | 53.645.464 bytes | 53.645.480 bytes | fonte preservada; variação documental mínima |
| Banco `politizai_crm` | 381.531.827 bytes | 381.531.827 bytes | nenhum dado comercial removido |
| Schema `public` | 36.823.040 bytes | 36.823.040 bytes | 147 tabelas e 35 migrations preservadas |
| Volume PostgreSQL | 523,1 MB | 522,8 MB | volume preservado e montado |
| Schemas removidos nesta rodada | 0 | 0 | zero candidato no dry-run e na confirmação |
| Backup novo de `public` | — | 3.166.788 bytes | checksum e restauração aprovados |
| Espaço livre APFS | 11.780.328 KiB | 13.316.280 KiB | ganho observável de 1.535.952 KiB após limpar build e validação temporária |

A cópia temporária de validação ocupava 1.875.404 KiB e foi descartada depois
dos gates. A imagem Alpine baixada exclusivamente para medir o volume foi
removida em seguida; nenhum container, volume ou imagem de outro projeto foi
alterado. O banco terminou sem schema não sistêmico além de `public`. Não houve
deploy, Vercel, Neon, banco remoto, `docker system prune` ou remoção de
`node_modules`.

## Recriação local

```bash
pnpm install
pnpm db:up
pnpm db:generate
pnpm db:migrate:deploy
pnpm build
```

Não remova `node_modules` enquanto o ambiente precisar funcionar offline. Se a
pasta for removida futuramente, `pnpm install --frozen-lockfile` a recria com o
lockfile e acesso ao registry/store.

## GitHub privado

Verificação recomendada:

```bash
gh repo view Menddon/crm-politizai --json visibility,defaultBranchRef,url
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

A visibilidade deve ser `PRIVATE` e os dois SHAs de `main` devem coincidir. `.env`,
`.next`, `node_modules`, dumps, backups, logs, caches, relatórios e credenciais
devem continuar ignorados.

## Próximo passo futuro: Vercel + Neon

Isto não foi executado. Antes de qualquer publicação: aprovar uma task própria,
criar banco remoto isolado, rotacionar credenciais, configurar TLS/pooling,
ensaiar migration e restauração, revisar LGPD/RBAC/logs e executar o gate do
commit exato. Não copiar `.vercel`, IDs, tokens ou credenciais de outro projeto.
