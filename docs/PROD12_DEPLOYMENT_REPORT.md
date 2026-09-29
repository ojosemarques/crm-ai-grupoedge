# Relatório de deployment fechado da PROD-12

## Escopo e fonte de verdade

Este documento especializa as evidências de deployment já consolidadas em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md). Ele não
registra nova publicação e não substitui o relatório consolidado.

## Release candidate publicado

| Item | Evidência |
|---|---|
| Projeto Vercel | `crm-politizai-production` / `prj_BJ4G7j1vgbL3tRMerhJ3MJ8f6lBS` |
| Deployment ativo | `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n` — `READY` |
| Commit técnico | `bf15b07920600da3283ac48598fe4985e032cddc` |
| Região/plano | `gru1` / Hobby |
| Build | Next.js 16.3.4, Node 22, pnpm 11 e Webpack |
| Proteção | Vercel Authentication obrigatória |
| Custo registrado | R$ 0 |

O commit documental posterior não altera o código executável e, por isso, é
descrito como equivalente de código; não se declara igualdade entre o SHA do
deployment e o SHA documental.

## Smoke fechado registrado

- acesso anônimo redirecionado para Vercel Authentication;
- `/api/health` retornou HTTP 200;
- `/api/ready` retornou HTTP 200 com estado agregado do banco;
- `/login` retornou HTTP 200 dentro da sessão protegida;
- raiz redirecionou somente para o host confiável configurado;
- worker sem Bearer ou com segredo incorreto retornou HTTP 401;
- segredo correto com kill switch retornou HTTP 503 `WORKER_DISABLED`;
- logs inspecionados não expuseram Authorization, segredo, senha ou URL de
  banco.

## Limites deliberados

- não existe Git link nem auto-deploy;
- não existe domínio customizado, DNS ou tráfego público;
- nenhum usuário do CRM foi criado;
- nenhum worker está ativo ou agendado;
- adapters externos e egress comercial permanecem desativados;
- nenhum dado real ou operacional foi inserido;
- a publicação fechada não constitui go-live.

Não houve novo deployment durante esta correção documental.
