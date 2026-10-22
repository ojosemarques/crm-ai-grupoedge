# 09 — UX para TV

## Wireflow

```text
[Marca | Workspace | AO VIVO/PARCIAL/ATRASADO | atualização | tela cheia]
[Geral ● 60s ○ Ranking]

GERAL
[HOJE --------------------------------][SEMANA ------------------------------]
[Contato][Ligações][Mensagens]         [Contato][Ligações][Mensagens]
[Agendadas][Realizadas][Vendas]        [Agendadas][Realizadas][Vendas]
                                      [Meta semanal + progresso]

RANKING
[1º grande][2º][3º]
[demais: posição | nome | ações | contato | ligação | mensagem | reuniões | vendas]
```

## Direção visual

Fundo grafite, superfícies escuras de alto contraste, tipografia grande e acentos verde/azul da marca. A referência clara contribui com modularidade e respiro; a escura contribui com presença de placar. Nenhuma marca, medalha, avatar ou texto de terceiros é copiado.

## Layout

- Alvo 1920×1080; mínimo 1366×768.
- Métricas essenciais sem scroll manual.
- Top 3 + tabela compacta; muitos vendedores usam densidade responsiva e paginação visual futura somente se exceder o limite testado.
- Desktop/tablet reorganiza colunas sem esconder valores.
- Fullscreen via Web API, com fallback informativo.

## Timers

- Exatamente Geral e Ranking.
- 60 s por slide; manual reinicia o contador.
- Progresso textual/visual e `aria-live` discreto.
- `prefers-reduced-motion`: sem transições; troca instantânea.
- Timers cancelados no unmount; polling separado do timer de slide.

## Estados e acessibilidade

- Skeleton só antes da primeira leitura; depois, preservar snapshot.
- `Ao vivo`, `Parcial`, `Atrasado` e `Offline` não dependem só de cor.
- Nomes longos truncam visualmente com texto acessível.
- Botões têm foco visível e labels; nenhuma ação depende de hover.
- Meta ausente: “Não configurada”.
- Zero real: `0`; indisponível: `—`.
- Linguagem do ranking é neutra: “atividade na semana”, nunca “pior”, “fracasso” ou punição.

## Gestão autenticada

Faixa discreta fora do placar principal: gerar/rotacionar, copiar link recém-gerado, revogar e abrir preview. Rotação exige texto claro de invalidação; segredo anterior nunca reaparece.
