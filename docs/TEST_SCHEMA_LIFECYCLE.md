# Ciclo de vida de schemas de teste

## Regra segura

Os executores de integração, CRM-29 e E2E criam um schema exclusivo por
execução. O formato aceito é:

```text
politizai_test_<integration|crm29|e2e>_<UTC YYYYMMDDThhmmssZ>_<8 hex>
```

O nome é gerado internamente e validado por regex. Não existe parâmetro livre
para `DROP SCHEMA`. `public`, schemas de sistema e qualquer nome sem padrão ou
sem allowlist literal são recusados.

Antes de criar ou remover, o lifecycle confirma:

- protocolo PostgreSQL;
- host `localhost`, `127.0.0.1` ou `::1`;
- banco exatamente `politizai_crm`;
- `NODE_ENV` diferente de `production`;
- existência de `public` antes da manutenção;
- ausência de qualquer outra conexão cliente no banco, inclusive ociosa.

Cada executor usa `try/finally` e encerra conexões `pg`, Prisma e processos
filhos antes do descarte. A remoção de cada schema ocorre em uma transação
própria: um schema pode possuir centenas de relações e agrupar dezenas deles
numa única transação excede `max_locks_per_transaction` do PostgreSQL.

## Uso normal

```bash
pnpm test:integration
pnpm test:crm29
pnpm test:e2e
```

O resultado esperado ao final é zero schemas `politizai_test_*`.

## Preservação excepcional

Somente para depuração local:

```bash
KEEP_TEST_SCHEMA=1 pnpm test:integration
```

Qualquer outro valor, inclusive `true`, mantém a limpeza padrão. Quando a
preservação é solicitada, o executor imprime o nome exato e o comando de
manutenção. Nunca use essa variável em CI ou produção.

## Manutenção

O comando é dry-run por padrão:

```bash
pnpm db:test:cleanup
```

Ele mostra nome, tamanho estimado e evidência. Para remover somente os
candidatos exibidos, use a confirmação literal informada na saída:

```bash
pnpm db:test:cleanup -- --confirm=DROP_LOCAL_TEST_SCHEMAS
```

São elegíveis apenas nomes do novo padrão controlado ou nomes legados presentes
na allowlist explícita e comprovados em executor/checkpoint. Um prefixo como
`crm` ou `politizai_demo` sozinho nunca é evidência. Se houver dúvida, preserve
o schema e investigue seu conteúdo, origem e conexões.

Na revalidação de 12 de setembro de 2026, 82 nomes legados adicionais foram
allowlisted individualmente após evidência combinada: proprietário local
`politizai`, tabela `_prisma_migrations`, tabelas contidas no modelo de
`public`, cronologia de migrations coerente com CRM-02 a DESIGN-01 e nenhuma
conexão cliente. O dry-run listou 602.415.104 bytes e a confirmação removeu os
82 nomes. Ao final, apenas `public` e schemas do PostgreSQL permaneceram.

Na revalidação posterior à CRM-39, os três runners criaram nomes novos no
padrão controlado e os descartaram em `finally`. O dry-run anterior e a
inspeção posterior aos gates encontraram zero candidato e zero schema não
sistêmico fora de `public`; por isso nenhuma exclusão adicional foi executada.

Na revalidação posterior à CRM-41, integração, CRM-29 e E2E voltaram a criar
schemas `politizai_test_*` únicos e os descartaram mesmo após builds e processos
filhos. O dry-run final e a execução confirmada encontraram zero candidato;
somente `public` permaneceu como schema não sistêmico. Nenhum nome foi incluído
na allowlist e nenhum `DROP SCHEMA` atingiu dados permanentes.

## Testes de segurança

`test-schema-lifecycle.test.ts` cobre nome, regex, `public`, host remoto, banco
inesperado, produção, confirmação de preservação e allowlist. A integração
`test-schema-lifecycle.integration.test.ts` cria um filho efêmero, remove apenas
esse filho, comprova que `public` continua existente e recusa a operação quando
outra conexão cliente está aberta.
