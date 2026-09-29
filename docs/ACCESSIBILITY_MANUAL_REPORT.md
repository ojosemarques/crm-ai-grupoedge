# Relatório manual de acessibilidade — recuperação PROD-10

## Ambiente e método

- data: 15 de setembro de 2026;
- macOS com **VoiceOver real** iniciado pelo sistema;
- Google Chrome com o build autenticado do mesmo código do staging conectado
  somente ao banco sintético de staging;
- zoom real do navegador elevado de 100% para 200% pelo menu do Chrome e
  confirmado pela redução da viewport CSS de 1710 para 855 pixels;
- VoiceOver e o certificado/proxy local temporário foram encerrados e removidos
  após a inspeção.

O accessibility tree foi usado como evidência complementar, não como substituto
do leitor de tela. Não foi gravado áudio dos anúncios do VoiceOver.

## Resultado

| Fluxo | Evidência | Resultado |
|---|---|---|
| Login | heading, campos nomeados, ação de entrada e mensagem de erro/status acessíveis | PASS |
| Dashboard | landmarks, h1/h2, KPIs com links, gráfico com nome e alternativa tabular | PASS |
| Meu Dia | h1, ações, atualização e região de status nomeados | PASS |
| Leads | busca, filtros, tabela com caption/cabeçalhos e paginação nomeados | PASS |
| Filtros de Leads | diálogo nomeado, grupo de checkboxes, fechar, limpar e aplicar; operação preservada em 200% | PASS |
| Pipeline | landmarks, contagens, regiões por etapa, cartões e ações nomeados | PASS |
| Diálogo Alterar etapa | `dialog` nomeado, foco inicial dentro, campos associados e retorno do foco ao botão de origem após cancelar | PASS |
| Sucesso/erro | regiões `status`/`alert` presentes e mensagens operacionais textuais, sem depender somente de cor | PASS |
| Logout | ação nomeada e retorno ao login | PASS |

## Zoom real de 200%

Dashboard, Leads, filtros e Pipeline foram abertos a 200%. Em todos:

- `documentElement.scrollWidth` permaneceu igual ao `clientWidth`;
- não houve overflow horizontal da página;
- texto e controles continuaram utilizáveis;
- a navegação lateral virou controle compacto;
- o diálogo de etapa permaneceu dentro da viewport (`576×339,75` em viewport
  `855×377`) e manteve rolagem interna quando necessária;
- a informação de estado continuou textual, sem depender apenas de cor/hover.

## Limitações honestas

A inspeção foi executada por um único operador/agente, sem sessão gravada e sem
segunda pessoa usuária de tecnologia assistiva. Antes do go-live recomenda-se
uma rodada humana independente com usuário habitual de leitor de tela, mas isso
não permanece como bloqueio técnico do staging gratuito.
