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

## 2026-08-20 - Nexo quebra no navegador com global is not defined

**Erro**

```txt
Falha ao conectar Nexo ReferenceError: global is not defined
```

**Onde apareceu**

- Console do Chrome dentro do admin da Nuvemshop.
- Arquivos gerados `app.js` e `chunk-*.js` ao carregar o pacote `@tiendanube/nexo`.

**Motivo**

O pacote `@tiendanube/nexo` traz um trecho empacotado em formato que espera a variavel global `global`, comum em Node/CommonJS. No navegador essa variavel nao existe por padrao, entao o chunk do Nexo quebrava antes de completar o handshake com a Nuvemshop.

**Como corrigimos**

- Adicionamos `define: { global: "globalThis" }` no `vite.config.js`.
- Adicionamos um fallback no inicio do painel: `window.global = window`.
- Mantivemos o carregamento do Nexo depois desse fallback.

**Status**

Corrigido e em validacao no admin incorporado.

**Versao**

`2026-08-20-admin-security-v4`

## 2026-08-20 - Tiny tinha varias listas de preco de atacado por categoria

**Erro**

A sincronizacao do Tiny buscava apenas uma lista de preco chamada `Atacado`, mas a conta real usa varias listas por categoria, como `ATACADO BERMUDA VENUS`, `ATACADO BLUSAS UV VENUS`, `ATACADO CAMISAS VENUS` e outras.

**Onde apareceu**

- Painel do Tiny/Olist em `Listas de precos`.
- Botao `Sincronizar Tiny` no app da Nuvemshop.

**Motivo**

O app usava uma lista unica encontrada por `TINY_PRICE_LIST_NAME`. Quando o Tiny passou a separar os precos por categoria, varios SKUs poderiam estar em listas diferentes. Com uma lista unica, o app podia ignorar precos de atacado existentes em outras listas.

**Como corrigimos**

- Criamos busca de multiplas listas por palavra-chave.
- A variavel principal passa a ser `TINY_PRICE_LIST_KEYWORD=ATACADO`.
- Na sincronizacao em massa, o app localiza todas as listas cujo nome contenha `ATACADO` e testa o SKU em cada uma ate encontrar o preco de atacado.
- O app registra em cada regra qual lista foi usada (`tinyPriceListId` e `tinyPriceListName`).

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-price-lists-v1`

## 2026-08-20 - Tiny bloqueou a API por excesso de acessos durante sincronizacao

**Erro**

Ao clicar em `Sincronizar Tiny`, o app retornava `API Bloqueada - Excedido o numero de acessos a API, aguarde alguns minutos e tente novamente` ou ficava carregando por muito tempo.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Botao `Sincronizar Tiny`.

**Motivo**

A loja real tem muitos produtos/variacoes e varias listas de preco de atacado. A versao anterior tentava conferir muitos SKUs em uma unica execucao e ainda consultava varias listas do Tiny para cada SKU. Isso gerava muitas chamadas em pouco tempo e o Tiny bloqueava temporariamente o token.

**Como corrigimos**

- A sincronizacao do Tiny passou a rodar por lote.
- O tamanho padrao do lote e `25` SKUs, configuravel por `TINY_SYNC_BATCH_SIZE`.
- O app salva um cursor (`tinySyncCursor`) para a proxima sincronizacao continuar do proximo lote.
- O botao fica bloqueado enquanto sincroniza, evitando clique duplo.
- Se o Tiny bloquear a API, o app interrompe o lote e mostra uma mensagem clara para aguardar alguns minutos.
- Para cada SKU, as listas de preco sao testadas em sequencia e a busca para na primeira lista de atacado com preco, evitando chamadas desnecessarias.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-batch-sync-v1`

## 2026-08-20 - Sincronizacao em lote exigia varios cliques no painel

**Erro**

Depois de limitar a sincronizacao do Tiny por lote, o painel informava algo como `25 SKUs conferidos, 1246 SKUs restantes`, mas exigia que o usuario clicasse varias vezes em `Sincronizar Tiny` para continuar.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Botao `Sincronizar Tiny`.

**Motivo**

