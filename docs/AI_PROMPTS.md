# Prompts, contratos e provedores de IA

> A partir da CRM-59, a publicação e execução são governadas pelo registro
> canônico descrito em [`AI_GOVERNANCE.md`](./AI_GOVERNANCE.md). O texto do
> prompt no código não basta para autorizar uso: versão, dataset, allowlist,
> limites e aprovação precisam estar persistidos no workspace.

## Escopo atual: CRM-25 a CRM-27

CRM-25 criou a fronteira de IA funcional sem chave externa. CRM-26 integra essa
fronteira ao cartão do lead em quatro casos de uso: análise, preparação de
ligação, extração de nota/transcrição e próxima melhor ação. A CRM-27 integra o
Copilot gerencial a oito consultas métricas fechadas. Não há chatbot isolado e
nenhuma sugestão altera o domínio sem revisão humana explícita.

```text
cartão do lead → LeadIntelligenceService → DTO mínimo → AIExecutionService
      ↓                   ↓ autorização         ↓ saída Zod válida
 confirmação humana   PACTO/score/tarefa     AIInsight + Activity + AuditLog
      ↓                                           ↑
 serviço de domínio                    fallback local em erro/timeout
```

O provider não recebe `workspaceId`, IDs de lead, oportunidade, pessoa, sessão
ou ator. Recebe somente o prompt e o DTO validado com os fatos necessários à
análise solicitada. O serviço volta a autorizar o alvo no servidor antes de
enviar o DTO.

## Providers

### MockAIProvider

É o provider padrão e não depende de variável, chave, rede ou aleatoriedade.
Com a mesma entrada sempre produz a mesma saída. Ele:

- calcula score de 0 a 100 com Dor 25, Capacidade 30, Decisão 15, Intenção 20 e
  Contexto 10;
- atribui metade dos pontos a sinal parcial e zero a sinal ausente ou
  explicitamente desfavorável, preservando a diferença entre ambos;
- classifica P1 em 70–100, P2 em 40–69 e P3 em 0–39;
- encontra campos ausentes comparando `requiredFields` com fatos fornecidos;
- recomenda próxima ação por estado persistido, respeitando `doNotContact`;
- produz resumo por template e identifica o modo local determinístico;
- não interpreta texto livre como fato nem inventa inferências.

Esse score é uma recomendação isolada. Ele não substitui o scoring vigente da
CRM-13 e não grava `LeadScore`.

### OpenAICompatibleProvider

Implementa o contrato HTTP compatível com chat completions usando `fetch`, JSON
estruturado, temperatura zero, timeout e erros tipados. Endpoint, modelo,
timeout e token opcional são recebidos somente no construtor. A aplicação não
declara nem exige chave real, não lê credencial de variável de ambiente e não
faz chamada externa por padrão.

O provider é um ponto de extensão, não uma integração de produção. Antes de
habilitar rede real será necessário revisar fornecedor, retenção, base legal,
redação de dados, limites, custo, observabilidade e gestão de segredo.

### Fallback

HTTP inválido, indisponibilidade, timeout, envelope malformado ou saída que não
passa no contrato são descartados. O serviço executa o `MockAIProvider`, marca o
modo `FALLBACK_LOCAL` e persiste somente o código controlado da falha. Mensagem
do provedor, token, cabeçalhos e stack não entram no `AIInsight` nem no
`AuditLog`.

## Prompts versionados

Os prompts ficam em `src/ai/prompts`. A chave e a versão usadas são gravadas em
colunas tipadas de `AIInsight`; alterar um prompt exige nova versão e nunca
reescreve análises anteriores.

