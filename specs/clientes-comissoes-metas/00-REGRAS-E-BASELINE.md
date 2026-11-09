# 00 · Fixar a política e reconciliar o ponto de partida

## Dependências

Prompt mestre de uso interno e inventário no HEAD.

## Escopo e integração

Inventariar produção em leitura, registrar versão, calendário, fontes, permissões e divergências. `createSaleCompletionService`, `reconcileCommissionsInTransaction`, `createOteService` e `readRealtimeDashboardFacts` são pontos de partida confirmados.

## Contratos e permissões

As regras de cálculo e as decisões abaixo são critérios de aceite. Conferir duas vendas por vínculo e evidência financeira em produção, sem expor identificadores.

## Cenários e aceite

- [ ] Matriz completa versionada e baseline restrito verificado. Toda ausência tem responsável e impacto.

## Migração, reversão e verificação em produção

Sem migração. Produção somente leitura nesta etapa.

## Baseline do checkout

A branch local é `main`, no SHA `1283c6d91342f4b564a5b5befa4296043c3dffe9`, igual à referência local `origin/main` no momento da inspeção. Há documentos não rastreados preexistentes em `docs/`, fora do escopo de commit. O vínculo local da Vercel aponta para `grupo-edge-crm`. Domínio, SHA publicado, banco, schema, workspace e cobertura histórica ainda exigem verificação na fonte. O cron existente chama `/api/internal/worker/tick` a cada minuto. A existência do cron não prova cobertura da rotina nova.

Os writers observados incluem fechamento em `opportunity-service.ts`, baixa em `payment-service.ts`, eventos no `payment-worker-service.ts` e reconciliação disparada no próprio Financeiro. Os consumidores atuais incluem `/contas`, `/financeiro`, `/ote` e a leitura de fatos de `/tempo-real`. Preservar pesquisa de contas para vínculos, Pipeline, Contratos, Recebíveis, Contatos, Caixa e DRE.

## Evidência do baseline

- O remoto confirmou a `main` no mesmo SHA do checkout. O Supabase confirmou a existência do schema privado `crm` e da tabela de migrations. A role de runtime e as permissões da API devem seguir o contrato de `docs/SUPABASE_VERCEL_DEPLOYMENT.md`.
- A consulta de produção em leitura encontrou duas oportunidades ganhas, ambas vinculadas a conta, dois contratos e 21 faturas. O recorte encontrou zero recebimentos confirmados sem reversão, zero comissões e zero despesas candidatas liquidadas na data informada pelos critérios consultados. Esses resultados descrevem a cobertura do CRM e da consulta. O Financeiro deve fornecer as datas, valores e alocações de liquidação do cliente e o comprovante com valor e alocação da baixa do vendedor.
- Os 69 testes direcionados de Financeiro, OTE e fatos de tempo real passaram no baseline. A execução antecede a implementação e não verifica o produto novo.
- O status Vercel no commit da `main` está como sucesso e aponta para o projeto `grupo-edge-crm`, consistente com o vínculo local. O conector Vercel retornou 403 para listar deployments. Ainda falta verificar qual deploy atende o domínio ativo antes de qualquer ativação.

## Decisões de política

