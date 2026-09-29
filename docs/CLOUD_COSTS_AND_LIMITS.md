# Custos e limites de nuvem — PROD-02

## Premissas

Estimativa em USD, antes de impostos, IOF, câmbio, domínio e suporte humano. A
carga real ainda não foi medida em staging. Os valores usam as páginas oficiais
consultadas em 14 de setembro de 2026 e precisam ser reconfirmados no momento da
contratação.

Baseline:

- uma pessoa com permissão de deploy na Vercel;
- dois projetos Vercel Pro na mesma conta/team;
- Neon Launch com projetos separados para staging e produção;
- produção com compute mínimo médio de 0,25 CU devido ao worker persistente;
- uma Fly Machine de 512 MB em produção;
- staging desligado ou scale-to-zero fora das janelas de validação;
- aproximadamente 1 GB de banco no primeiro ciclo;
- sem add-ons pagos de Analytics/Observability e sem providers externos.

## Sobreposição gratuita atualmente provisionada

A continuação da PROD-05 formalizou somente o PostgreSQL de staging já criado
no Neon Free. Isso não substitui o orçamento de produção descrito abaixo.

| Recurso atual | Custo contratado | Limites observados em 14/09/2026 |
|---|---:|---|
| Neon `crm-politizai-staging-db` | US$ 0/mês | 100 CU-horas/mês por projeto, 0,5 GB, 5 GB de transferência, compute 0,25–2 CU e restore de 6 horas |

O painel do projeto permite acompanhar consumo. O plano Free não possui o
conjunto de alertas e a retenção aprovados para produção; ao atingir uma cota, o
ambiente deve suspender ou aguardar a renovação. Upgrade, cartão e cobrança
continuam sem autorização.

## Faixas mensais

| Item | Mínimo controlado | Esperado inicial | Observação |
|---|---:|---:|---|
| Vercel Pro | US$ 20 | US$ 20–30 | um deploying seat e crédito mensal de uso; excedentes são medidos |
| Neon produção | US$ 20–25 | US$ 25–35 | compute, storage, PITR e snapshots; worker reduz oportunidade de scale-to-zero |
| Neon staging | US$ 1–5 | US$ 3–10 | desligado fora de homologação; uso contínuo aumenta a faixa |
| Fly worker produção | US$ 4–7 | US$ 4–8 | 512 MB a 1 GB, sempre ligado |
| Fly worker staging | US$ 0–2 | US$ 0–4 | iniciar somente em janelas de teste |
| Backup off-provider | < US$ 1 | US$ 1–3 | storage e operações; tráfego de restore pode cobrar |
| **Total** | **US$ 45–55** | **US$ 55–85** | sem impostos, domínio e add-ons |

A estimativa Neon de compute contínuo usa a ordem de grandeza publicada no
Launch: `0,25 CU × 730 h × US$ 0,106/CU-h ≈ US$ 19,35`, antes de storage,
histórico e snapshots. É um orçamento, não uma fatura garantida.

Manter staging ligado 24×7 pode acrescentar cerca de US$ 20–30/mês. Um segundo
worker sempre ligado adiciona outra Machine. Crescimento de tráfego, banco,
histórico de restore ou egress altera a faixa.

## Vercel

### Plano identificado e plano escolhido

- referência Opadillis observada: **Hobby** em conta pessoal, Functions em
  `iad1` e integração GitHub ativa;
- CRM escolhido: **Pro**, US$ 20/mês com um deploying seat e US$ 20 de crédito
  de uso incluído conforme a documentação atual;
- cada deploying seat adicional custa US$ 20/mês;
- viewers são ilimitados no Pro.

Dois projetos não duplicam automaticamente a mensalidade base, mas ambos
consomem o mesmo crédito e podem gerar uso excedente.

### Limites relevantes

- Cron Hobby: uma execução por dia, precisão horária;
- Cron Pro/Enterprise: até uma execução por minuto, precisão por minuto;
- Functions com Fluid Compute: duração máxima documentada de 300 s no Hobby e
  800 s no Pro;
- memória padrão observada/documentada: 2 GB/1 vCPU no Hobby; Pro permite
  configuração maior conforme limite atual;
