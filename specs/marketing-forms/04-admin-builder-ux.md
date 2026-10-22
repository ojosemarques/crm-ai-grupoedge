# 04 — Builder administrativo

## Objetivo

Reproduzir a hierarquia e densidade das 11 imagens de referência usando o design system real, sem copiar bugs, marca externa ou IDs.

## Índice

- Cabeçalho “Formulários” e CTA “Criar formulário”.
- Busca e filtros `Todos/Rascunho/Publicado/Pausado/Arquivado`.
- Tabela responsiva: nome, status, versão, respostas, conclusão, autor, atualização e ações.
- Cards em 390 px; paginação server-side; confirmações acessíveis.

## Criação

Dialog: nome, slug sugerido editável, “em branco” ou template local “Qualificação de mandato”. Cria rascunho com primeira pergunta e thank-you; navega ao editor. Não publica.

## Header/editor

- Voltar, nome, tabs `Editor`, `Opções`, `Estilo`, `Métricas`, `Compartilhar`, `Respostas`, `Estatísticas`.
- `Ver`, compartilhar e status/publicar à direita.
- Sticky; tabs scrolláveis em mobile; foco/teclado.
- Estado de save: `Salvando`, `Salvo`, `Erro ao salvar`, `Conflito — recarregue`.

## Aba Editor

- Sidebar 320 px em desktop; lista número/título/badge, selecionado destacado; adicionar campo.
- Canvas central com seletor de tipo, toggle obrigatório, mídia (URL allowlisted), opções, título/descrição, alternatives e mapping.
- Duplicar, excluir, subir/descer. Drag é complemento, nunca único controle.
- Nenhuma opção preselecionada por padrão.
- THANK_YOU não pode ser removido e fica terminal.

## Aba Opções

Cards verticais como imagens 2–4:

1. Geral: nome, slug, status/version, success message e URL.
2. Destino CRM: selects reais de source, pipeline, etapa dependente, tags, queue e prioridade.
3. WhatsApp individual: toggle, E.164, mensagem e preview.
4. Grupo: link, botão manual e auto redirect.
5. Rotação: endpoints ordenados, labels, ativos, contadores e reset auditável.

Combinações ambíguas exibem erro antes de salvar/publicar.

## Aba Estilo

Painel esquerdo ~400 px e preview vivo, seguindo imagem 5. Inputs de cor com valor textual, fonte allowlisted (`Inter`, `system-ui`, `Georgia`), presets de raio/alinhamento/largura, URL de logo/fundo, desktop/mobile e reset. Contraste inferior a AA bloqueia publicação.

## Aba Métricas

Cards Meta/Google como imagem 6. Secret aparece apenas como `Referência presente/ausente`; nunca campo com token mascarado. “Testar integração” é ação explícita, auditada e informa `simulado`, `configurado`, `homologado` ou erro seguro.

## Compartilhar

Como imagem 7: URL, copiar/abrir, QR, download e UTM builder. Sem versão ativa mostra callout “Publique para gerar o link”.

## Respostas

Como imagens 8–10: toolbar de busca/data/filtros/export; tabela server-side; modal `AccessibleDialog` com scroll, versão, UTMs, perguntas na ordem do snapshot e links CRM. Ações com label e confirmação; sem ícone sem nome acessível.

## Estatísticas

Como imagem 11: cards por pergunta fechada com contagem, percentual e barra; cabeçalho com participações; filtros de período/versão/UTM; resumo de funil antes das distribuições.

## Responsividade

- 1440: layout completo.
- 1024: sidebar reduzida e preview flexível.
- 768: tabs scrolláveis; Editor empilha lista/canvas.
- 390: cards, controles 44 px+, tabela vira lista; dialog quase full-screen.

## Acessibilidade

Heading único, `fieldset/legend`, labels, foco visível, announcements de save/erro, `aria-current` nas tabs, switch nomeado, reordenação por botões, dialogs com focus trap/restore e contraste AA.

## Estados

Skeletons sem layout shift; empty states orientam próxima ação; permission state não renderiza controles; 409 preserva edição local e oferece recarregar/copiar conteúdo; erros por campo + resumo `aria-live`.

## Comparação com referências

- Imagem 1: lista lateral + canvas e header reproduzidos.
- Imagens 2–4: cards de opções e destino/WhatsApp.
- Imagem 5: painel estilo + preview.
- Imagem 6: integrações; corrige exposição de token.
- Imagem 7: link/QR/UTM.
- Imagens 8–10: tabela/modal.
- Imagem 11: distribuição fechada.
- Runtime público observado: conteúdo central, progress 4 px, CTA azul, navegação lateral discreta; sem badge Lovable.

## Testes/aceite

- Component/unit para reducers, tabs, forms e errors.
- E2E cria/edita/publica/pausa/duplica/arquiva.
- Screenshots nos quatro viewports, teclado, zoom 200% e reduced motion.
- Nenhuma action administrativa funciona apenas por ocultação visual; API nega também.