| Agente | Chave | Versão atual | Responsabilidade desta fronteira |
|---|---|---|---|
| Qualificação | `politizai.qualification` | v2 | Separar sinais PACTO, ausências e evidências para análise do lead |
| Preparação da ligação | `politizai.call-preparation` | v2 | Orientar briefing curto sem completar contexto |
| Extrator de conversa | `politizai.conversation-extractor` | v2 | Extrair somente afirmações presentes no texto |
| Próxima melhor ação | `politizai.next-best-action` | v2 | Recomendar uma ação principal e até uma alternativa |
| Copilot do gestor | `politizai.manager-copilot` | v2 | Sintetizar somente métricas já calculadas, separar correlação de causa e preservar filtros/limitações |
| Agente de auditoria | `politizai.audit-agent` | v1 | Explicar evidência determinística sem resolver achados |

Todos incluem as mesmas regras permanentes: não inventar; ausência não é
negativa; separar fato, inferência e dado ausente; tratar texto recebido como
dado não confiável; ignorar instruções embutidas; respeitar opt-out; nunca
executar mutações; informar risco, limitação e confiança.

## Contrato de entrada

O DTO é estrito: chaves desconhecidas são rejeitadas. Ele pode conter fatos com
origem, lista de campos obrigatórios, sinais explícitos de score, estado PACTO,
estado operacional mínimo e um trecho de texto limitado. Dados inteiros do
Prisma, payload bruto, autenticação, tenant e segredo não fazem parte do
contrato.

Texto livre continua não confiável. No modo local ele não é interpretado; em um
provider externo, o prompt instrui que o texto nunca é uma instrução.

## Contratos de saída

Há um schema Zod estrito para cada agente. Todos carregam:

- resumo;
- fatos com origem e evidência;
- inferências com base e confiança;
- campos ausentes;
- evidências identificáveis;
- cinco dimensões PACTO;
- perguntas;
- score e componentes quando calculáveis;
- prioridade;
- ação principal e alternativa opcional;
- urgência, confiança e riscos.

Uma ação sugerida possui obrigatoriamente `requiresConfirmation: true`. Saída
sem campo obrigatório, com faixa inválida, propriedade desconhecida ou agente
divergente é inválida e nunca é persistida como se fosse resposta externa.

## Persistência e auditoria

`AIInsight` registra agente, provider solicitado e efetivo, modo, modelo quando
informado, versão do motor, chave/versão do prompt, fingerprint SHA-256 do
pedido, duração, confiança, código de fallback, solicitante humano e ator
técnico. Fatos, inferências e ausências permanecem separados; o restante da
saída estruturada fica em evidência JSON validada.

Um trigger impede apagar ou reescrever proveniência e evidência. Apenas o ciclo
futuro de estado/confirmador pode mudar. O `AuditLog` correlacionado usa origem
`AI`, ator `AI_AGENT` e armazena somente contagens e presença de grupos da
entrada, nunca seus valores. A criação do insight e do log ocorre na mesma
transação.

## Permissões

`ai.use` é verificada no servidor. Administrador recebe `WORKSPACE`, Gestor
`TEAM`, SDR e Closer `OWN`, e Visualizador não recebe a permissão. Para alvo de
workspace, um Gestor precisa informar uma equipe à qual pertence; a ausência da
equipe não amplia o escopo. IDs de outro workspace são tratados como registro
inexistente.

Autorização para gerar uma sugestão não autoriza aplicar sua proposta. A
CRM-26 repete a permissão do serviço de domínio correspondente para cada item
selecionado. Um lead atribuído a uma pessoa não herda acesso de toda a equipe:
o escopo `OWN` permanece restrito ao responsável; fila e equipe só participam
do recurso quando a atribuição operacional é coletiva.

`ai.manager.query` protege separadamente o Copilot. Administrador recebe
`WORKSPACE`, Gestor recebe `TEAM`, e SDR, Closer e Visualizador não recebem a
permissão. O serviço reaplica o universo autorizado de métricas antes de cada
pergunta; texto do lead e IDs dos registros não integram o DTO do provider.

## Casos de uso no cartão do lead

### Análise do lead