O lote corrigia o excesso de chamadas ao Tiny, mas a experiencia ficou manual demais. Tecnicamente o servidor continuava pelo cursor, mas o front nao disparava os proximos lotes automaticamente.

**Como corrigimos**

- O clique em `Sincronizar Tiny` agora inicia uma sincronizacao automatica completa.
- O front chama os lotes em sequencia, com uma pausa curta entre eles para respeitar a API do Tiny.
- A tela mostra progresso por lote e quantos SKUs ainda faltam.
- Se o Tiny bloquear a API, o processo para e informa que e necessario aguardar alguns minutos para continuar.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-auto-batch-v1`

## 2026-08-20 - Sincronizacao do Tiny ainda bloqueava mesmo com lote automatico

**Erro**

Mesmo com sincronizacao automatica em lotes, o Tiny ainda podia bloquear logo no inicio com `API Bloqueada - Excedido o numero de acessos`.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Botao `Sincronizar Tiny`.

**Motivo**

O lote automatico melhorou a experiencia, mas a consulta ainda era cara: para cada SKU da Nuvemshop, o app procurava o produto no Tiny, testava as listas de preco de atacado e depois buscava estoque. Em contas com muitos SKUs e varias listas `ATACADO`, isso gerava muitas chamadas rapidamente.

**Como corrigimos**

- Invertemos o fluxo da sincronizacao.
- O app agora busca as excecoes/itens das listas de preco de atacado no Tiny.
- Depois cruza esses itens com os SKUs existentes na Nuvemshop.
- Assim, o app trabalha em cima dos produtos que realmente possuem preco nas listas de atacado, em vez de consultar todos os SKUs cegamente.
- A sincronizacao continua automatica por lotes no front, mas com muito menos chamadas ao Tiny.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-bulk-index-v1`

## 2026-08-20 - Tiny continuava retornando bloqueio apos otimizar por lista

**Erro**

Mesmo depois de inverter a sincronizacao para buscar os itens das listas de preco primeiro, o painel ainda mostrava `O Tiny bloqueou temporariamente a API por excesso de acessos` com `0 variacoes` atualizadas.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Botao `Sincronizar Tiny`.

**Motivo**

O token do Tiny pode ficar em cooldown por alguns minutos depois de varias tentativas seguidas. Alem disso, mesmo com a busca por lista, o app ainda consultava estoque em sequencia para os itens do lote. Se o token ja estava bloqueado, a primeira consulta do novo lote ja falhava.

**Como corrigimos**

- Reduzimos o lote padrao para `5` itens por chamada.
- Adicionamos uma pequena pausa entre consultas de estoque no servidor.
- O front agora aguarda 2 minutos e tenta continuar automaticamente quando o Tiny retorna bloqueio.
- O app continua salvando o ponto da sincronizacao para retomar de onde parou.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-throttled-sync-v1`

## 2026-08-20 - Sincronizacao do Tiny dependia da aba aberta

**Erro**

A sincronizacao do Tiny era acionada pelo navegador. Se o lojista fechasse a aba, trocasse de tela ou o navegador pausasse a pagina, a sincronizacao parava.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Botao `Sincronizar Tiny`.

**Motivo**

O front fazia chamadas repetidas para processar os lotes. Isso resolvia parcialmente o limite da API, mas mantinha o navegador como motor da sincronizacao. Para muitos itens, o processo poderia demorar horas e exigir que o usuario deixasse a tela aberta.

**Como corrigimos**

- Criamos uma fila persistente de sincronizacao no banco (`tinySyncJob`).
- O botao `Sincronizar Tiny` agora cria/reinicia a fila e processa apenas um primeiro lote.
- Criamos endpoint de status para o painel acompanhar progresso, itens restantes, bloqueio e conclusao.
- Criamos endpoint de cron (`/api/cron/tiny-sync`) para processar lotes automaticamente.
- No plano Hobby da Vercel, cron subdiario nao e suportado. Para rodar a cada minuto, e necessario usar Vercel Pro ou um agendador externo chamando esse endpoint.
- O endpoint aceita `Authorization: Bearer CRON_SECRET` ou `?secret=CRON_SECRET`.
- Se a aba fechar, a fila fica salva e continua quando o cron externo chamar o endpoint.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-background-sync-v1`

