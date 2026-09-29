# Backup do banco local

## Escopo

O backup da PROD-01 contém somente o schema `public` do banco local
`politizai_crm`: estrutura, dados e `_prisma_migrations`. Schemas históricos de
teste não integram o arquivo. O dump fica em `.backups/`, diretório ignorado
pelo Git, e nunca deve ser enviado ao GitHub.

## Backup validado da PROD-01

- arquivo: `.backups/prod-01/politizai_crm_public_20260912T020430Z.dump`;
- metadados: `.backups/prod-01/politizai_crm_public_20260912T020430Z.metadata.txt`;
- formato: custom do `pg_dump` 17.10;
- tamanho: 1.495.503 bytes;
- SHA-256: `325b4451d40238121b1e5c00fd5c02f4d8f1bedd5329ab55dc3e096807b16fe9`;
- inventário: 1.014 entradas em `pg_restore --list`;
- restauração de ensaio: aprovada em banco local temporário e removida depois.

O ensaio reconciliou 69 tabelas, 24 registros de migration, 99 workspaces, 146
usuários, 18 equipes, 528 leads, 1.162 atividades, 59 oportunidades e 1.853
logs de auditoria.

## Revalidação após a CRM-33

Uma nova autorização da PROD-01 em 12 de setembro de 2026 gerou o arquivo
`.backups/prod-01/politizai_crm_public_revalidation_20260912T044424Z.dump`,
também ignorado pelo Git. O dump possui 1.834.456 bytes, SHA-256
`d878babbb85236b55f682f58a7937de536c7631cbd7252ee436e2d09b4862d75` e
1.092 linhas no inventário de `pg_restore --list`.

A restauração de ensaio em
`politizai_prod01_restore_check_20260912` passou com 74 tabelas, 25 registros
em `_prisma_migrations`, 528 leads, 146 usuários, 18 equipes, 1.162 atividades,
59 oportunidades e 3.170 logs de auditoria. Os fingerprints de IDs de Lead,
Activity e Opportunity coincidiram com o `public`; o banco temporário foi
removido. O PostgreSQL usado foi 17.10.

## Revalidação após a CRM-35

Uma nova autorização da PROD-01 em 12 de setembro de 2026 gerou o arquivo
`.backups/prod-01/politizai_crm_public_revalidation_20260912T072357Z.dump`.
O dump custom possui 2.348.631 bytes, SHA-256
`9300e0fb23c3bd201ace730a0052207253b17d1ff85d28cb235a20efc76eb001` e
1.324 entradas em `pg_restore --list`.

A restauração de ensaio em
`politizai_prod01_restore_check_20260912_072357` reconciliou 89 tabelas, 26
migrations concluídas, 531 leads, 146 usuários, 18 equipes, 1.183 atividades,
59 oportunidades e 3.216 logs de auditoria. Os fingerprints de IDs de Lead,
Activity e Opportunity coincidiram com o `public`; o banco temporário foi
removido. O registro adicional existente em `_prisma_migrations` corresponde a
uma tentativa antiga marcada como revertida, não a uma migration pendente.

## Revalidação após a CRM-36

Uma nova autorização explícita da PROD-01 em 12 de setembro de 2026 gerou o
arquivo
`.backups/prod-01/politizai_crm_public_revalidation_20260912T091636Z.dump`,
mantido apenas no armazenamento local ignorado pelo Git. O dump custom possui
2.641.918 bytes, SHA-256
`40b59535564f9f051a116db488ebb9d9cc5395bb6967b31af83d7aedc2f4fbb7` e
1.511 entradas no inventário de `pg_restore --list`.

A restauração limpa no banco local temporário
`politizai_prod01_restore_check_20260912_final` reconciliou 106 tabelas, 27
migrations concluídas, 531 leads, 146 usuários, 18 equipes, 1.183 atividades,
59 oportunidades e 3.223 logs de auditoria. Os fingerprints dos IDs de Lead,
Activity e Opportunity coincidiram com o `public`; o banco temporário foi
removido ao final.

## Revalidação após a CRM-38

