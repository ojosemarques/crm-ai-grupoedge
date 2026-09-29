# Relatório de aceite — PROD-11

## Decisão

**CONCLUÍDA para provisionamento vazio e gratuito. PROD-12 permanece fechada.**

## Matriz de aceite

| Controle | Resultado | Evidência |
|---|---|---|
| GitHub privado preservado | PASS | `Menddon/crm-politizai`, `main`, checkpoint inicial `8128f6b` |
| Vercel exclusivo de produção | PASS | projeto `crm-politizai-production`, ID próprio, Hobby |
| Nenhum deployment/publicação | PASS | inventário da API retornou 0 deployments e Git não vinculado |
| Proteção do projeto | PASS | Vercel Authentication para todos os deployments; custom domain automático desligado |
| Neon exclusivo de produção | PASS | `steep-credit-26086628`, diferente do staging |
| Região próxima | PASS | Vercel `gru1`; Neon `aws-sa-east-1` |
| Banco vazio | PASS | `public` com 0 tabelas; `_prisma_migrations` ausente |
| Owner/migrator/runtime separados | PASS | runtime conecta/usa schema e não possui `CREATE` |
| Pooled e direct separados | PASS | pooled somente no runtime; direct somente no Keychain do migrator |
| TLS | PASS | URLs geradas com `sslmode=require` |
| Segredos fora do Git | PASS | três Sensitive na Vercel e cinco referências no Keychain |
| Worker desligado | PASS | ambos os flags de worker em `false` |
| Adapters/demo/bootstrap desligados | PASS | inventário production no cofre, sem usuário criado |
| Backup/PITR gratuito | PASS COM LIMITAÇÃO | retenção observada de 6 horas; insuficiente para uso real |
| Proteção de exclusão Neon | BLOCKED PELO PLANO | HTTP 422; nenhuma cobrança ou upgrade efetuado |
| Custo | PASS | Vercel Hobby + Neon Free; R$ 0 gerado |
| Staging preservado | PASS | projetos/IDs separados e readiness será rechecado antes do commit |
| PROD-12 não iniciada | PASS | zero migration, deployment, domínio, bootstrap ou dado de negócio |

## Incidentes controlados

1. Neon recusou customização do suspend interval no Free (HTTP 412); nenhum
   recurso parcial foi criado nessa tentativa.
2. A primeira transferência de owner foi revertida pela transação porque o
   owner precisava de `SET` temporário sobre o migrator. A repetição removeu
   `SET` e herança na mesma transação; o owner administrativo conserva somente
   o `ADMIN OPTION` que o PostgreSQL registra para o criador dos papéis.
3. O pacote local `pg` estava esparso/incompleto; a validação usou o `psql` já
   existente no container deste CRM, apenas como cliente remoto, sem tocar no
   banco local.
4. Neon recusou proteção da branch no Free (HTTP 422). O risco permanece
   explícito e produção real continua NO-GO.

## Itens para a PROD-12

- exigir nova autorização;
- congelar SHA e CI;
- confirmar que o banco continua vazio e que o alvo é exatamente o deste
  relatório;
- criar ponto de recuperação dentro do limite disponível;
- aplicar migrations uma única vez com o migrator;
- vincular/publicar somente o SHA aprovado em deployment fechado;
- não criar identidade administrativa sem dados fornecidos explicitamente;
- manter worker, domínio e integrações desligados.