## 2026-08-20 - Sincronizacao em segundo plano estava lenta demais

**Erro**

A fila em segundo plano funcionava, mas processava poucos itens em muito tempo. Exemplo observado: de `578` para `810` itens processados em cerca de 30 minutos.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Status da sincronizacao Tiny.

**Motivo**

O lote estava conservador demais (`8` itens) e havia uma pausa fixa de `650ms` antes de cada consulta de estoque no Tiny. Isso reduziu o risco de bloqueio, mas tornou a sincronizacao inviavel para milhares de itens.

**Como corrigimos**

- Aumentamos o lote padrao para `30` itens por execucao.
- Reduzimos a pausa padrao entre itens para `120ms`.
- Criamos variaveis para ajustar sem mexer em codigo:
  - `TINY_SYNC_BATCH_SIZE`
  - `TINY_SYNC_ITEM_DELAY_MS`
  - `TINY_SYNC_MAX_RUNTIME_MS`
- O processador agora aproveita melhor cada chamada, respeitando um limite de tempo por execucao.
- O painel passou a mostrar estimativa de minutos restantes.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-20-tiny-faster-background-sync-v1`

## 2026-08-21 - Estoque do Tiny podia aparecer como zero

**Erro**

O preco de atacado vinha do Tiny, mas o estoque de atacado podia aparecer como `0` no app mesmo quando o deposito do Tiny tinha saldo.

**Onde apareceu**

- Painel incorporado da Nuvemshop.
- Sincronizacao Tiny.
- Coluna `Estoque atacado`.

**Motivo**

O Tiny pode retornar numeros no formato brasileiro, por exemplo `10,00`. O codigo usava `Number(...)`, e esse formato vira `NaN` em JavaScript. Na pratica, isso podia cair como zero na regra de atacado. Alem disso, o deposito era procurado por nome exato; se a variavel estivesse como `Atacado` e o Tiny estivesse como `Atacado - centro`, o app podia nao selecionar o deposito correto.

**Como corrigimos**

- Criamos um parser para numeros do Tiny que aceita `10`, `10.00`, `10,00` e `1.234,56`.
- A leitura de preco, estoque total e estoque por deposito passou a usar esse parser.
- A busca do deposito agora aceita nome exato ou nome parcial, como `Atacado` para `Atacado - centro`.
- A fila de sincronizacao passou a salvar o estoque ja tratado, em vez de converter novamente o saldo bruto do deposito.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-21-tiny-stock-parse-v1`

## 2026-08-28 - Preco de atacado nao aparecia na vitrine para cliente aprovado

**Erro**

O cliente atacado estava cadastrado e aprovado, e o endpoint publico do app ja retornava `wholesale: true` com preco de atacado para o SKU da variacao. Mesmo assim, a pagina do produto continuava mostrando o preco normal da Nuvemshop.

**Onde apareceu**

- Vitrine da loja, na pagina do produto.
- Produto `Calca mol bebe`.
- SKUs `199-1`, `199-2`, `199-3`, `199-4` e `199-5`.

**Motivo**

O backend estava correto, mas o script da vitrine dependia de o tema expor o cliente logado em variaveis JavaScript da Nuvemshop. Em alguns temas essa informacao nao fica disponivel para scripts externos. Quando o script nao encontrava e-mail ou ID do cliente, ele nem consultava `/api/storefront-wholesale-context` e, por isso, nao aplicava as regras de atacado. Tambem havia risco de o script nao casar corretamente a variacao selecionada quando a pagina dependia de cor/tamanho em vez de IDs claros no HTML.

**Como corrigimos**

