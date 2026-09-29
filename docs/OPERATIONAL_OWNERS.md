# Responsáveis operacionais

## Staging

| Função | Responsável |
|---|---|
| Release owner | Matheus Mendonça |
| Migration owner | Matheus Mendonça |
| Incident commander | Matheus Mendonça |
| Rollback owner | Matheus Mendonça |
| Worker owner | Matheus Mendonça |
| Custos e cotas | Matheus Mendonça |

Matheus Mendonça pode pausar o worker, autorizar rollback e interromper a
homologação de staging. A operação de staging é individual; a concentração de
funções é um risco aceito somente enquanto o produto usa dados sintéticos e o
perfil gratuito.

## Condições antes de produção

- nomear substituto e on-call adicional;
- separar aprovação e execução quando o risco exigir;
- definir responsáveis jurídico, privacidade/DPO e segurança;
- não presumir aprovação jurídica, DPO, pentest ou aceite de risco produtivo a
  partir desta designação de staging.

## Release candidate fechado de produção

Na janela autorizada da PROD-12:

| Função | Responsável |
|---|---|
| Release owner | Matheus Mendonça |
| Migration owner | Matheus Mendonça |
| Rollback owner | Matheus Mendonça |
| Incident commander provisório | Matheus Mendonça |

Matheus Mendonça é o custodiante provisório dos recursos fechados e o
responsável por interromper qualquer ação que gere cobrança. A concentração de
funções foi aceita apenas para esta janela sem usuário, tráfego ou dado real;
ela não o designa automaticamente como único on-call de produção e não
autoriza bootstrap, domínio ou go-live.

Substituto, on-call adicional e aprovadores de negócio, segurança e privacidade
precisam ser ratificados antes da operação real. Não existe substituto/on-call
configurado.