- bundle descompactado máximo de Function: 250 MB;
- Vercel Authentication pode proteger todos os deployments em todos os planos;
- Password Protection no Pro é add-on de US$ 20/projeto/mês;
- Observability Plus, Web Analytics Plus e Speed Insights custam atualmente
  US$ 10/mês cada quando habilitados.

Gatilhos de custo: Function duration, invocations, data transfer, image
optimization, builds, logs/observabilidade, seats e proteção paga. Alertas de
uso devem ser configurados antes do staging compartilhado.

## Neon

### Plano escolhido

**Launch** para os dois projetos. Free não é aceito para produção porque oferece
limites menores e restore window insuficiente para o gate proposto. Scale só é
justificado por necessidade comprovada de SLA, private networking, exportação
de logs/métricas, maior compute ou restore window de 30 dias.

### Limites relevantes do Launch

- cobrança por compute, storage e histórico efetivamente usados;
- compute máximo de 16 CU conforme a tabela vigente;
- restore window máxima de sete dias;
- métricas e logs nativos por três dias;
- até 100 projetos na organização conforme a tabela vigente;
- endpoint pooled para runtime e endpoint direto para migrations/dump;
- snapshots agendados disponíveis em plano pago;
- snapshot storage cobrado separadamente conforme a política vigente.

Gatilhos de custo: worker impedindo scale-to-zero, muitas instâncias Vercel,
pool mal dimensionado, queries longas, crescimento de dados/índices, restore
history, snapshots, branches esquecidas, egress e logs. Staging precisa de
budget próprio e expiração de recursos temporários.

## Fly.io

Uma Machine compartilhada em `gru` é suficiente apenas como baseline. A tabela
regional oficial indica aproximadamente US$ 4–7/mês para 512 MB–1 GB, antes de
volume, IP dedicado e tráfego. O worker é stateless; não requer volume Fly.

Gatilhos de custo: segunda réplica, aumento de memória/CPU, staging sempre
ligado, egress e IP dedicado. Autoscaling não deve ser ativado antes de validar
locks, backlog e observabilidade.

## Banco e conexões

O pool local atual limita cada processo a cinco conexões. Em Functions, o total
potencial cresce com o número de instâncias; por isso o runtime usa o endpoint
pooled da Neon. O endpoint direto fica restrito a migrations/backup.

Gates de capacidade em staging:

- conexões ativas e em espera;
- saturação do pool e timeouts;
- compute/autoscaling da Neon;
- p50/p95/p99 de query e API;
- backlog, idade do job e tempo de processamento;
- memória/restarts da Machine;
- custo diário por ambiente.

Sem essas medições, aumentar pool, compute ou réplicas é prematuro.

## Proteções financeiras

1. Separar budgets e tags de staging/produção onde o provider permitir.
2. Criar alertas em 50%, 75%, 90% e 100% do orçamento esperado.
3. Restringir quem pode contratar add-on, alterar plano ou criar projeto.
4. Expirar branches, snapshots de teste e staging temporário.
5. Revisar semanalmente no primeiro mês: Vercel usage, Neon compute/storage e
   Fly runtime.
6. Exigir justificativa medida para Scale, add-ons, segunda região ou réplica.

## Cobranças que exigem nova autorização

Exigem autorização explícita antes da ação:

- upgrade da conta/team para Vercel Pro;
- criação dos projetos Vercel, Neon ou Fly.io;
- inclusão de cartão, seat, add-on ou proteção paga;
- compra/configuração de domínio ou mudança de DNS;
- storage off-provider e política de retenção;
- Scale Neon, segunda Machine, segunda região ou recurso Enterprise;
- ativação de qualquer provider externo.

PROD-02 não executou nenhuma dessas ações.

## Fontes oficiais

- [Vercel Pro](https://vercel.com/docs/plans/pro-plan)
- [Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Functions](https://vercel.com/docs/functions/limitations)
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Vercel add-ons e preços](https://vercel.com/docs/pricing)
- [Neon pricing](https://neon.com/pricing)
- [Neon backup e restore](https://neon.com/docs/manage/backups)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Fly.io pricing](https://fly.io/docs/about/pricing/)
