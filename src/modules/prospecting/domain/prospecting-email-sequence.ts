export const PROSPECTING_EMAIL_SEQUENCE_VERSION = 2;

export const PROSPECTING_EMAIL_ALLOWED_VARIABLES = Object.freeze([
  "primeiro_nome",
  "nome",
  "cargo",
  "municipio",
  "uf",
  "nome_vendedor",
  "assinatura",
] as const);

export const PROSPECTING_EMAIL_SEQUENCE = Object.freeze([
  {
    stepKey: "email-1",
    dayOffset: 0,
    subject: "posso colocar um sistema com IA no seu gabinete?",
    alternateSubjects: ["Trabalhamos com 450 políticos em 2026. agora quero trabalhar com você"],
    body: `Olá, {cargo} {nome}, tudo bem?

Sou o {nome_vendedor}, da Politizai. Peguei este e-mail numa ligação para o seu gabinete.

Em 2026, trabalhamos com mais de 450 políticos, entre deputados, senadores e governadores. Agora estamos atendendo mandatos em exercício.

A Politizai vai colocar no seu gabinete um sistema próprio, operado por agentes de inteligência artificial e pela nossa equipe. Com ele, nós captamos apoiadores para você todos os dias, cuidamos da sua comunicação, organizamos a operação do gabinete e fortalecemos o seu posicionamento.

A Politizai não substitui a sua equipe. A gente assume o trabalho repetitivo e operacional, e os seus assessores ganham tempo para o que só eles fazem: rua, articulação e relacionamento com as pessoas.

O objetivo é um só: transformar o trabalho do seu mandato em apoio popular e chegar em 2028 com mais votos.

Me responda aqui com seu WhatsApp pra te apresentar tudo em uma conversa breve!

{assinatura}`,
  },
  {
    stepKey: "email-2",
    dayOffset: 3,
    subject: "posso deixar seu mandato mais organizado e influente?",
    alternateSubjects: [],
    body: `Olá, {nome}.

A Politizai vai captar apoiadores para o seu mandato todos os dias, pelas suas redes, pelo WhatsApp, pelo site e nos eventos.

Cada pessoa entra no nosso sistema com nome, bairro e interesse. A partir daí, os agentes de IA e a nossa equipe cuidam da comunicação com essa base. Você só aprova.

Por quê? Porque cada apoiador que acompanha o seu trabalho durante o mandato é um voto muito mais provável na próxima eleição. E, em vez de começar do zero na campanha, você chega com uma base pronta.

Me responda aqui com seu WhatsApp pra te apresentar tudo em uma conversa breve!

{assinatura}`,
  },
  {
    stepKey: "email-3",
    dayOffset: 7,
    subject: "vou captar apoiadores pra você de forma automática",
    alternateSubjects: [],
    body: `Olá, {nome}.

A Politizai vai tirar da sua equipe o trabalho operacional do gabinete.

Os nossos agentes de IA trabalham dentro do sistema com o contexto do seu mandato: registram demandas, cobram prazos, preparam materiais e montam relatórios. A nossa equipe cuida da comunicação e do seu posicionamento, inclusive no Google e no ChatGPT.

Com isso, a sua equipe sai do computador e volta para a rua, para a articulação e para o relacionamento com as pessoas. É esse contato que gera apoio popular e vira voto.

Me responda aqui com seu WhatsApp pra te apresentar tudo em uma conversa breve!

{assinatura}`,
  },
  {
    stepKey: "email-4",
    dayOffset: 12,
    subject: "vamos implementar IA no seu mandato, topa?",
    alternateSubjects: [],
    body: `Olá, {nome}.

Sou o {nome_vendedor}, da Politizai, e durante as eleições trabalhamos com mais de 450 políticos em 2026, entre deputados, senadores e governadores. Agora a mesma estrutura está disponível para o seu mandato.

São três partes funcionando juntas: o sistema da Politizai, com tudo do seu mandato num só lugar; os agentes de IA, executando as rotinas do gabinete; e a nossa equipe, operando a captação de apoiadores, a comunicação e o posicionamento. Você acompanha tudo por um painel.

No fim, você sabe quem te apoia, onde está esse apoio e o que fazer para ampliar. Isso vira vantagem na disputa de 2028.

Me responda aqui com seu WhatsApp pra te apresentar tudo em uma conversa breve!

{assinatura}`,
  },
  {
    stepKey: "email-5",
    dayOffset: 18,
    subject: "nós cuidamos da sua base até 2028",
    alternateSubjects: [],
    body: `Olá, {nome}.

A Politizai vai manter o seu mandato em contato com os seus apoiadores até 2028.

O nosso sistema mostra quem são os seus apoiadores em cada bairro de {municipio} e o que importa para cada um. A nossa equipe opera a comunicação com eles por WhatsApp, SMS e e-mail, de forma segmentada e contínua.

Assim, quando a eleição chegar, essa base já conhece o seu trabalho, confia em você e está pronta para votar e trazer mais gente.

Me responda aqui com seu WhatsApp pra te apresentar tudo em uma conversa breve!

{assinatura}`,
  },
  {
    stepKey: "email-6",
    dayOffset: 25,
    subject: "ainda faz sentido pra você?",
    alternateSubjects: [],
    body: `Olá, {nome}.

Último e-mail, para não ocupar a sua caixa.

Se fizer sentido ter a Politizai no seu gabinete, com sistema, IA e equipe cuidando da sua captação de apoiadores, comunicação e posicionamento para ampliar o seu apoio popular e os seus votos em 2028, é só me responder com o seu WhatsApp. Se quem cuida disso for outra pessoa, me indica que eu falo com ela.

{assinatura}`,
  },
] as const);

export const PROSPECTING_EMAIL_STEP_KEYS = Object.freeze([
  "email-1",
  "email-2",
  "email-3",
  "email-4",
  "email-5",
  "email-6",
] as const);

export const PROSPECTING_EMAIL_TEMPLATE_COUNT = PROSPECTING_EMAIL_SEQUENCE.length;