- A data de referência é 09/11/2026 em America/Sao_Paulo. Vincular versão à conclusão comercial e competência ao D0. Negócios de fronteira sem acordo comprovado ficam em revisão.
- Vendido é o gatilho comercial. O aceite operacional confirmado e datado pode compor D0. Exibir falta de aceite, ativação ou recebimento separadamente.
- Novo anual antecipado e bônus elegível usam o ciclo mensal. Fechar no fim do mês local, revalidar na baixa e imputar liquidações posteriores ao fechamento ao seu próprio mês quando forem eventos mensais.
- Novo anual parcelado tem proporcional informativo antes do marco. Entrada líquida alocada de pelo menos 25% até D+30 inclusive seleciona D+90. Demais casos usam D+120. Atividade, adimplência e caixa líquido de ao menos um terço em centavos são cumulativos. Regularização tardia libera no primeiro dia útil após todos os critérios. O vencimento padrão é o primeiro quinto dia útil na data ou após a liberação. Descontar baixas e títulos exigíveis. Datas em dias corridos para D+ e calendário de feriados versionado para vencimentos.
- Projetos, expansões e renovações negociadas têm base calculada e calendário em revisão quando a condição não está documentada. Isolar bloqueio por modalidade.
- Legado tem marcos e valores individuais. Deslocar vencimento não útil ao próximo útil conforme evidência. Pagamento informado sem valor ou vínculo não baixa obrigação. Correções tardias e estornos após pagamento usam revisão idempotente e ajuste explícito.
- Agendamento usa lead único com chegada válida no período, origem Anúncios e atribuição histórica comprovada, com agendamento efetivado até o corte. Comparecimento usa ocorrência válida já vencida no período da data efetiva da reunião, inclusive de lead anterior. Excluir futuras e cancelamentos válidos sem substituta. Deduplicar a cadeia de remarcação. Reuniões sem desfecho bloqueiam fechamento automático se alterarem a faixa. Denominador zero é sem base. Ausência de fatos é pendência de auditoria.
- Dias usam o fuso do workspace. A semana é de segunda a domingo, sujeita à confirmação do padrão operacional. Reprocessar períodos ausentes e fatos tardios com chaves estáveis e preservar fechamento pago.

### Calendário de referência

Com fins de semana e feriados nacionais, o quinto dia útil cai em 09/11/2026 e 07/12/2026. São datas de referência para os testes. Confirmar a praça operacional e os feriados adicionais aplicáveis antes de publicar. A portaria federal distingue feriado de ponto facultativo. [Calendário federal de 2026](https://legis.sigepe.gov.br/sigepe-bgp-ws-legis/legis-service/download/?id=0026440285-ALPDF%2F2025)

## Matriz de rastreabilidade

| Requisito | Etapa | Evidência exigida |
| --- | --- | --- |
| Venda ganha e fila de Clientes sem duplicatas | 02 | Teste de replay, concorrência, conta sem venda e venda sem oportunidade preparada |
| Confirmação, parcelas customizadas e baixa real | 02–03 | Aceite, ativação, parcial, bruto/líquido, saldo e vínculos canônicos |
| Isolamento e migração | 01, 07, 09 | Cadeia em banco novo e representativo, compatibilidade e testes por perfil |
| Faixas, D0, vigência, rampa, calendário e revisão | 04 | Cenários exatos em centavos, limites, feriados, saldo e ausência de sobreposição |
| Auditoria diária e semanal de Anúncios | 05 | Coortes por ID, corte, remarcações, cobertura e reprocessamento |
| Passivo e despesa | 06 | Agregados por recorte, baixa única e revalidação |
| Metas e Meu OTE | 07 | Comparação de lançamentos, filtros e privacidade |
| Vendas legadas e pagamento informado | 08 | Vínculos conciliados ou lacuna específica com bloqueio |
| Publicação, saúde e rollback | 09 | SHA publicado, estado de migrations e worker, smoke autenticado e gate |

## Pendências de baseline

Confirmar identidade e permissões do ambiente, origem do calendário e feriados, cobertura de atribuições e remarcações, início comprovado de rampa, D0, vencimentos e comprovantes individuais do legado. Registrar evidências reais somente em ambiente restrito. Valores e identidades individuais de remuneração devem ficar em configuração autorizada.

O responsável confirmou o calendário comum. A política usa segunda a sexta, exclui os feriados nacionais e adota a Sexta-feira da Paixão conforme a referência federal. A prévia cobre até 31/12/2027 e confere 07/12/2026 e 08/01/2027 como quintos dias úteis. [Portaria federal de 2026](https://legis.sigepe.gov.br/sigepe-bgp-ws-legis/legis-service/download/?id=0026440285-ALPDF%2F2025) · [Datas oficiais de 2027](https://www.joinville.sc.gov.br/publicacoes/calendario-de-feriados-e-pontos-facultativos-do-municipio-de-joinville-2027/)
