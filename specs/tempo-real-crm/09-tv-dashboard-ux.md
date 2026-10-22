# 09 — UX para TV

## Wireflow

```text
[Rail: Geral | Ranking | Pausar | Tela cheia | Compartilhar | Voltar ao CRM]
[TEMPO REAL | Status | Escuro/Claro | Workspace]
[Título/contexto da visão | Geral/Ranking]
[Ações hoje][Ações semana][Execuções hoje/semana][Meta semanal de vendas]

GERAL
[Hoje: 6 métricas + metas + receita] [Semana: 6 métricas + metas + receita] [Meta vendas / Série diária]

RANKING
[1º: nome, ações, execuções, metas atingidas][2º][3º]
[Tabela: pessoa | contatos | ligações | mensagens | agendadas | realizadas | vendas | execuções]
[Cada atividade: hoje/meta diária e semana/meta semanal; 4 pessoas por página]
[Atualização | Timezone/fontes | Próxima tela em 60s | Indicador de slide]
```

## Direção visual

O pedido corretivo de 22/10/2026 unifica as composições: mesmo rail, cabeçalho, resumo, tipografia e superfícies nas duas visões. Escuro carvão/azul padrão, claro opcional por tokens, sem associar aparência ao slide. A marca usa o SVG original Politizai (`public/brand/politizai-logo-vector.svg`) e seu azul `#1F35FD`, com tons mais claros para legibilidade no tema escuro; destaques verdes foram substituídos por azuis. Tema persistido por navegador e query `theme`, preservando o token no fragmento. Avatares usam iniciais reais; valores e metas vêm do CRM.

## Layout

- Alvo 1920×1080; mínimo 1366×768.
- Métricas essenciais sem scroll manual.
- Top 3 + tabela com quatro linhas por página. Páginas avançam a cada 12 segundos e a posição é preservada entre os ciclos para incluir toda a equipe.
- Ranking restrito às contas de Carlos Henrique, Ede Rafael e Jhon Cunha, identificadas no servidor pelo e-mail normalizado. Matheus Mendon, Administrador e demais contas não aparecem nas linhas nem no pódio; os totais e as metas gerais continuam considerando a base completa. A mesma regra vale para o painel privado e o público.
- Shell próprio nas rotas exatas privada e pública; autenticação e autorização da rota privada permanecem no servidor.
- TV mantém métricas sem scroll; celular empilha os painéis e usa scroll interno na tabela individual.
- Fullscreen via Web API, com fallback informativo.

## Timers

- Exatamente Geral e Ranking.
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
- Meta ausente: “Sem meta cadastrada”, “—” e barra vazia. Cobertura parcial é identificada. Metas WA/IG e contatos-dia explicam diferenças em relação aos totais únicos do período.
- Zero real: `0`; indisponível: `—`.
- Linguagem do ranking é neutra: “atividade na semana”, nunca “pior”, “fracasso” ou punição.

## Gestão autenticada

Botão de compartilhamento no rail abre diálogo nativo com foco contido e fechamento por Escape: gerar/rotacionar, copiar link recém-gerado e revogar. Rotação informa a invalidação; segredo anterior nunca reaparece.
