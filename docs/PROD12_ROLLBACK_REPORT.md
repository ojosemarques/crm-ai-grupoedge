# Relatório de rollback da PROD-12

## Escopo e fonte de verdade

Este documento especializa as evidências de rollback já consolidadas em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md). Ele não
registra novo ensaio, restore ou promoção e não substitui o relatório
consolidado.

## Banco

- ponto pré-migration preservado:
  `prod12-pre-migration-20260916` (`br-delicate-river-ac1k3pf7`);
- laboratório isolado usado no ensaio:
  `prod12-rollback-test-20260916`;
- o laboratório derivado apresentou zero tabelas e ausência de
  `_prisma_migrations`, confirmando o estado anterior às migrations;
- somente o laboratório foi removido ao final;
- a branch `main`, o banco `politizai_production` e o ponto de recuperação
  preservado não foram removidos nem restaurados.

## Aplicação

- commit anterior ensaiado:
  `8128f6baa5a771270c5edf40bfc04e4f271e1118`;
- a comparação com o candidato `bf15b079` mostrou zero diferença fora de
  documentação;
- health e readiness permaneceram HTTP 200 sob proteção;
- o candidato atual foi restaurado após o ensaio;
- deployment laboratorial `dpl_FMWZnzXUz1fyy9UQrvP5wr8ogdfV` removido;
- deployment inicial obsoleto `dpl_AT2U9wfzyUukT5HcaXHwxmWHkS15` removido;
- deployment fechado ativo preservado:
  `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n`.

## Resultado e limites

As contagens do banco permaneceram inalteradas e nenhum dado foi perdido. Não
restou laboratório temporário; permanece somente o ponto de recuperação
intencional. O Neon Free não oferece proteção contra exclusão da branch e
mantém histórico de 6 horas, portanto esse ensaio não equivale a uma política
produtiva de PITR, cópia off-site ou failover regional.

Não houve novo rollback ou restore durante esta correção documental.
