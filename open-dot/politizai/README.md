# Bundle Open-Dot da Prospecção Ativa

Bundle versionado para configurar os três Dots separados da Politizai. Ele foi conferido contra o Open-Dot oficial no commit `f838e17cf5c3a88ade5ceea54680a8145d048c1d`.

## Instalação segura

1. Instale ou execute o Open-Dot conforme o repositório oficial.
2. Crie três Dots com os nomes, propósito e instruções declarados em `manifest.json` e `dots/*.md`.
3. Em cada computador/workspace do Dot, copie `client.mjs` e `manifest.json` juntos.
4. Injete somente a credencial daquele Dot pelo vault/ambiente:
   - `POLITIZAI_OPEN_DOT_ROLE=research|auditor|email`;
   - `POLITIZAI_OPEN_DOT_CLIENT_ID=<clientId público>`;
   - `POLITIZAI_OPEN_DOT_SECRET=<segredo HMAC de no mínimo 32 caracteres>`;
   - `POLITIZAI_CRM_BASE_URL=https://crm-ai-grupoedge.vercel.app`.
5. Salve como skill do Dot o uso do cliente abaixo e proíba HTTP genérico para o CRM.
6. Não coloque credenciais nos campos Instructions, Memory, Skill, chat, rotina ou arquivo compartilhado do Open-Dot.

O Open-Dot atual não fornece importador público de Dots/skills. Por isso este bundle não altera diretamente o banco SQLite privado da aplicação; a configuração é feita pela tela Setup e continua compatível com o modelo público `name`, `purpose`, `instructions`, `rules` e `skills`.

## Uso do cliente

```bash
node client.mjs --help
node client.mjs create-batch --idempotency-key batch.2026-10-05 --body batch.json
node client.mjs submit-candidate --idempotency-key candidate.3550308.123 --body candidate.json
node client.mjs get-batch --idempotency-key batch.read.2026-10-05 --id 00000000-0000-4000-8000-000000000000
node client.mjs review-candidate --idempotency-key review.0001 --id 00000000-0000-4000-8000-000000000000 --body review.json
node client.mjs claim-email --idempotency-key claim.2026-10-05T1200 --body claim.json
```

O corpo nunca deve ser passado na linha de comando. Use arquivo privado ou `--body -` para stdin. O cliente assina método, path, timestamp, nonce e SHA-256 do corpo; rejeita comandos fora do papel; limita o corpo a 256 KiB; aceita somente a origem canônica (ou loopback explicitamente habilitado); não segue redirects; não registra segredo, payload nem corpo de erro.

## Regras obrigatórias por Dot

- `never`: usar comando fora da lista do papel;
- `never`: mostrar, salvar ou enviar o segredo HMAC;
- `never`: usar navegador ou HTTP genérico para contornar o cliente;
- `ask`: conectar ou trocar conta de provider;
- `ask`: habilitar rotina/trigger de produção;
- `ask`: efetuar o primeiro envio em sink, sandbox ou canário.

Mesmo que uma regra local seja configurada incorretamente, o CRM ainda valida HMAC, escopo, nonce, idempotência, gate, template, remetente e opt-out.
