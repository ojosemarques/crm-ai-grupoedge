# Operação integrada do CRM

O workspace autenticado é a fronteira de cada empresa. Vendas, contratos,
financeiro, pós-venda, marketing e Copilot usam os serviços e permissões dessa
empresa. O login permite informar outra empresa já provisionada; cadastrar uma
conta de cliente não cria um novo workspace.

No deploy, valide os grants com a identidade real do servidor. As tabelas podem
existir sem que `crm_politizai_runtime` tenha acesso. O arquivo
[`edge-os-runtime-grants.sql`](../supabase/edge-os-runtime-grants.sql) contém o
escopo mínimo dos fluxos financeiro, confirmação do Copilot e handoff desta
entrega. Ele não concede DELETE nem altera papéis públicos, schema ou RLS.

## Fechamento comercial

Em **Trabalho → Vendas e propostas**, arraste a oportunidade para Ganho ou abra
**Preparar fechamento**. Ambos abrem a revisão integrada; a API pública recusa
uma transição simples para Ganho. O mesmo serviço recebe propostas do chat lateral.

1. Registre a oferta comercial, contato e produto da oportunidade. Na prévia,
   confirme o cadastro do cliente: reutilize a conta vinculada, escolha uma
   existente ou confirme a criação pelo nome informado. Homônimos exigem seleção.
2. Informe vendedor, total, entrada, mensalidade, duração, início e modelo
   contratual. O total deve corresponder à entrada + mensalidade × meses.
3. Revise a prévia e confirme. Gates comerciais, permissões, versões e vigência
   são novamente verificados na execução.

Sem evidência do aceite do cliente, a operação marca a venda ganha, gera contrato
em rascunho e calcula a comissão prevista pela regra vigente. A venda aparece no
TCV financeiro. Não há recebíveis emitidos nem MRR ativado até o aceite.

Com nome, papel e evidência do aceite real, a mesma operação emite o contrato,
registra o aceite manual, ativa a assinatura e cria os recebíveis abertos. A
primeira parcela contém a entrada e a primeira mensalidade. Informar responsável
de onboarding também cria o handoff conforme o template publicado. A equipe de
pós-venda continua responsável pelo aceite do handoff e seus marcos.

Uma falha desfaz todas essas alterações. Repetir a confirmação reaproveita o
resultado; reaproveitar sua chave para outra venda ou outros termos é rejeitado.
Não há pagamento fictício, assinatura eletrônica ou cobrança de cartão implícita.
Contratos futuros ou já encerrados não podem ativar MRR imediato por esse fluxo.

O cadastro ou vínculo do cliente participa da mesma transação do fechamento:
lead, oportunidade, contrato e cobranças apontam para a mesma conta. A transição
interna permanece disponível às automações existentes; ela não substitui a
revisão contratual do fechamento integrado.

## Financeiro e pós-venda

**Financeiro** reúne lançamentos, categorias, contas, recebíveis, despesas, DRE,
fluxo diário e projeção de 30 dias. Saldo inclui movimentos anteriores ao período;
DRE usa competência, enquanto caixa usa liquidação. Projeção não representa
recebimento confirmado. Valores em aberto e MRR são posições atuais identificadas.

Ao registrar uma comissão como paga, selecione a conta de saída. O sistema
registra uma única despesa liquidada na mesma transação. Essa ação documenta um
pagamento já realizado e não executa transferência bancária.

Nas cobranças, **Registrar recebimento** exige conta financeira, valor, data,
forma e referência única do comprovante. Revise a prévia e ateste que o dinheiro
foi recebido. O pagamento canônico baixa a cobrança total ou parcialmente e
alimenta o caixa e os indicadores, sem gerar uma segunda entrada avulsa. A mesma
referência não pode ser registrada duas vezes na conta. Simulações ficam fora
dos totais reais e não podem ser iniciadas em produção.

O MRR ativo representa assinaturas vigentes; **MRR vendido no período** representa
os ganhos comerciais daquele período. Receber uma mensalidade não aumenta o MRR.
Entradas avulsas liquidadas também compõem o caixa gerencial para quem possui
acesso financeiro, mas não liquidam uma cobrança de cliente: use o recebimento
vinculado para esse caso. Datas financeiras respeitam o fuso da empresa.