O backup atual da PROD-01 está em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T124811Z.dump`.
Ele possui 3.083.798 bytes, SHA-256
`65459e2a5e06fd9326583ddb5726ab1974fb8482efd5ac6e7bd5f6b1972ace28`
e 1.830 entradas no inventário de `pg_restore --list`.

A restauração com `--exit-on-error` foi feita no banco local temporário
`politizai_prod01_restore_check_20260912_124811`, criado exclusivamente para o
ensaio e removido ao final. O resultado reconciliou 132 tabelas, 31 migrations,
531 leads, 146 usuários, 18 equipes, 1.183 atividades, 59 oportunidades e 3.227
logs de auditoria. Os fingerprints de IDs de leads, atividades, oportunidades
e usuários coincidiram com a origem.

O arquivo contém somente o schema `public`; os 82 schemas legados removidos
depois do ensaio não entraram no dump. O checksum e o inventário foram
confirmados novamente após os gates.

## Revalidação após a CRM-39

O backup atual da PROD-01 está em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T144619Z.dump`,
com metadados no arquivo homônimo `.metadata.txt`. O dump custom do PostgreSQL
17.10 possui 3.154.009 bytes, SHA-256
`b3eccd4f2e9307130fcef0d07fdbd2dfe8a6c86b4ec9d56b349ca338b2a59b97`
e 1.966 entradas em `pg_restore --list`.

A restauração isolada reconciliou 145 tabelas, 35 migrations, 531 leads, 146
usuários, 18 equipes, 1.183 atividades, 59 oportunidades e 3.230 logs, além dos
fingerprints de IDs. O banco temporário
`politizai_prod01_restore_check_20260912t144619` foi removido. A primeira
tentativa encontrou o `public` vazio que o PostgreSQL cria em bancos novos e
falhou com `schema "public" already exists`; nenhum dado principal foi tocado.
O ensaio repetido removeu somente aquele schema vazio do banco temporário antes
de restaurar e passou integralmente.

## Revalidação após a CRM-41

O backup atual da PROD-01 está em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T184711Z.dump`.
O arquivo custom do PostgreSQL 17.10 possui 3.166.788 bytes, SHA-256
`21a931be75eead64e298ff84113ec24e67c2b3d5cbf9b7633efb2f826acf485b`
e 1.987 entradas no inventário de `pg_restore --list`.

A restauração com `--exit-on-error` no banco local temporário
`politizai_prod01_restore_check_20260912t184711` reconciliou 147 tabelas, 35
migrations concluídas, 531 leads, 146 usuários, 18 equipes, 1.183 atividades,
59 oportunidades e 3.231 logs, além dos fingerprints de IDs. O banco de ensaio
foi removido. O login de smoke posterior acrescentou somente um `AuditLog`
append-only no `public`; por isso o backup representa o estado imediatamente
anterior ao smoke e permanece íntegro. A CRM-42 parcial do checkout não foi
aplicada ao banco nem incluída neste dump.

## Gerar um novo backup

Confirme primeiro container, banco e ausência de operação ativa. Depois use um
caminho explicitamente dentro de `.backups/`:

```bash
mkdir -p .backups/manual
docker exec politizai-crm-db-1 pg_dump \
  -U politizai -d politizai_crm \
  --format=custom --schema=public --no-owner --no-privileges \
  > .backups/manual/politizai_crm_public.dump
shasum -a 256 .backups/manual/politizai_crm_public.dump
docker exec -i politizai-crm-db-1 pg_restore --list \
  < .backups/manual/politizai_crm_public.dump
```

Não imprima a URL do banco ou credenciais. O exemplo usa apenas a conta local
do Compose; outro ambiente exige gestão de segredos própria.

## Restauração de ensaio

Nunca restaure sobre `politizai_crm`. Crie um banco local temporário com nome
explícito, remova somente o `public` vazio criado automaticamente pelo
PostgreSQL 17, restaure com `--exit-on-error`, compare contagens e remova o banco
temporário. O primeiro ensaio da PROD-01 sem remover o `public` vazio falhou com
`schema "public" already exists`; nenhum dado principal foi tocado.

O backup desta task é local. O GitHub privado protege o código, não substitui
backup off-site criptografado do banco. Antes de dados reais, definir retenção,
criptografia, controle de acesso, RPO/RTO e teste periódico de restauração.
