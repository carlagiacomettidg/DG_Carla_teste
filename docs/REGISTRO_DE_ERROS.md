# Registro de erros do projeto

Este arquivo funciona como um banco único de erros do projeto. Sempre que um erro novo aparecer, registrar aqui com data, mensagem, motivo e correção.

## Índice

- [2026-08-14 - Nuvemshop API 404: Last page is 0](#2026-08-14---nuvemshop-api-404-last-page-is-0)
- [2026-08-14 - Nuvemshop API 422: total_orders](#2026-08-14---nuvemshop-api-422-total_orders)
- [2026-08-14 - Nuvemshop API 422: password e send_email_invite](#2026-08-14---nuvemshop-api-422-password-e-send_email_invite)
- [2026-08-14 - Cliente aparece no painel, mas não consegue login](#2026-08-14---cliente-aparece-no-painel-mas-não-consegue-login)
- [2026-08-14 - Formulário nativo da Nuvemshop não cadastrou o cliente](#2026-08-14---formulário-nativo-da-nuvemshop-não-cadastrou-o-cliente)
- [2026-08-14 - Falta de mensagem clara quando cadastro falha](#2026-08-14---falta-de-mensagem-clara-quando-cadastro-falha)
- [2026-08-14 - Nuvemshop API 401: token inválido](#2026-08-14---nuvemshop-api-401-token-inválido)
- [2026-08-14 - Nuvemshop API 403: read_locations](#2026-08-14---nuvemshop-api-403-read_locations)
- [2026-08-14 - Cadastro sem erro visual e sem confirmação na loja](#2026-08-14---cadastro-sem-erro-visual-e-sem-confirmação-na-loja)
- [2026-08-17 - Cliente atacado loga, mas preço de atacado não aparece](#2026-08-17---cliente-atacado-loga-mas-preço-de-atacado-não-aparece)
- [2026-08-17 - Abas do painel travam ao alternar telas](#2026-08-17---abas-do-painel-travam-ao-alternar-telas)
- [2026-08-18 - Preço atacado ainda não aparece após publicar script](#2026-08-18---preço-atacado-ainda-não-aparece-após-publicar-script)

## 2026-08-14 - Nuvemshop API 404: Last page is 0

**Erro**

```txt
Nuvemshop API 404: Last page is 0
```

**Onde apareceu**

- Formulário de cadastro de atacado na loja.
- Busca de cliente existente por e-mail antes de criar um novo cliente.

**Motivo**

A API da Nuvemshop retornou `404 / Last page is 0` quando não havia nenhum cliente com aquele e-mail. O app estava tratando esse retorno como erro real, mas nesse contexto ele significa apenas "cliente não encontrado".

**Como corrigimos**

A função `findCustomerByEmail` foi ajustada para interpretar `Last page is 0` como cliente inexistente. Assim, quando o e-mail não existe, o app segue para criar um novo cliente.

**Status**

Corrigido.

## 2026-08-14 - Nuvemshop API 422: total_orders

**Erro**

```txt
Nuvemshop API 422: Invalid fields for this resource: total_orders
```

**Onde apareceu**

- Criação ou atualização de cliente via API da Nuvemshop.

**Motivo**

O app tentou enviar para a API um campo somente leitura. `total_orders` é calculado pela Nuvemshop e não pode ser enviado no cadastro do cliente.

**Como corrigimos**

Removemos `total_orders` do payload enviado para criar/atualizar cliente. O campo continua podendo ser lido da Nuvemshop, mas não deve ser enviado.

**Status**

Corrigido.

## 2026-08-14 - Nuvemshop API 422: password e send_email_invite

**Erro**

```txt
Nuvemshop API 422:
send_email_invite must not be present
password must not be present
```

**Onde apareceu**

- Tentativa de criar cliente de atacado via API com senha e convite de e-mail.

**Motivo**

Embora a documentação de clientes indique os campos `password` e `send_email_invite`, a loja/API respondeu rejeitando esses campos no cenário testado. Isso indica que, para essa loja, versão ou escopo de API, a criação de cliente com senha diretamente via API não foi aceita.

**Como corrigimos**

O app passou a usar fallback:

1. Tenta criar cliente com `password` e `send_email_invite`.
2. Se a Nuvemshop rejeitar esses campos, tenta novamente sem eles.
3. Nesse caso, o cliente é salvo e marcado como atacado, mas a tela informa que a conta pode precisar de ativação pela Nuvemshop.

**Status**

Corrigido com fallback. Ainda depende do comportamento da Nuvemshop para ativar login automaticamente.

## 2026-08-14 - Cliente aparece no painel, mas não consegue login

**Erro**

```txt
Esses dados estão incorretos.
Não achamos nenhuma conta cadastrada com esse e-mail.
```

**Onde apareceu**

- Login da loja.
- Recuperação de senha da loja.

**Motivo**

A Nuvemshop diferencia "cliente cadastrado no painel" de "conta ativa na vitrine". O cliente pode existir na lista de clientes, mas ainda não ter uma conta ativa com senha para login. A API possui o campo `active`, que indica se a conta foi ativada.

**Como corrigimos**

O app agora lê o campo `active` da Nuvemshop e retorna `loginAvailable` com base nele. Se `active` não vier como `true`, a tela não promete login imediato.

**Status**

Corrigido parcialmente. O cadastro pode ser salvo, mas a ativação da conta ainda depende da Nuvemshop.

## 2026-08-14 - Formulário nativo da Nuvemshop não cadastrou o cliente

**Erro**

Não apareceu uma mensagem técnica clara. O comportamento foi:

- Ao finalizar o cadastro atacado, a tela voltou para um formulário nativo vazio.
- O cliente não apareceu mais na lista de clientes.
- Não houve confirmação útil para a usuária.

**Onde apareceu**

- Página `/account/register` da loja.

**Motivo**

O script tentou submeter o formulário nativo da Nuvemshop preenchendo campos automaticamente. Essa abordagem depende da estrutura interna do tema e dos nomes reais dos campos esperados pelo formulário. Como isso não foi validado com segurança, a submissão não criou o cliente corretamente.

**Como corrigimos**

Revertemos a submissão automática do formulário nativo e voltamos o envio para o endpoint do nosso app: `/api/wholesale-requests`. Assim, o app controla a resposta e mostra erro/sucesso de forma clara.

**Status**

Corrigido nesta rodada. Nova versão do script: `2026-08-14-api-register-v1`.

## 2026-08-14 - Falta de mensagem clara quando cadastro falha

**Erro**

Não havia erro visual claro. Em alguns testes, parecia que o cadastro tinha sido enviado, mas:

- o cliente não conseguia login;
- o cliente não aparecia como conta ativa;
- a tela não explicava o próximo passo.

**Onde apareceu**

- Formulário de cadastro de atacado na loja.

**Motivo**

O front estava assumindo sucesso em cenários que dependiam de confirmação real da API. Também houve tentativa de redirecionamento/submissão nativa que saiu do controle do nosso app.

**Como corrigimos**

A tela volta a mostrar confirmação ou erro vindo do endpoint do app. Quando a conta não está ativa para login, a mensagem orienta ativação/recuperação pela Nuvemshop.

**Status**

Corrigido nesta rodada.

## 2026-08-14 - Nuvemshop API 401: token inválido

**Erro**

```txt
Nuvemshop API 401: Unauthorized / Invalid access token
```

**Onde apareceu**

- Chamadas para API da Nuvemshop após instalação/autorização incorreta ou token antigo.

**Motivo**

Token de acesso inválido, ausente ou antigo.

**Como corrigimos**

Reinstalamos/autorizamos novamente o app na loja e garantimos que o OAuth salvasse o `accessToken` correto no banco.

**Status**

Corrigido quando a loja foi reinstalada/autorizada.

## 2026-08-14 - Nuvemshop API 403: read_locations

**Erro**

```txt
Missing required scope: read_locations
```

**Onde apareceu**

- Botão de atualizar/sincronizar centros de distribuição.

**Motivo**

O app não tinha permissão para ler centros de distribuição.

**Como corrigimos**

Ativamos o escopo `read_locations` no Portal de Parceiros da Nuvemshop e reinstalamos o app na loja para gerar um novo token com esse escopo.

**Status**

Corrigido.

## 2026-08-14 - Cadastro sem erro visual e sem confirmação na loja

**Erro**

Não havia uma mensagem clara na tela após enviar o cadastro. Para a usuária, parecia que:

- o cadastro não subia para a Nuvemshop;
- o login não funcionava;
- não existia erro visual explicando o motivo.

**Onde apareceu**

- Formulário de cadastro atacado dentro de `/account/register`.

**Motivo**

O endpoint `/api/wholesale-requests` foi testado diretamente e conseguiu criar cliente na Nuvemshop com `active: true`. Portanto, a falha mais provável estava no caminho entre a página da loja e o endpoint, ou na falta de feedback visual da resposta real. O front não mostrava status HTTP, ID do cliente criado nem motivo técnico detalhado quando algo falhava.

**Como corrigimos**

- Atualizamos o script para a versão `2026-08-14-api-register-debug-v1`.
- A tela passa a mostrar o ID do cliente retornado pela Nuvemshop quando o cadastro dá certo.
- Quando falha, a tela mostra status HTTP e motivo técnico retornado pelo endpoint.
- Atualizamos a versão do backend para `2026-08-14-wholesale-debug-v1` para facilitar confirmação de deploy.

**Status**

Em validação.

## 2026-08-17 - Cliente atacado loga, mas preço de atacado não aparece

**Erro**

Cliente criado e logado corretamente na loja, mas os preços configurados no painel de atacado não aparecem na vitrine.

**Onde apareceu**

- Vitrine da loja com cliente de atacado logado.
- Produtos com preço de atacado já configurado no painel do app.

**Motivo**

O cadastro/login já estava funcionando, mas o script instalado na loja ainda só atuava na página de cadastro. Não existia uma rotina na vitrine para identificar o cliente logado como atacado, buscar as regras salvas no app e substituir visualmente o preço do produto pelo preço de atacado.

**Como corrigimos**

- Criamos o endpoint `/api/storefront-wholesale-context`.
- Esse endpoint busca o cliente logado na Nuvemshop, valida se ele está marcado como atacado/aprovado e retorna as regras de preço de atacado.
- Atualizamos `public/wholesale-login.js` para rodar também nas páginas da vitrine, detectar o cliente logado e aplicar o preço de atacado nos elementos de preço encontrados no tema.
- Nova versão do script: `2026-08-17-storefront-prices-v1`.

**Status**

Em validação na vitrine, porque a aplicação visual depende dos seletores reais do tema.

## 2026-08-17 - Abas do painel travam ao alternar telas

**Erro**

Ao clicar em abas como `Importar e exportar`, `Clientes atacado` ou `Configurações`, o painel incorporado dentro da Nuvemshop ficava lento ou travava, principalmente no primeiro clique.

**Onde apareceu**

- App incorporado no admin da Nuvemshop.
- Tela `Produtos em atacado`.

**Motivo**

O painel carregava produtos, regras e clientes logo na abertura. Além disso, a aba de produtos renderizava muitas linhas com inputs ao mesmo tempo. Com mais de mil produtos/variações, o navegador precisava montar muitos campos editáveis de uma vez, causando travamento ao alternar telas.

**Como corrigimos**

- Removemos a carga inicial obrigatória dos clientes; eles passam a carregar apenas quando a aba `Clientes atacado` é aberta.
- A tabela de produtos passou a renderizar em blocos de 80 itens, com botão `Carregar mais produtos`.
- Os botões das abas foram definidos explicitamente como `type="button"` para evitar comportamento de submit acidental.
- O carregamento de clientes recebeu estado de loading com `try/finally`, evitando botão preso caso a API demore ou falhe.

**Status**

Corrigido e em validação.

## 2026-08-18 - Preço atacado ainda não aparece após publicar script

**Erro**

Mesmo após publicar a versão `2026-08-17-storefront-prices-v1`, o cliente consegue logar como atacado, mas a vitrine continua exibindo o preço normal.

**Onde apareceu**

- Vitrine da loja com cliente atacado logado.
- Script de storefront publicado no Portal de Parceiros.

**Motivo**

O script dependia de conseguir identificar rapidamente o cliente logado e casar o preço visível com `productId`, `variantId` ou SKU. Em temas da Nuvemshop, o objeto do cliente pode aparecer depois do carregamento inicial, e alguns blocos de produto na vitrine não expõem ID/SKU diretamente no HTML renderizado. Com isso, o script podia parar de tentar antes do cliente estar disponível ou não conseguir casar o elemento de preço com a regra de atacado.

**Como corrigimos**

- Aumentamos a janela de tentativa de identificação do cliente logado.
- O script agora tenta novamente no `load`, `focus` e em cliques da página.
- Criamos diagnóstico em `window.DG_WHOLESALE_DEBUG` para mostrar versão, tentativas, cliente encontrado, contexto carregado, quantidade de regras e quantos preços foram aplicados.
- O backend passou a retornar `productUrl`/`url` nas regras públicas quando disponível, permitindo casar preço pelo link do produto quando o tema não expõe ID/SKU.
- Nova versão: `2026-08-18-storefront-diagnostics-v1`.

**Status**

Em validação. Se `window.DG_WHOLESALE_DEBUG` indicar `customer_not_found_in_storefront`, o tema/script da Nuvemshop não está expondo o cliente logado para o JavaScript externo. Se indicar `no_matching_price_nodes`, o próximo ajuste deve ser feito nos seletores/HTML reais do produto.

## 2026-08-18 - Integração Tiny por token ainda não existia no app

**Erro**

As variáveis `TINY_API_TOKEN`, `TINY_PRICE_LIST_NAME`, `TINY_STOCK_DEPOSIT_NAME` e `TINY_TEST_SKU` foram configuradas no Vercel, mas o app ainda não tinha endpoints para consultar o Tiny/Olist e atualizar preço/estoque de atacado.

**Onde apareceu**

- Fluxo de teste Tiny/Olist com lista de preço `Atacado`, depósito `Atacado` e SKU `GA1903X-1`.

**Motivo**

O código anterior só sincronizava produtos da Nuvemshop e importação por planilha. Não existia módulo de API Tiny, nem chamada para buscar lista de preço, produto por SKU, exceção de preço e estoque por depósito.

**Como corrigimos**

- Criamos `src/tiny.js` usando a API V2 oficial do Tiny/Olist por token.
- Adicionamos `/api/tiny/status` para validar configuração.
- Adicionamos `/api/tiny/sync-sku` para buscar o SKU configurado, localizar a lista `Atacado`, consultar preço/estoque no depósito `Atacado` e atualizar a regra de atacado do app.
- Adicionamos botão `Sincronizar Tiny` no painel.
- Atualizamos `.env.example` com as variáveis necessárias.
- Nova versão: `2026-08-18-tiny-sync-v1`.

**Status**

Em validação no Vercel. Se der erro, o retorno deve aparecer no aviso azul do painel e indicar se falhou token, lista de preço, SKU ou depósito.

## 2026-08-18 - Sincronização Tiny estava limitada a um SKU teste

**Erro**

A integração com Tiny validava corretamente preço e estoque, mas apenas para o SKU configurado em `TINY_TEST_SKU`. Isso não atende o fluxo real, porque a loja precisa conferir todos os produtos/variações que já existem na Nuvemshop e atualizar apenas os SKUs correspondentes no Tiny.

**Onde apareceu**

- Botão `Sincronizar Tiny` no painel do app.
- Produto teste funcionava, mas os demais produtos da Nuvemshop não eram conferidos.

**Motivo**

O primeiro endpoint foi criado como validação controlada (`/api/tiny/sync-sku`) para reduzir risco. Depois que o SKU teste funcionou, faltava trocar o fluxo do painel para uma sincronização em massa baseada nas regras/produtos já sincronizados da Nuvemshop.

**Como corrigimos**

- Criamos `/api/tiny/sync-rules`.
- A rotina pega somente SKUs já existentes no app, ou seja, vindos da Nuvemshop.
- Para cada SKU, consulta o Tiny na lista `Atacado` e depósito `Atacado`.
- Se o SKU existir no Tiny, atualiza preço e estoque de atacado no app.
- Se o SKU não existir no Tiny, ignora e mostra no resumo como não encontrado.
- A busca por produto no Tiny passou a aceitar apenas SKU igual, evitando atualizar um produto errado por resultado parecido.
- O botão `Sincronizar Tiny` passou a chamar a sincronização em massa.
- Nova versão: `2026-08-18-tiny-bulk-sync-v1`.

**Status**

Em validação. `TINY_TEST_SKU` pode continuar no Vercel para teste pontual, mas o fluxo principal do painel não depende mais dele.

## 2026-08-19 - Painel administrativo estava acessível pela URL pública

**Erro**

Ao acessar `https://dg-venus-modas.vercel.app/`, o painel de edição do app aparecia fora do administrador da Nuvemshop. Isso expunha visualmente configurações e controles administrativos, como sincronização de produtos, Tiny, preços, estoque e clientes atacado.

**Onde apareceu**

- URL pública do app na Vercel.
- APIs administrativas em `/api/settings`, `/api/rules`, `/api/tiny/*`, `/api/locations/sync` e `/api/wholesale-customers`.

**Motivo**

O app já era incorporado ao painel da Nuvemshop, mas a mesma tela também renderizava quando aberta diretamente no navegador. Além disso, as chamadas administrativas ainda não exigiam token de sessão do Nexo no backend.

**Como corrigimos**

- O painel React agora só carrega dados e renderiza controles quando está dentro do iframe do admin da Nuvemshop.
- Se alguém abrir a URL pública diretamente, aparece apenas uma tela de `Painel restrito`.
- O front passa a obter `getSessionToken` pelo Nexo e enviar `Authorization: Bearer ...` nas chamadas administrativas.
- O backend valida o JWT do Nexo usando `NUVEMSHOP_CLIENT_SECRET`.
- Rotas administrativas em `/api/*` passam a exigir token válido.
- Mantivemos públicas apenas rotas necessárias para OAuth, webhooks, script da vitrine, cadastro de atacado e contexto de preço da vitrine.
- Nova versão: `2026-08-19-admin-security-v1`.

**Status**

Em validação. O próximo teste deve confirmar que o painel continua abrindo dentro da Nuvemshop e que a URL pública não mostra mais controles administrativos.

## 2026-08-19 - Painel restrito também bloqueou o admin da Nuvemshop

**Erro**

Depois da proteção do painel, o app passou a mostrar `Validando acesso` e a mensagem `Não foi possível validar o acesso pelo painel da Nuvemshop` mesmo quando aberto dentro do administrador da Nuvemshop.

**Onde apareceu**

- Admin da Nuvemshop em `Produtos em atacado`.

**Motivo**

O front estava chamando mensagens manuais e `iAmReady` antes do `connect` do Nexo. Pela documentação oficial, o fluxo correto é criar a instância Nexo, chamar `connect(nexo)` e só depois chamar `iAmReady(nexo)`. Como a conexão falhava antes de obter o token de sessão, o painel ficava preso na tela de validação.

**Como corrigimos**

- Removemos os `postMessage` manuais.
- O fluxo agora chama `connect(nexoClient, 10000)`, configura `getSessionToken` e só depois chama `iAmReady(nexoClient)`.
- Mantivemos os helpers pelo export principal de `@tiendanube/nexo`, porque a versão instalada no projeto não resolve o subpath `@tiendanube/nexo/helpers` no build.
- Mantivemos a validação de token no backend.

**Status**

Corrigido e em validação no admin incorporado.

**Versão**

`2026-08-19-admin-security-v2`

## 2026-08-20 - Nuvemshop mostra erro generico ao carregar o app

**Erro**

Depois do deploy da versao `2026-08-19-admin-security-v2`, a tela deixou de ficar presa em `Validando acesso`, mas a Nuvemshop passou a mostrar o erro nativo:

```txt
Ocorreu um erro com o aplicativo Produtos em atacado
Nao foi possivel carregar o aplicativo neste momento.
```

**Onde apareceu**

- Admin da Nuvemshop em `Produtos em atacado`.

**Motivo**

O app estava esperando o `connect` do Nexo terminar antes de chamar `iAmReady`. Na pratica, o admin da Nuvemshop pode derrubar ou ocultar o iframe se o app demorar para avisar que terminou o carregamento. Assim, mesmo com o codigo correto para buscar o token depois, a Nuvemshop mostrava o erro generico antes da nossa tela aparecer.

**Como corrigimos**

- O front agora chama `iAmReady(nexoClient)` logo depois de criar o cliente Nexo, para liberar o carregamento do iframe.
- Depois disso, continua chamando `connect(nexoClient, 10000)` e configurando `getSessionToken`.
- As APIs administrativas continuam exigindo `Authorization: Bearer ...`; ou seja, a tela pode carregar, mas as chamadas sensiveis seguem protegidas pelo token do painel.

**Status**

Corrigido e em validacao no admin incorporado.

**Versao**

`2026-08-20-admin-security-v3`