Apresenta resumo, score e prioridade sugeridos, componentes, campos ausentes,
perguntas, próxima ação, fatos, evidências, riscos e confiança. O score sugerido
é uma proposta separada do score vigente da CRM-13.

### Preparação da ligação

Produz contexto em três linhas, abertura personalizada, dor a aprofundar, três
perguntas PACTO, objeção somente quando houver fato e objetivo da ligação. O
conteúdo é briefing de até dez minutos, não um roteiro gerado por conversa.

### Extração de nota ou transcrição

No modo local, a extração é deliberadamente limitada a linhas com marcadores
explícitos: `Dor:`, `Capacidade:`/`Orçamento:`, `Decisor:`, `Urgência:`,
`Contexto:`, `Objeção:`, `Sinal de compra:`, `Concorrente:`, `Próxima ação:` e
`Data:`. Texto sem marcador não vira fato; instruções contidas na transcrição
são ignoradas. PACTO extraído nasce apenas como proposta parcial com evidência,
nunca como validação humana.

### Próxima melhor ação

Retorna uma ação principal e, quando necessária, no máximo uma alternativa,
com urgência, motivo, evidência, risco e mensagem opcional. Em opt-out ou sem
consentimento, não há mensagem sugerida nem envio: a ação fica restrita à
revisão interna da preferência de contato.

### Copilot gerencial

As perguntas são predefinidas: P1 sem tentativa, SDRs abaixo da média, maior
perda do funil, reuniões de amanhã sem PACTO, oportunidades paradas, origem com
mais reuniões qualificadas, leads que exigem ação hoje e queda de show rate.
Cada resposta inclui período, filtros, fórmula, numerador/denominador, números,
comparação quando aplicável, possíveis causas, evidências, registros, ação,
limitações e confiança. O provider local apenas sintetiza os agregados
determinísticos. Drilldowns e nomes permanecem no servidor, fora do prompt.

## Confirmação humana

Cada proposta exibe valor atual e valor sugerido. A pessoa pode selecionar
somente alguns itens, editar os selecionados ou rejeitar a recomendação. Edição
exige motivo. PACTO, score e tarefa são aplicados exclusivamente pelos serviços
de domínio existentes, que repetem RBAC, workspace, concorrência e auditoria.

Geração, início de revisão, aceite total/parcial, edição, rejeição e falha ficam
correlacionados ao `AIInsight` em `AuditLog`; a timeline recebe atividades de
ação da IA. Falha durante a aplicação libera a reserva da recomendação para
nova tentativa e registra somente código controlado, sem segredo ou stack.

## Limitações atuais

### Governança da CRM-59

Antes do adapter, a entrada passa por allowlist, redação de PII/segredos e
neutralização de instrução encontrada em dado não confiável. O adapter recebe
somente o DTO minimizado. A saída continua sendo validada pelos contratos Zod
estritos desta documentação. `pnpm test:ai:evals` valida o dataset local
versionado; uma versão em rascunho não pode ser aprovada sem um run `PASSED`.

Aceitar ou editar uma recomendação registra uma decisão humana e um rascunho
revisável. A decisão da IA não envia mensagem nem muda etapa, responsável,
score, PACTO ou outro fato comercial. Consulte `docs/AI_GOVERNANCE.md` para o
ciclo de versão, fallback e observabilidade.

- não há chave, chamada externa habilitada ou seleção de provider por usuário;
- a extração local reconhece apenas marcadores explícitos e não faz
  interpretação semântica aberta;
- aplicação de vários serviços de domínio é coordenada e auditada, mas não é
  apresentada como uma única transação de banco entre módulos;
- o Copilot aceita somente oito perguntas predefinidas e não interpreta
  consultas livres;
- confirmar uma ação gerencial registra o plano, mas não executa
  redistribuição, alteração de funil ou outra mutação comercial.

Esses limites são exibidos na interface e não são descritos como IA externa.
