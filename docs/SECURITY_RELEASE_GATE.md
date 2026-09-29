# Gate de segurança e supply chain

## Política versionável

`pnpm security:scan` inspeciona somente arquivos rastreados pelo Git e falha sem
imprimir o conteúdo encontrado. A política bloqueia:

- arquivos de ambiente reais, preservando somente os três modelos aprovados;
- `.next`, dependências, cache, relatórios de teste, logs e artefatos gerados;
- dumps, backups, credenciais e extensões de chave privada;
- marcadores de chave privada;
- formatos conhecidos de tokens GitHub, OpenAI/Stripe, Slack, AWS e Google;
- variáveis `NEXT_PUBLIC_*` com nome sensível e valor preenchido;
- URL PostgreSQL utilizável em host remoto não reservado.

O scanner reporta somente caminho, linha, código e classe do problema. Valores
e correspondências não são serializados. Arquivo rastreado acima de 5 MiB
bloqueia a execução para evitar uma omissão silenciosa; binários permanecem
cobertos pela política de caminho/extensão, mas não passam por heurística de
texto.

Heurística não substitui revisão humana nem um produto de secret scanning com
histórico completo. Antes de qualquer dado real, habilitar GitHub Secret
Protection ou alternativa equivalente e revisar todo o histórico Git.

## Dependências

Política adotada:

- versões diretas exatas em `package.json`;
- instalação somente com lockfile congelado no CI;
- atualização semanal pelo Dependabot para npm e GitHub Actions;
- actions fixadas por SHA, com comentário do major auditado;
- `pnpm audit --audit-level=high` bloqueante em toda execução;
- atualização major exige PR separada, changelog, compatibilidade com Next.js
  instalado, testes direcionados e build;
- nenhuma atualização automática faz merge ou deployment.

Dependabot alerts e automated security fixes estão habilitados no repositório.
O `dependency-review-action` e o CodeQL privado/GitHub Code Security exigem
GitHub Advanced Security no contexto atual e, por isso, não foram adicionados
como checks fictícios ou permanentemente vermelhos. Ao mudar de plano, habilitar
Code Security e dependency review antes de dados reais.

## SBOM e relatório

O CI usa Anchore Syft por action fixada para gerar
`.cache/release-gate/sbom.spdx.json`. O arquivo:

- descreve componentes do checkout e dependências instaladas;
- não é anexado a GitHub Release;
- não é versionado;
- é enviado somente como artefato interno da execução por 14 dias;
- deve ser regenerado para cada SHA de release.

`scripts/generate-release-gate-report.ts` gera JSON tipado por versão e um
resumo Markdown. O relatório registra SHA, run, status e gates, além das
garantias negativas de deploy, banco remoto e migration remota. Ele nunca lê ou
lista o ambiente completo.

## Modelo de ameaça do workflow

- PR e push comum não recebem credenciais de nuvem;
- `GITHUB_TOKEN` possui apenas leitura de conteúdo;
- checkout usa `persist-credentials: false`;
- input do gate manual precisa ser SHA hexadecimal completo e existir no repo;
- nenhuma expressão do usuário é interpolada como comando sem validação;
- banco é criado no runner e descartado no fim;
- relatório e SBOM não têm permissão de publicação de release;
- falha de teste mantém o job e o gate manual bloqueados.

Riscos restantes:

- sem ruleset, um administrador ainda consegue fazer push direto em `main`;
- secret scanning local não cobre commits antigos ou todos os formatos
  proprietários;
- `pnpm audit` depende do advisory database disponível no momento;
- SBOM não é assinada nem atestada nesta fase;
- não há SAST premium, DAST ou assinatura de artefato;
- os artefatos de Actions seguem a retenção e o controle de acesso do GitHub.

Esses riscos mantêm produção em NO-GO e precisam de owners antes do go-live.

## Resposta a falhas

1. Não contornar o check nem publicar o SHA.
2. Abrir o relatório da execução sem copiar valores sensíveis.
3. Corrigir somente a causa, adicionar regressão e gerar novo commit.
4. Se houver segredo, revogar/rotacionar antes de remover do código; limpar o
   histórico sob procedimento aprovado.
5. Executar novamente o CI e, no corte futuro, o gate manual com o novo SHA.

## Fontes oficiais

- [GitHub — protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [GitHub — rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [GitHub — secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
- [GitHub — Advanced Security](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security)
- [Dependency Review Action](https://github.com/actions/dependency-review-action)
- [Anchore SBOM Action](https://github.com/anchore/sbom-action)
