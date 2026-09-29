# Seed local de demonstração

## Execução

Com o PostgreSQL local ativo e as migrations aplicadas:

```bash
pnpm db:seed
```

O comando pode ser repetido. Ele recusa `NODE_ENV=production` e URLs cujo host
não seja `localhost`, `127.0.0.1`, `::1` ou `0.0.0.0`. A execução possui duas
transações separadas: estrutura/configuração e base operacional CRM-29.

## Estratégia de preservação

- transações `Serializable` e advisory locks distintos evitam concorrência;
- IDs são determinísticos e chaves naturais estruturais são verificadas;
- o seed estrutural não executa `update`, `delete`, restauração ou limpeza;
- o seed CRM-29 cria o grafo inteiro somente quando seu marcador não existe;
- uma segunda execução confere a integridade e retorna as mesmas contagens;
- senha, papel, status, nome, preço e configuração existentes são preservados;
- registros manuais adicionais permanecem intactos;
- auditorias e históricos usam IDs determinísticos e não crescem na repetição.

Se alguém personalizar um registro estrutural, a próxima execução mantém a
personalização. O conjunto operacional é identificado pela tag
`Demonstração CRM-29`, pelo `requestId` `crm29-demo-v1` na auditoria e por chaves
de idempotência com o mesmo namespace. Uma remoção parcial é tratada como estado
inconsistente, nunca reparada silenciosamente por cima do histórico.

## Estrutura criada

- workspace `politizai` em `America/Sao_Paulo`;
- oito usuários ativos, memberships, credenciais e atores humanos;
- atores Sistema, Automação e Agente de IA;
- cinco papéis e concessões persistidas com escopo;
- equipes Pré-vendas e Vendas, com gestor, três SDRs e dois closers;
- Fila Geral ligada à equipe de Pré-vendas;
- pipelines de Pré-vendas e Vendas, com etapas e transições permitidas;
- motivos de perda e desqualificação;
- três SLAs e faixas P1, P2 e P3;
- regras operacionais e cadência D0, D1, D3, D7, D14, D21 e D30;
- três produtos e três modelos de oferta fictícios em BRL/centavos;
- cinco origens, duas campanhas e quatro criativos de demonstração;
- uma entrada append-only de auditoria estrutural.

## Base operacional de 30 dias

O mesmo `pnpm db:seed` cria 320 leads explicitamente fictícios, distribuídos
pelos 30 dias anteriores ao instante da primeira execução. A base inclui:

- 80 P1, 140 P2 e 100 P3, com score vigente e componentes explicáveis;
- oito etapas de pré-vendas, cinco origens, duas campanhas, quatro criativos,
  seis atuações e dez combinações de cidade/estado;
- 32 novas submissões anexadas por telefone, com revisão de identidade;
- atribuição round-robin aos três SDRs e exemplos explícitos de Fila Geral;
- tarefa `Ligar agora`, ciclos de SLA saudável, atenção, crítico e sem tentativa,
  atividades humanas e próximas ações persistidas;
- PACTO em rascunho e validado, com evidência e revisão histórica;
- 80 reuniões com agendadas, confirmadas, realizadas, no-shows e canceladas;
- oportunidades abertas, propostas, negociação, ganhos e perdas com valores em
  centavos, histórico completo e snapshots financeiros;
- execuções das 12 automações, incluindo sucesso, falha controlada e
  cancelamento, sem enviar mensagens externas;
- 48 insights de IA local determinística, violações de processo e auditoria.

Cancelamentos nunca recebem `noShowAt`. Ganhos percorrem reunião agendada,
realizada, oportunidade confirmada, proposta, negociação e ganho antes do
snapshot financeiro. Métricas usam as mesmas submissões, ciclos, históricos de
reunião e snapshots consultados pelo dashboard.

Nomes seguem `Lead demonstrativo NNN`; organizações são fictícias, e-mails usam
`example.invalid` e telefones usam uma faixa deliberadamente não roteável. O
payload bruto também declara `simulated: true`.

### Seletores estáveis para demonstração e E2E

| Lead | Cenário garantido |
|---|---|
| `Lead demonstrativo 001` | P1, opt-out e tentativa saudável |
| `Lead demonstrativo 010` | nova submissão anexada por telefone |
| `Lead demonstrativo 016` | reunião encerrada como no-show |
| `Lead demonstrativo 020` | reunião cancelada, sem no-show |
| `Lead demonstrativo 028` | oportunidade ganha com caminho histórico completo |
| `Lead demonstrativo 037` | erro operacional sem próxima ação |
| `Lead demonstrativo 040` | atribuição explícita à Fila Geral e sem tentativa |

Além dos seletores, usuários Administrador, Gestor, SDR, Closer e Visualizador
permitem exercitar os cenários de permissão documentados no `README.md`.

## SLA e prioridade

| Faixa | Score | Prioridade | SLA | Faixa visual |
|---|---:|---|---:|---|
| P1 | 70–100 | Urgente | 0 min | saudável até 60 s; atenção até 180 s; crítico acima |
| P2 | 40–69 | Alta | 0 min | saudável até 60 s; atenção até 180 s; crítico acima |
| P3 | 0–39 | Média | 0 min | saudável até 60 s; atenção até 180 s; crítico acima |

As faixas cobrem 0–100 sem sobreposição. As três usam a política
`SLA imediato — 0 minutos`; limites visuais não concedem tolerância ao prazo.

## Datas e reset seguro

As datas são relativas ao instante da primeira criação do conjunto. Como
`StageHistory`, atividades, auditoria, PACTO, score e snapshots são append-only,
reexecutar o seed não move fatos históricos. Para renovar a janela de 30 dias,
use um schema descartável separado:

```bash
export DATABASE_URL="postgresql://politizai:politizai_local_only@localhost:5432/politizai_crm?schema=politizai_demo_local"
export DEMO_RESET_CONFIRM="RESET politizai_demo_local"
pnpm db:demo:reset
```

O comando recusa `public`, hosts remotos, produção, nomes fora do padrão
`politizai_demo*` e confirmação divergente. Ele remove somente o schema
confirmado, reaplica migrations e cria uma base atual. Registros manuais em
outros schemas não são tocados; dados manuais no schema descartável fazem parte
do alvo e não devem ser usados ali.

`pnpm test:crm29` usa exclusivamente `politizai_demo_crm29_test`, recriado pelo
runner com a mesma proteção de alvo.

## Credenciais

As contas e a senha compartilhada exclusivamente local estão no `README.md`.
Os e-mails de usuários usam `demo.politizai.local`, e nenhuma identidade pessoal
ou credencial de produção é criada.