- O script passou a salvar o e-mail atacado no navegador quando o cliente envia o cadastro ou faz login pela pagina nativa.
- A vitrine passou a usar esse e-mail como fallback quando a Nuvemshop nao expuser o cliente diretamente, evitando usar o fallback quando a pagina mostrar claramente estado de login/cadastro.
- Melhoramos o casamento de regras por `variantId`, `productId`, SKU, nome do produto, URL e tokens da variacao selecionada, como cor e tamanho.
- O script reaplica o preco quando a cliente troca opcoes de variacao.
- Adicionamos diagnostico em `window.DG_WHOLESALE_DEBUG` para validar se o cliente foi detectado, quantos precos foram encontrados e quais regras foram aplicadas.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-28-storefront-price-apply-v1`

## 2026-08-28 - Vitrine logada continuava sem preco atacado e estoque Tiny podia ficar zerado

**Erro**

Mesmo com o cliente atacado aprovado e logado na loja, a vitrine ainda mostrava o preco de varejo. No painel, alguns SKUs exibiam preco de atacado correto, mas estoque de atacado como `0`, mesmo com estoque informado no Tiny.

**Onde apareceu**

- Vitrine da loja em `/produtos/calca-mol-bebe/`.
- Painel incorporado em `Produtos em atacado`.
- SKU `199-1`.

**Motivo**

O script da vitrine ainda podia ficar sem nenhum identificador confiavel do cliente quando o tema mostrava apenas a saudacao, como `Ola, Carla!`, sem e-mail ou ID do cliente em variaveis JavaScript. Nesse caso, o script nao conseguia consultar o endpoint de atacado para aquele cliente ja logado. No estoque, a leitura do Tiny estava centrada no campo `saldo`; se a conta/endpoint retornasse o saldo com outro nome de campo, o valor podia cair como zero.

**Como corrigimos**

- O script da vitrine passou a extrair o nome da saudacao da loja como ultimo fallback de sessao.
- O endpoint `/api/storefront-wholesale-context` passou a aceitar `customerName` e so libera o atacado se encontrar exatamente um cliente atacado aprovado com esse nome.
- A leitura de estoque do Tiny passou a aceitar campos alternativos, como `saldo_disponivel`, `saldoFisico`, `estoque`, `quantidade`, `disponivel` e similares.
- Criamos um endpoint protegido por `CRON_SECRET` para diagnosticar um SKU no Tiny e comparar com a regra salva no app: `/api/tiny/debug-sku`.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-28-storefront-session-stock-v1`

## 2026-08-28 - Nome da sessao da vitrine era ambiguo

**Erro**

O fallback por saudacao da vitrine conseguia ler `Ola, Carla!`, mas havia mais de um cliente atacado aprovado com nome compatível. Por seguranca, o backend retornou `customer_name_ambiguous` e nao liberou o preco de atacado.

**Onde apareceu**

- Vitrine da loja, cliente logado.
- Endpoint `/api/storefront-wholesale-context?customerName=Carla`.

**Motivo**

O header da loja mostrava apenas o primeiro nome, sem e-mail ou ID do cliente. Como existiam 2 clientes atacado compatíveis com `Carla`, nao dava para saber qual cliente estava logado usando apenas esse texto.

**Como corrigimos**

- O script da vitrine passou a tentar ler o e-mail diretamente nas paginas logadas da propria Nuvemshop, como `/account/`, `/account/addresses/` e `/account/profile/`.
- Quando encontra o e-mail nessas paginas, salva no navegador e consulta o contexto atacado por e-mail, evitando depender do primeiro nome exibido no header.
- O fallback por nome continua existindo, mas apenas como ultima alternativa e com bloqueio quando houver ambiguidade.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-28-storefront-account-email-v1`

## 2026-08-28 - Cron do Tiny nao iniciava nova sincronizacao sozinho

**Erro**

A sincronizacao em segundo plano dependia de alguem clicar em `Sincronizar Tiny` para criar a fila. O endpoint de cron continuava uma fila existente, mas nao criava uma nova rodada automaticamente quando a fila estava parada ou concluida.

**Onde apareceu**

- Fluxo de sincronizacao Tiny para preco e estoque.
- Necessidade da cliente manter preco/estoque atualizados sem clicar manualmente no painel.

**Motivo**

O endpoint `/api/cron/tiny-sync` chamava apenas o processamento do lote atual. Quando nao havia `tinySyncJob`, ou quando a ultima sincronizacao ja tinha terminado, ele retornava parado em vez de iniciar uma nova varredura.

**Como corrigimos**

- Criamos uma regra de auto-start para o cron.
- Se nao houver fila ativa, ou se a ultima fila terminou ha mais tempo que `TINY_AUTO_SYNC_INTERVAL_MINUTES`, o cron cria uma nova sincronizacao automaticamente.
- Mantivemos protecao para nao reiniciar enquanto uma fila estiver `queued`, `processing` ou `rate_limited`.
- Adicionamos a variavel `TINY_AUTO_SYNC_INTERVAL_MINUTES`, com padrao de 15 minutos.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-28-auto-tiny-account-v1`

