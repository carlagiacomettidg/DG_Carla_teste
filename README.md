# Venos Nuvemshop App

MVP de app sob demanda para controlar atacado e varejo com o mesmo SKU, separando preco, estoque, CD e priorizacao de frete/checkout.

## O que este MVP entrega

- Painel web para configurar o CD de atacado.
- Cadastro de regras de atacado por SKU/variante.
- Importacao de planilha CSV ou XLSX com preco e estoque de atacado.
- Cadastro/aprovacao simples de clientes atacadistas por CNPJ.
- Lista de clientes atacadistas com aprovacao, remocao de acesso, exclusao e desconto extra.
- Modo de aprovacao configuravel: revisao manual ou automatico com CNPJ valido.
- Simulador de checkout para validar a escolha do CD.
- Endpoint de Business Rules `location/prioritization`.
- Cliente base da API Nuvemshop para OAuth, locations e inventory levels.
- Armazenamento local em JSON para desenvolvimento.

## O que ainda precisa ser validado com a Nuvemshop

- Liberacao de Business Rules para o app no Portal de Parceiros.
- Se o Nuvem Envio respeita integralmente o CD retornado por `location/prioritization`.
- Qual sera o mecanismo oficial para aplicar preco personalizado no checkout: desconto, promocao, script/app proxy ou API especifica liberada para o app.
- Se o app sob demanda pode ser publicado como app incorporado no admin da Nuvemshop para a loja da cliente.

## Como rodar localmente

```bash
npm install
npm run dev
```

Como o projeto nao usa dependencias, o `npm install` e opcional.

Abra:

```text
http://localhost:3000
```

## Endpoints principais

- `GET /` painel do app.
- `GET /health` status.
- `GET /api/settings` configuracoes da loja/CDs.
- `PUT /api/settings` salva configuracoes.
- `GET /api/rules` lista regras por SKU.
- `POST /api/rules` cria regra.
- `PUT /api/rules/:id` atualiza regra.
- `DELETE /api/rules/:id` remove regra.
- `POST /api/simulate-checkout` simula a decisao de CD.
- `POST /business-rules/location-prioritization` callback da Nuvemshop.
- `GET /auth/install` inicio do OAuth.
- `GET /auth/callback` callback do OAuth.

## Modelo tecnico esperado

1. A cliente cadastra o produto normal na Nuvemshop com o mesmo SKU.
2. O varejo segue o fluxo padrao da Nuvemshop.
3. O app guarda apenas a regra de atacado: SKU, preco atacado, estoque atacado e CD atacado.
4. O time importa uma planilha de atacado no app.
5. O cliente atacadista se identifica por login/CNPJ.
6. Se o modo for manual, o cliente precisa estar aprovado na lista.
7. Se o modo for automatico, um CNPJ com digitos validos ja libera o acesso atacado.
8. No checkout, a Nuvemshop chama o callback `location/prioritization`.
9. Se o cliente/carrinho for atacado, o app devolve o CD atacado como prioridade.
10. Se nao for atacado, o app nao interfere e a Nuvemshop segue o varejo padrao.

## Observacao sobre CNPJ

O MVP valida o formato e os digitos verificadores do CNPJ. Para confirmar se o CNPJ esta ativo na Receita Federal, o app deve ser integrado a uma API externa de consulta CNPJ.

## Modelo de planilha

Colunas aceitas:

- `sku`
- `produto` ou `productName`
- `preco_atacado` ou `wholesalePrice`
- `estoque_atacado` ou `wholesaleStock`
- `variant_id` ou `variantId` opcional

Arquivos `.xls` antigos devem ser salvos como `.xlsx` ou `.csv` antes da importacao.

## Observacao sobre preco

Este MVP deixa a configuracao de preco pronta no painel, mas nao promete a aplicacao final do preco no checkout. Essa parte depende da API/regra oficial liberada pela Nuvemshop para apps. Se a aplicacao for feita por desconto, o checkout pode exibir "preco normal + desconto de atacado".
