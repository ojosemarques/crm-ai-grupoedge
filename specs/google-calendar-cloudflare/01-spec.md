# Google Calendar no Cloudflare

## Resumo

Migrar a integração Google Calendar do runtime Vercel para o Worker `grupo-edge-crm`, mantendo as cinco contas existentes sem exigir nova autorização.

## Objetivo

- configurar o cliente OAuth do projeto Google Cloud `crm-politizai` para o callback oficial;
- armazenar client ID, client secret e chave de cifragem somente como secrets de produção;
- rotacionar a chave de cifragem sem expor tokens em claro;
- manter o worker agendado sincronizando contas habilitadas.

## Escopo

- callback `https://crm.edgegrupo.com/api/integrations/google-calendar/callback`;
- rotação transitória com `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY_NEXT`;
- tokens de acesso, refresh tokens e cursores de pull das contas existentes;
- estados OAuth ainda válidos;
- validação de leitura e refresh reais sem registrar credenciais.

## Fora do escopo

- habilitar `pullEnabled` para contas que o usuário deixou pausadas;
- alterar escopos OAuth;
- remover clientes OAuth de outros produtos.

## Aceite

- cinco contas permanecem `CONNECTED`;
- todos os ciphertexts são legíveis pela nova chave;
- callback oficial está autorizado;
- secrets existem no Cloudflare Production;
- pelo menos uma execução agendada conclui sem erro de configuração ou reautenticação;
- nenhuma credencial aparece em Git, logs ou respostas.

## Riscos

- concorrência com o cron antigo durante a rotação;
- desativar o secret OAuth ainda usado pelo Vercel;
- misturar ciphertexts de chaves diferentes durante rollout parcial.