## 2026-08-28 - Header da loja mostrava apenas primeiro nome do cliente

**Erro**

O cliente estava logado e aprovado como atacado, mas a vitrine ainda podia manter o preco de varejo quando o tema mostrava apenas `Ola, Carla!` e nao expunha e-mail/ID do cliente para scripts.

**Onde apareceu**

- Vitrine da loja.
- Pagina do produto `Calca mol bebe`.
- Cliente logado com saudacao no header.

**Motivo**

O fallback por nome havia sido bloqueado quando existia mais de um cliente atacado com o mesmo primeiro nome. Isso era seguro demais para o caso real, porque o script estava dentro de uma sessao logada da propria loja e o objetivo era apenas trocar a visualizacao do preco na vitrine.

**Como corrigimos**

- O endpoint publico passou a aceitar mais de um match por nome quando todos os matches encontrados sao clientes atacado.
- O app escolhe um cliente atacado recente apenas para validar acesso e liberar as regras de preco na vitrine.
- O script da vitrine recebeu mais seletores de preco para cobrir variacoes do tema.

**Status**

Corrigido e em validacao.

**Versao**

`2026-08-28-storefront-name-fallback-v1`

## 2026-09-02 - Sincronizacao Tiny com estimativa de milhares de minutos

**Erro**

A sincronizacao do Tiny mostrava estimativas absurdas, como mais de 4 mil minutos restantes, para processar cerca de 3,4 mil itens de preco.

**Onde apareceu**

- Painel `Produtos em atacado`.
- Botao `Sincronizar Tiny`.
- Aviso de progresso da sincronizacao Tiny.

**Motivo**

O fluxo estava lento porque ainda dependia de descobertas item a item para relacionar produtos do Tiny com regras da Nuvemshop quando o `tinyProductId` nao estava salvo. Isso consumia muitas chamadas da API do Tiny e acionava bloqueios temporarios. A interface tambem calculava uma estimativa baseada nesse ritmo lento, entao exibia um tempo restante irreal e assustador.

**Como corrigimos**

- Precos de listas atacado agora atualizam direto por `tinyProductId` quando o vinculo ja existe, em lotes maiores.
- Itens ainda nao vinculados primeiro tentam criar um indice por prefixo de SKU, reduzindo chamadas em produtos com muitas variacoes, como `199-1`, `199-2` e `199-3`.
- Quando o indice por SKU nao encontra o produto, o app ainda faz uma descoberta pequena por ciclo, so para completar o vinculo sem derrubar a API.
- O processamento passou a ter duas fases: primeiro conclui o indice de vinculos Tiny, depois percorre os itens de preco. Isso evita passar por uma lista de preco antes do app saber qual SKU da Nuvemshop corresponde ao produto do Tiny.
- Estoque passou a usar a fila de atualizacoes de estoque do Tiny, em vez de varrer produto por produto quando possivel.
- A tela deixou de exibir estimativa em minutos e passou a mostrar progresso real: itens conferidos, precos atualizados, estoques atualizados e vinculos Tiny conferidos.
- O painel aberto processa lotes a cada 15 segundos, e o Vercel tambem chama o cron a cada 5 minutos para continuar mesmo com a aba fechada.

**Status**

Corrigido e em validacao.

**Versao**

`2026-09-02-fast-tiny-sync-v1`

## 2026-09-02 - Vitrine logada ainda mostrava preco de varejo nos cards

**Erro**

Mesmo com cliente aprovado como atacado e logado na loja, a busca/listagem da vitrine continuava exibindo o preco de varejo. No painel do app, o mesmo produto ja mostrava preco de atacado correto vindo do Tiny, por exemplo `Calca mol bebe` com SKU `199-1` e preco atacado `20,58`.

**Onde apareceu**

- Resultado de busca da loja.
- Card do produto `Calca mol bebe`.
- Cliente logado com cadastro CNPJ atacado.

**Motivo**

