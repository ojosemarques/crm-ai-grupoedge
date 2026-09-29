# Ensaio remoto de falha de banco — recuperação PROD-10

## Isolamento

O ensaio ocorreu exclusivamente em uma branch Neon descartável chamada
`prod10-fault-20260915235021`, com endpoint e usuário runtime temporários. O
projeto foi confirmado como `crm-politizai-staging-db`, banco
`politizai_staging`, schema `public`; host seguro `2bdd3a81abe04361`, 298 tabelas
e 60 migrations. Nenhuma variável do deployment principal foi alterada.

Uma primeira credencial temporária foi acidentalmente devolvida em texto pela
CLI do provider durante a automação, apesar da saída solicitada em JSON. Ela foi
tratada como comprometida e revogada imediatamente, sem uso. O ensaio prosseguiu
com outro papel restrito criado por SQL, sem `SUPERUSER`, `CREATEDB`,
`CREATEROLE`, `REPLICATION` ou `BYPASSRLS`. Nenhum segredo integra o Git ou este
relatório.

## Evidência

| Momento | Liveness | Readiness | Estado do job |
|---|---:|---:|---|
| antes da falha | 200 | 200 | pendente sintético |
| usuário runtime em `NOLOGIN` e sessões encerradas | 200 | 503 | continuou `PENDING`, zero tentativa/efeito |
| conectividade restaurada | 200 | 200 | elegível para retomada |
| processamento após recuperação | 200 | 200 | `SUCCEEDED`, uma tentativa e um efeito |
| replay | 200 | 200 | lote ocioso, nenhum efeito adicional |

O processamento recuperado levou 5.068 ms, registrou
`externalEgress=false` e reconciliou backlog zero. Logs e respostas não
expuseram connection string ou senha.

## Limpeza e reconciliação

- branch `prod10-fault-*` removida;
- papéis e referências temporárias removidos;
- certificado, proxy, arquivos e entradas temporárias do Keychain removidos;
- zero recurso `prod10-fault` residual;
- staging principal permaneceu com 60 migrations e fingerprint seguro
  `585eb7002d47b032`;
- readiness do staging principal voltou a HTTP 200 após um retry transitório;
- nenhuma migration, tabela ou permissão do staging principal foi alterada.

O custo do laboratório foi zero no plano gratuito.
