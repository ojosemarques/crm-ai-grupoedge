# 09 — UX para TV

## Wireflow

```text
[Rail: Ranking | Desempenho | Pausar | Tela cheia | Compartilhar | Voltar ao CRM]
[TEMPO REAL | Status de conexão/qualidade | Workspace]

RANKING — carvão/menta
[Total de ações][Contatos efetivos][Contagem regressiva até sábado 00h local]
[1º com medalha dourada][2º][3º]
[Tabela: posição | profissional | ligações | mensagens | contatos | reuniões | vendas | ações]
[Atualização | Timezone | Próxima tela em 60s | Indicador de slide]

DESEMPENHO — branco dentro de moldura azul
[Contatos][Receita][Ligações e mensagens] | [Contatos][Reuniões]
[Fluxo de atividade de hoje]             | [Movimento da equipe]
[Distribuição circular][Série diária]    | [Pódio 2/1/3]
                                        | [Meta semanal]
```

## Direção visual

O pedido de refatoração de 22/10/2026 substitui a direção inicial: reproduzir as duas composições das imagens fornecidas pelo proprietário (as duas referências escuras são idênticas). Ranking com fundo carvão, superfícies cinza, acento menta e medalha dourada; desempenho com moldura azul, cards brancos, fluxo azul, anel multicolorido e pódio cilíndrico. Conteúdo, nomes e números vêm do CRM; avatares usam iniciais reais quando não há foto disponível no contrato.

## Layout

- Alvo 1920×1080; mínimo 1366×768.
- Métricas essenciais sem scroll manual.
- Top 3 + tabela com quatro linhas por página. Páginas avançam a cada 12 segundos e a posição é preservada entre os ciclos para incluir toda a equipe.
- Shell próprio nas rotas exatas privada e pública; autenticação e autorização da rota privada permanecem no servidor.
- Desktop/tablet reorganiza colunas sem esconder valores.
- Fullscreen via Web API, com fallback informativo.

## Timers

- Exatamente Ranking e Desempenho.
- 60 s por slide; manual reinicia o contador.
- Contador textual e indicador de slide; pausa e atalhos de setas/espaço.
- Abrir o diálogo de compartilhamento suspende a apresentação; o polling continua separado.
- `prefers-reduced-motion`: sem transições; troca instantânea.
- Timers cancelados no unmount; polling separado do timer de slide.

## Estados e acessibilidade

- Carregamento só antes da primeira leitura; falhas transitórias preservam o snapshot. Um 404 público remove o snapshot revogado na próxima leitura, sem exigir reload.
- `Ao vivo`, `Parcial`, `Atrasado` e `Offline` não dependem só de cor.
- Nomes longos truncam visualmente com texto acessível.
- Botões têm foco visível e labels; nenhuma ação depende de hover.
- Meta ausente: “Não configurada”.
- Zero real: `0`; indisponível: `—`.
- Linguagem do ranking é neutra: “atividade na semana”, nunca “pior”, “fracasso” ou punição.

## Gestão autenticada

Botão de compartilhamento no rail abre diálogo nativo com foco contido e fechamento por Escape: gerar/rotacionar, copiar link recém-gerado e revogar. Rotação informa a invalidação; segredo anterior nunca reaparece.