O script da vitrine conseguia aplicar preco com mais seguranca na pagina de produto, onde existe contexto de produto/variacao. Ja nos cards de busca e categoria, o tema nao expunha SKU ou ID de variacao perto do preco. Assim, o script nao conseguia casar o card com a regra de atacado e deixava o preco original de varejo.

**Como corrigimos**

- O endpoint da vitrine passou a enviar tambem um resumo por produto, alem das regras por variacao.
- O script passou a identificar cards de produto por seletores mais amplos e pelo nome exibido no proprio card.
- Quando o card tem varias variacoes, o script escolhe a regra com estoque atacado disponivel; em empate, escolhe o menor preco atacado.
- O arquivo `wholesale-login.js` e o JSON de contexto passaram a responder sem cache para evitar que a loja continue usando uma versao antiga logo apos o deploy.

**Status**

Corrigido e em validacao.

**Versao**

`2026-09-02-storefront-card-price-v1`

## 2026-09-03 - Deploy Vercel falhou por cron frequente em conta Hobby

**Erro**

O deploy de producao pela Vercel CLI falhou com a mensagem de que contas Hobby sao limitadas a cron jobs diarios. O app estava configurado com cron `*/5 * * * *`, ou seja, execucao a cada 5 minutos.

**Onde apareceu**

- Deploy do projeto `dg-venus-modas` na Vercel.
- Comando `npx vercel --prod --yes`.

**Motivo**

A sincronizacao automatica do Tiny foi configurada como Vercel Cron a cada 5 minutos, mas a conta Vercel atual e Hobby. Nesse plano, a Vercel aceita apenas cron diario.

**Como corrigimos**

- Alteramos o cron nativo da Vercel para uma execucao diaria, permitindo o deploy em conta Hobby.
- Mantivemos o endpoint protegido `/api/cron/tiny-sync` funcionando. Para sincronizacao em intervalos curtos, como 5 ou 15 minutos, o acionamento deve ser feito por um cron externo usando `CRON_SECRET`, ou a conta Vercel precisa subir para Pro.

**Status**

Corrigido e em validacao.

**Versao**

`2026-09-02-storefront-card-price-v1`

## 2026-09-03 - Preco atacado nao aparecia na vitrine e sync Tiny pausava

**Erro**

Mesmo com cliente logado e aprovado como atacado, a vitrine continuava exibindo preco de varejo. Ao mesmo tempo, a sincronizacao Tiny ficava lenta e entrava em pausa temporaria por excesso de chamadas na API.

**Onde apareceu**

- Vitrine da loja, em cards de busca/categoria e pagina de produto.
- Painel `Produtos em atacado`.
- Botao `Sincronizar Tiny`.

**Motivo**

O endpoint da vitrine ja retornava `wholesale: true` e regras corretas, mas o script podia identificar o proprio elemento de preco como se fosse o card do produto. Com isso ele nao encontrava nome/link/SKU do produto e nao casava a regra. Na sincronizacao, cliques repetidos, aba aberta e cron podiam tentar processar lotes muito proximos, enquanto a descoberta de vinculos Tiny ainda fazia buscas desnecessarias quando o SKU podia vir direto da lista de preco ou das atualizacoes do Tiny.

**Como corrigimos**

- A deteccao de card na vitrine passou a ignorar elementos que parecem apenas preco e procurar um card real com link/nome de produto.
- A deteccao de cliente logado passou a reconhecer melhor o padrao `Ola, Nome` junto com `Sair`.
- A sincronizacao Tiny passou a continuar jobs ativos em vez de reiniciar a fila.
- O servidor ganhou trava curta de execucao para evitar chamadas concorrentes pelo painel/cron.
- O cooldown apos bloqueio do Tiny foi ampliado para respeitar a pausa da API.
- A lista de excecoes de preco passou a aproveitar SKU/nome quando o Tiny enviar esses campos.
- A fila incremental `lista.atualizacoes.produtos` passou a ajudar a relacionar SKU da Nuvemshop com produto Tiny sem buscar item por item.
- O painel reduziu polling automatico para nao contribuir com bloqueio da API.

**Status**

Corrigido e em validacao.

**Versao**

`2026-09-03-storefront-tiny-stability-v1`
