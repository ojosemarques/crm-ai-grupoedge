# settings

Configurações persistidas do workspace e bootstrap local.

`application/demo-seed-service.ts` cria somente registros estruturais ausentes
em uma transação serializável. Ele não atualiza personalizações existentes, não
remove dados manuais e recusa bancos não locais ou ambiente de produção.

`application/crm29-demo-data-service.ts` adiciona, em outra transação, o
conjunto fictício e temporal de 320 leads. IDs, tag, auditoria e chaves são
determinísticos; a repetição confere integridade sem reescrever históricos.
Renovação temporal exige o reset explícito de um schema local reservado,
documentado em `docs/SEED.md`.

`application/commercial-settings-service.ts` é a única fronteira de alteração
dos catálogos e políticas comerciais. Toda chamada exige `workspace.manage`,
usa o workspace autenticado, calcula impacto antes da confirmação e grava
auditoria no mesmo commit. Configurações históricas são versionadas; itens de
catálogo em uso são inativados, nunca apagados.
