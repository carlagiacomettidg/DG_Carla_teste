# Registro de erros - Cadastro atacado Nuvemshop

Data: 14/08/2026

Este arquivo registra os erros encontrados no desenvolvimento do cadastro de atacado da Vênus Modas, a causa identificada e a correção aplicada ou planejada.

## 1. Erro 404 ao criar cliente

Mensagem exibida:

```txt
Nuvemshop API 404: Last page is 0
```

Onde aconteceu:

- Formulário de cadastro de atacado na loja.
- Busca de cliente existente por e-mail antes de criar um novo cliente.

Causa:

- A API da Nuvemshop retornou 404 com `Last page is 0` quando não havia nenhum cliente com aquele e-mail.
- O app estava tratando esse retorno como erro real, mas nesse caso ele significa apenas "cliente não encontrado".

Correção aplicada:

- A função `findCustomerByEmail` foi ajustada para interpretar `Last page is 0` como cliente inexistente.
- Assim, quando o e-mail não existe, o app segue para criar um novo cliente.

Status:

- Corrigido.

## 2. Erro 422 com campo `total_orders`

Mensagem exibida:

```txt
Nuvemshop API 422: Invalid fields for this resource: total_orders
```

Onde aconteceu:

- Criação ou atualização de cliente via API da Nuvemshop.

Causa:

- O app tentou enviar para a API um campo que é somente leitura.
- `total_orders` é uma informação calculada pela Nuvemshop, não pode ser enviada no cadastro do cliente.

Correção aplicada:

- Removemos `total_orders` do payload enviado para criar/atualizar cliente.
- O campo continua podendo ser lido da Nuvemshop, mas não deve ser enviado.

Status:

- Corrigido.

## 3. Erro 422 com `send_email_invite` e `password`

Mensagem exibida:

```txt
Nuvemshop API 422:
send_email_invite must not be present
password must not be present
```

Onde aconteceu:

- Tentativa de criar cliente de atacado via API com senha e convite de e-mail.

Causa:

- Embora a documentação de clientes indique os campos `password` e `send_email_invite`, a loja/API respondeu rejeitando esses campos no cenário testado.
- Isso indica que, para essa loja ou versão/escopo da API, a criação de cliente com senha diretamente via API não está sendo aceita.

Correção aplicada:

- Removemos esses campos em uma tentativa anterior para permitir criar o cliente no painel.

Problema restante:

- Sem `password`, o cliente pode aparecer no painel da Nuvemshop, mas não necessariamente consegue fazer login na loja.

Status:

- Corrigido com fallback.
- O app tenta criar com senha e convite.
- Se a Nuvemshop rejeitar `password`/`send_email_invite`, o app tenta novamente sem esses campos para pelo menos salvar o cliente e marcar como atacado.
- Nesse caso, a tela informa que a conta ainda precisa de ativação/login pela própria Nuvemshop.

## 4. Cliente aparece no painel, mas não consegue login

Mensagem exibida na loja:

```txt
Esses dados estão incorretos.
Não achamos nenhuma conta cadastrada com esse e-mail.
```

Onde aconteceu:

- Login e recuperação de senha da loja.

Causa identificada:

- A Nuvemshop diferencia "cliente cadastrado no painel" de "conta ativa na vitrine".
- O cliente pode existir na lista de clientes, mas ainda não ter uma conta ativa com senha para login.
- A documentação mostra o campo `active`, que indica se a conta do cliente foi ativada.

Correção planejada:

- O app precisa criar o cliente e validar se a Nuvemshop retornou `active: true`.
- Se não retornar ativo, o app não deve dizer que o login está liberado.
- A tela deve informar que o cadastro foi recebido/salvo e orientar ativação/recuperação conforme o comportamento real da Nuvemshop.

Status:

- Corrigido parcialmente.
- O retorno agora inclui `loginAvailable` com base no campo `active`.
- Se `active` não vier como `true`, a tela não promete login imediato.

## 5. Tentativa de usar formulário nativo da Nuvemshop não cadastrou o cliente

Comportamento observado:

- Ao finalizar o cadastro atacado, a tela voltou para um formulário nativo vazio.
- O cliente não apareceu mais na lista de clientes.
- Não houve mensagem clara de erro para a usuária.

Causa provável:

- O script tentou submeter o formulário nativo da Nuvemshop preenchendo campos de forma automática.
- Essa abordagem depende da estrutura interna do tema e dos campos reais esperados pelo formulário da loja.
- Como não validamos todos os nomes/ações reais do formulário antes, a submissão não criou o cliente corretamente.

Correção aplicada:

- Reverter a submissão automática do formulário nativo.
- Voltar o envio para o endpoint do nosso app: `/api/wholesale-requests`.
- O app passa a controlar a resposta e mostrar erro/sucesso de forma clara.

Status:

- Corrigido nesta rodada.
- Nova versão do script: `2026-08-14-api-register-v1`.

## 6. Falta de mensagem clara quando o cadastro falha

Comportamento observado:

- A loja não mostrava uma explicação útil quando o cadastro não era concluído.
- Em alguns testes, parecia que havia enviado, mas o cliente não conseguia login nem aparecia como conta ativa.

Causa:

- O front estava assumindo sucesso em cenários que ainda dependiam de confirmação real da API.
- Também houve tentativa de redirecionamento/submissão nativa que saiu do controle do nosso app.

Correção planejada:

- Toda resposta do cadastro deve mostrar:
  - se o cliente foi criado na Nuvemshop;
  - se foi aprovado como atacado;
  - se login está realmente disponível;
  - o que fazer quando a conta ainda não está ativa.

Status:

- Corrigido nesta rodada.
- A tela volta a mostrar confirmação ou erro vindo do endpoint do app.
- Quando a conta não está ativa para login, a mensagem orienta a ativação pela Nuvemshop.

## 7. Erro 401 de token inválido

Mensagem exibida:

```txt
Nuvemshop API 401: Unauthorized / Invalid access token
```

Onde aconteceu:

- Chamadas para API da Nuvemshop após instalação/autorização incorreta ou token antigo.

Causa:

- Token de acesso inválido, ausente ou antigo.

Correção aplicada:

- Reinstalar/autorizar novamente o app na loja.
- Garantir que o OAuth salve o `accessToken` correto no banco.

Status:

- Corrigido quando a loja foi reinstalada/autorizada.

## 8. Erro 403 de escopo `read_locations`

Mensagem exibida:

```txt
Missing required scope: read_locations
```

Onde aconteceu:

- Botão de atualizar/sincronizar centros de distribuição.

Causa:

- O app não tinha permissão para ler centros de distribuição.

Correção aplicada:

- Ativar o escopo `read_locations` no Portal de Parceiros da Nuvemshop.
- Reinstalar o app na loja para gerar novo token com esse escopo.

Status:

- Corrigido.
