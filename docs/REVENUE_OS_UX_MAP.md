# Mapa de experiência — Politizai Revenue OS

## Princípio

Mais capacidade não significa mais informação simultânea. Cada perfil recebe
uma página inicial orientada à decisão, uma ação primária por contexto e acesso
progressivo aos detalhes. A identidade visual, navegação lateral, estados e
acessibilidade definidos em `VISUAL_SYSTEM.md` permanecem.

## Navegação proposta

```text
Início da função
Trabalho
  Meu Dia / Leads / Contatos / Contas
  Pipeline / Agenda / Oportunidades
Clientes
  Onboarding / Carteira / Renovações
Marketing
  Aquisição / Campanhas / Atribuição
Gestão
  Receita / Forecast / Metas / Qualidade
Operação
  Inbox / Automações / Integrações / Auditoria
Administração
  Pessoas / Permissões / Configurações / Privacidade
```

Itens sem permissão não aparecem, mas a autorização continua server-side.
Agrupamentos e nomes poderão variar após teste de usabilidade; a estrutura não
deve virar uma lista de todos os módulos.

## Página inicial por função

### Marketing

- foco: investimento que gera demanda qualificada e receita;
- topo: gasto, leads, qualificados, oportunidades, receita atribuída e cobertura;
- visual principal: evolução custo → demanda → receita;
- atenção: sync atrasado, campanhas sem mapping, custo sem conversão, formulários quebrados;
- ação primária: abrir campanha/issue que exige correção.

### SDR

- preserva Meu Dia e “Atenda agora”;
- acrescenta contexto de Contact/Account e consentimento sem aumentar o card;
- comitê, touchpoints e histórico aparecem em disclosure no 360;
- ação primária continua determinística e visível.

### Closer

- foco: reunião/oportunidade que precisa avançar;
- mostra conta, comitê, última interação, próxima ação, valor e risco factual;
- contrato aparece depois de proposta/ganho, sem competir com pipeline;
- ação primária: executar próximo passo da oportunidade.

### Customer Success

- foco: onboarding, saúde e compromissos vencidos;
- fila: ativação atrasada, cliente em risco, objetivo sem ação, solicitação crítica;
- detalhes: contrato/escopo, histórico, plano e evidências de saúde;
- ação primária: concluir próximo marco ou ação de sucesso.

### Farmer

- foco: renovações próximas e expansão com evidência;
- separa renovação, expansão, contração e risco de churn;
- ação primária: trabalhar o próximo evento comercial do cliente.

### Gestor/RevOps

- foco: ciclo completo e qualidade da operação;
- comparativos: demanda, conversão, velocidade, forecast, receita, retenção;
- painel de atenção: quebra de SLA/processo, integração, qualidade e cobertura;
- cada número abre o mesmo recorte usado no cálculo;
- ação primária: atribuir ou abrir uma correção comprovada.

### Administrador

- foco: acesso, integrações, segurança, jobs e retenção;
- mostra health/status sem dados comerciais desnecessários;
- ação primária: resolver falha/configuração com preview e confirmação.

## Superfícies compartilhadas

### Busca global

Busca por Contact, Account, Lead, Opportunity, Contract e Subscription. Resultado
mostra tipo, contexto mínimo e ação permitida. Telefones, e-mails, valores e
clientes fora do escopo não entram no índice retornado. A busca não é mecanismo
de exportação nem contorno de permissão.

### Contact 360

Identidade, pontos de contato, consentimento, contas, leads, timeline e merge
issues. A ação principal depende do lifecycle; edição sensível mostra origem e
conflito. Informações comerciais profundas continuam em Account/Opportunity.

### Account 360

Resumo, comitê, oportunidades, contratos, receita, onboarding, saúde, solicitações,
renovações e auditoria. Carrega uma aba por vez; não renderiza todo o histórico
em uma página gigante.

Na CRM-35, Lead 360 e Account 360 receberam um resumo compacto de jornada,
owners por função, ausência de owner obrigatório e transferências pendentes.
Detalhes de governança ficam em disclosure; nenhuma aba futura é simulada.

### Inbox

Lista conversas autorizadas, fila e SLA; painel de conversa; contexto lateral
recolhível. Envio expõe canal, consentimento e estado real. Falha/simulação não
parece mensagem entregue.

### Integrações

Catálogo, status, última sincronização, lag, escopos e erros. Credencial nunca é
exibida. Conectar/testar/revogar são ações separadas com confirmação.

## Padrão de páginas

1. cabeçalho compacto: contexto, período/escopo, atualização e uma ação primária;
2. resumo curto: apenas números que mudam a decisão;
3. área principal: fila, gráfico ou registro de trabalho;
4. painel de atenção próximo do elemento corrigível;
5. detalhes avançados em tabs, drawer ou disclosure;
6. drilldown preserva filtros na URL e permite retorno sem perda de contexto.

Filtros avançados ficam recolhidos, chips mostram estado ativo e tabelas mantêm
densidade. Dashboards não repetem a mesma métrica em páginas diferentes com
fórmula própria.

## Estados obrigatórios

- loading com skeleton coerente com o layout;
- vazio com causa e próxima ação possível;
- zero real distinto de “ainda não sincronizado”;
- indisponibilidade de provider sem apagar último dado válido;
- erro com request ID seguro e retry quando idempotente;
- sem permissão sem confirmar existência do registro;
- dados parciais com cobertura/última atualização;
- conflito de edição com comparação de versões;
- sucesso e desfazer apenas quando seguro.

## Mobile, teclado e acessibilidade

- prioridade de conteúdo mantém ação principal antes de painéis auxiliares;
- tabelas viram linhas/cards ou scroll interno controlado, nunca overflow da página;
- drawer fecha por Escape e devolve foco;
- tabs, listas, gráficos e comitê têm nomes acessíveis e alternativa tabular;
- status não depende apenas de cor;
- números usam tabular-nums e labels explícitos;
- zoom de 200% e `prefers-reduced-motion` permanecem critérios de aceite.

## Anti-complexidade

- não criar dashboard único para todos os papéis;
- não exibir todos os KPIs disponíveis;
- não colocar contratos, CS e mídia no card compacto do SDR;
- não criar formulário com todas as entidades de uma vez;
- não duplicar Account e Contact em cada pipeline;
- não usar IA como chat aberto quando uma ação contextual resolve;
- não esconder ação crítica em menu de três pontos;
- não transformar configurações técnicas em decisão cotidiana.

## Validação futura

Cada superfície exigirá teste com o papel correspondente, dados vazios/parciais,
conteúdo longo, grande volume, teclado, leitor de tela e cinco breakpoints. A
CRM-32 não alterou rotas ou componentes.

## Superfícies entregues na CRM-34

- `/contas`: lista paginada, busca, filtros tipados, criação autorizada e estado vazio;
- `/contas/[accountId]`: Conta 360 com identidade, hierarquia, pessoas/papéis,
  oportunidades e comitês;
- `/contas/revisoes`: fila administrativa de decisão humana sobre nomes legados;
- Lead 360: conta canônica clicável ou aviso honesto de vínculo pendente;
- criação de oportunidade: seleção opcional de conta, sugerindo a conta já
  confirmada do lead;
- navegação lateral: Contas no contexto comercial autorizado.

As superfícies reutilizam o sistema visual existente e não alteram regras de
pipeline, score, SLA ou automações.
