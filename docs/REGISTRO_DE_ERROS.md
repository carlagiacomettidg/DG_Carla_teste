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