**Clientes** dá acesso a contas, onboarding, Customer Success, atendimento e
satisfação, renovações e expansão. Churn, renovação e mudanças de assinatura
continuam exigindo eventos explícitos nos módulos responsáveis; não são inferidos
de falta de pagamento ou de uma conversa com a IA.

## Marketing

**Marketing → Anúncios e funil** compara investimento e resultados por canal,
campanha, criativo e UTMs. O funil comercial usa leads únicos criados no período,
reuniões registradas e vendas fechadas até o corte. No-show é um status explícito.
Tier 1/2/3 e Representante usam tags explícitas; ausências ou conflitos aparecem
como não classificados. O gráfico informa a base das taxas e o limite da amostra.

Hook Rate usa visualizações de três segundos da Meta divididas pelas impressões
dos mesmos registros. O painel informa a cobertura; dados ausentes ficam sem
taxa, não viram zero. CPM, CPC, CTR e CPL preservam canal e moeda de origem.

O funil também separa **Vendas contratadas**, **Recebido bruto**, **Estornos** e
**Recebido líquido** por origem, campanha, criativo e UTM. Recebimentos usam o
pagamento vinculado à cobrança/contrato/oportunidade/lead, contado uma vez por
dimensão. A coorte continua sendo os leads criados no período: não compare esse
subtotal ao caixa total da empresa, que também inclui clientes antigos e entradas
avulsas. Valores sem atribuição permanecem em **Não identificado**; simulações
não contam como receita recebida.

O worker reconcilia diariamente o dia anterior no fuso da empresa, com chave
idempotente. Divergências aguardam reconhecimento ou resolução humana com motivo.
Não há correção automática dos números do CRM para fazê-los coincidir com Ads.

Os conectores Meta e Google exigem credenciais, contas e sincronizações reais.
O analytics de páginas exige instalação no site e relay autenticado no backend;
veja [coleta e consentimento](page-analytics.md). O script não instala por conta
própria pixels de provedores em sites externos.

## Copilot

O botão **Copilot** abre o chat à direita, com **Conversa**, **Ações** e **Histórico**.
Consultas determinísticas financeiras, de mídia, pós-venda, clientes e tarefas
funcionam sem OpenAI. As ações também estão disponíveis por formulários locais:
criar tarefa, atualizar nome/razão social/domínio/segmento/porte do cliente,
registrar despesa prevista ou paga e registrar recebimento de cobrança. Tarefas
usam o responsável atual do lead, explicitado na prévia. O fechamento integrado
fica acessível pelo link para o pipeline, ou por proposta conversacional externa.

Para interpretação conversacional,
configure `OPENAI_API_KEY`, `OPENAI_MODEL` e `COPILOT_EXTERNAL_ENABLED=true` apenas
no servidor e aprove o cenário `metric-synthesis` na governança de IA.

O chat respeita as permissões dos módulos, informa fontes, períodos e amostras.
Períodos ambíguos exigem esclarecimento. Dados do CRM e histórico da conversa não
são instruções autorizadas de execução. O modelo não recebe ferramentas de SQL ou
escrita direta. Ele pode propor as ações enumeradas acima e o fechamento integrado
de uma oportunidade existente. Cada proposta mostra dados e efeitos, permite
cancelamento e exige confirmação separada. O botão executa o payload persistido,
revalidando acesso, versão e prévia. Dizer “OK” no texto não executa uma proposta.

Credenciais não devem ser inseridas no chat. Sem configuração externa, a interface
mostra modo local. Uma proposta expira após 30 minutos; uma execução interrompida
pode recuperar seu resultado usando a mesma confirmação, sem duplicar a venda.
O histórico persiste propostas, confirmações, cancelamentos e resultados por
empresa e solicitante, com acesso novamente verificado. Se os dados mudarem antes
de uma execução ainda não concluída, prepare uma nova prévia. Valores e referências
de pagamentos devem ser informados pelo operador; o modelo não confirma que houve
transferência bancária.

O deploy requer a migration `20261001000000_copilot_operational_actions`, que
amplia os tipos e estados do registro de aprovação, mantendo as exigências de
versões nas publicações de configurações. É compatível com rollback do código;
não reverta o schema depois de existirem ações dos novos tipos sem planejar a
preservação do histórico.
