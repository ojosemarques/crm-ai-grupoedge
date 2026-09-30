# Operação integrada do CRM

O workspace autenticado é a fronteira de cada empresa. Vendas, contratos,
financeiro, pós-venda, marketing e Copilot usam os serviços e permissões dessa
empresa. O login permite informar outra empresa já provisionada; cadastrar uma
conta de cliente não cria um novo workspace.

## Fechamento comercial

Em **Trabalho → Vendas e propostas**, abra uma oportunidade e escolha
**Preparar fechamento**. O mesmo serviço recebe propostas do chat lateral.

1. Registre a oferta comercial, conta, contato e produto da oportunidade.
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

Arrastar uma oportunidade para Ganho continua respeitando o fluxo comercial e
agora calcula a comissão prevista. O fechamento integrado é necessário para
informar e confirmar as condições contratuais e de faturamento completas.

## Financeiro e pós-venda

**Financeiro** reúne lançamentos, categorias, contas, recebíveis, despesas, DRE,
fluxo diário e projeção de 30 dias. Saldo inclui movimentos anteriores ao período;
DRE usa competência, enquanto caixa usa liquidação. Projeção não representa
recebimento confirmado. Valores em aberto e MRR são posições atuais identificadas.

Ao registrar uma comissão como paga, selecione a conta de saída. O sistema
registra uma única despesa liquidada na mesma transação. Essa ação documenta um
pagamento já realizado e não executa transferência bancária.

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

O worker reconcilia diariamente o dia anterior no fuso da empresa, com chave
idempotente. Divergências aguardam reconhecimento ou resolução humana com motivo.
Não há correção automática dos números do CRM para fazê-los coincidir com Ads.

Os conectores Meta e Google exigem credenciais, contas e sincronizações reais.
O analytics de páginas exige instalação no site e relay autenticado no backend;
veja [coleta e consentimento](page-analytics.md). O script não instala por conta
própria pixels de provedores em sites externos.

## Copilot

O botão **Copilot** abre o chat à direita. Consultas determinísticas financeiras,
de mídia e pós-venda funcionam sem OpenAI. Para interpretação conversacional,
configure `OPENAI_API_KEY`, `OPENAI_MODEL` e `COPILOT_EXTERNAL_ENABLED=true` apenas
no servidor e aprove o cenário `metric-synthesis` na governança de IA.

O chat respeita as permissões dos módulos, informa fontes, períodos e amostras.
Períodos ambíguos exigem esclarecimento. Dados do CRM e histórico da conversa não
são instruções autorizadas de execução. O modelo não recebe ferramentas de SQL ou
escrita; sua única ação operacional disponível é propor o fechamento integrado de
uma oportunidade existente. O botão de confirmação executa o payload persistido,
com revalidação. Dizer “OK” no texto não executa uma proposta.

Credenciais não devem ser inseridas no chat. Sem configuração externa, a interface
mostra modo local. Uma proposta expira após 30 minutos; uma execução interrompida
pode recuperar seu resultado usando a mesma confirmação, sem duplicar a venda.
