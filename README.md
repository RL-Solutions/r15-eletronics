# Loja: vitrine mobile-first com estoque no Supabase

Site estático para GitHub Pages:

- **Vitrine** (`index.html`): pensada primeiro para celular, com navegação inferior, carrosséis com swipe e carrinho em painel deslizante.
- **Estoque ao vivo:** a contagem vem do Supabase e atualiza na tela sem recarregar (Realtime).
- **Carrinho:** respeita o estoque disponível e calcula o frete pelo CEP.
- **Pagamento no site:** Pix e cartão em até 12x pelo **Mercado Pago**. Cada pedido tem um número único (ex.: `R15-1001`), e depois de pagar o cliente pode falar do pedido no WhatsApp com a mensagem já pronta. Sem o Mercado Pago configurado, o pedido segue pelo WhatsApp.
- **Painel admin** (`admin.html`): login da equipe, **pedidos para separar e enviar** (com código de rastreio e aviso ao cliente no WhatsApp) e botões **+ / −** para ajustar o estoque pelo celular.

Sem o Supabase configurado, o site roda com produtos de demonstração.

## Arquivos

| Arquivo | O que é |
|---|---|
| `config.js` | **Único arquivo para personalizar:** nome da marca, WhatsApp, textos das promoções, data da contagem regressiva e chaves do Supabase |
| `index.html` / `styles.css` / `app.js` | Vitrine |
| `admin.html` | Painel da equipe: pedidos e estoque |
| `supabase/schema.sql` | Tabelas `products` (com peso e medidas para o frete) e `orders`, segurança (RLS), funções de estoque, Realtime e produtos de exemplo |
| `supabase/functions/frete/index.ts` | Edge Function que calcula o frete (Correios, Melhor Envio, Uber Direct e Lalamove) |
| `supabase/functions/pagamento/index.ts` | Edge Function que cria os pedidos, cobra no Pix ou no cartão e recebe os avisos do Mercado Pago |

## Ligar o Supabase (cerca de 5 minutos)

1. Crie um projeto em <https://supabase.com>.
2. Abra **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**. Cole as duas em `config.js`, nos campos `supabaseUrl` e `supabaseAnonKey`.
   - A chave *anon* pode ficar no site: o RLS só permite que visitantes **leiam** produtos ativos.
   - **Nunca** coloque a chave `service_role` no site.
4. Crie o usuário da equipe em **Authentication → Users → Add user** (e-mail e senha).
5. Em **Authentication → Providers → Email**, **desative "Allow new users to sign up"**. Assim ninguém consegue criar conta sozinho e mexer no estoque.

## Cadastrar produtos

Use **Table Editor → products**. Campos principais:

- `price`: preço normal. `sale_price` é o preço promocional (opcional; o site calcula o "% OFF").
- `stock`: **contagem de estoque**. Com 0, o produto aparece como "Esgotado". Com 3 ou menos, aparece "Restam X unidades".
- `featured`: aparece em "Mais procurados". `clearance` aparece em "Queima de estoque". `ships_today` aparece em "Envio imediato".
- `image_url`: link da foto. Sem foto, o site mostra um ícone da categoria.
- `active = false`: esconde o produto do site.

## Frete

O cliente digita o CEP no carrinho e vê as opções com preço e prazo, da mais barata para a mais cara. A opção escolhida, o endereço do CEP e o total com frete vão na mensagem do WhatsApp.

O cálculo roda numa **Edge Function do Supabase**, porque as chaves das transportadoras não podem ficar no site. O GitHub Pages é público. O bloco de frete só aparece quando o Supabase está ligado no `config.js`.

### 1. Peso e medidas dos produtos

Rode o `supabase/schema.sql` de novo (é seguro rodar mais de uma vez). Ele cria `weight_kg`, `width_cm`, `height_cm` e `length_cm` em cada produto, com um padrão de 200 g e 12 × 4 × 17 cm. Ajuste os itens maiores (bags, cases, bandejas) no **Table Editor**. São as medidas de **uma unidade embalada**.

### 2. Publicar a função

Pelo painel: **Edge Functions → Deploy a new function → Via Editor**. Dê o nome `frete`, cole o conteúdo de `supabase/functions/frete/index.ts` e clique em **Deploy**.

- Se a sua chave pública começa com `sb_publishable_`, desligue **Enforce JWT verification** nas configurações da função.
- Pelo terminal, o equivalente é `npx supabase functions deploy frete --no-verify-jwt`.

### 3. Secrets

Configure em **Edge Functions → Secrets**. Ligue só os provedores que você tem: cada um aparece no site quando os secrets dele estão preenchidos.

| Secret | Para quê |
|---|---|
| `ORIGEM_CEP` | **Obrigatório.** CEP de onde sai o pedido |
| `APP_NOME`, `APP_CONTATO` | **Obrigatório.** Nome da loja e e-mail técnico. O Melhor Envio exige essa identificação |
| `ALLOWED_ORIGINS` | Recomendado: `https://rl-solutions.github.io` (só o seu site pode chamar a função) |
| `MELHOR_ENVIO_TOKEN` | Melhor Envio. Cota **Correios (PAC/SEDEX) sem contrato**, Jadlog, **Loggi**, J&T e outras |
| `MELHOR_ENVIO_SANDBOX` | `true` para testar no ambiente de teste do Melhor Envio |
| `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`, `CORREIOS_CARTAO` | Correios direto, **com contrato**. Usuário do Meu Correios, código de acesso à API e cartão de postagem |
| `CORREIOS_CONTRATO`, `CORREIOS_DR` | Número do contrato e da diretoria regional, para o preço do seu contrato |
| `CORREIOS_SERVICOS` | Serviços do seu contrato. Padrão: `03220:SEDEX,03298:PAC` |
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_CUSTOMER_ID` | Uber Direct (entrega no mesmo dia) |
| `LALAMOVE_KEY`, `LALAMOVE_SECRET` | Lalamove (entrega no mesmo dia) |
| `LALAMOVE_SANDBOX`, `LALAMOVE_SERVICE` | `true` para testar; tipo de veículo (padrão `LALAGO`, moto) |
| `ORIGEM_ENDERECO`, `ORIGEM_LAT`, `ORIGEM_LNG` | Para Uber e Lalamove: rua e número da loja e as coordenadas (pegue no Google Maps, botão direito no local) |

Com o contrato dos Correios ligado, a função não repete os Correios que vêm pelo Melhor Envio.

### Onde conseguir cada chave

- **Melhor Envio:** crie a conta, vá em **Integrações → Permissões de acesso → Gerar token** e marque a permissão de cálculo de frete. Teste antes em `sandbox.melhorenvio.com.br`, com `MELHOR_ENVIO_SANDBOX=true`.
- **Correios:** precisa de contrato. No portal **CWS** dos Correios, gere o código de acesso à API e libere as APIs **Preço** e **Prazo** para o seu cartão de postagem. Os códigos de serviço variam por contrato; confirme com os Correios.
- **Uber Direct:** conta empresarial em `direct.uber.com`. Em **Developer**, ficam o Customer ID, o Client ID e o Client Secret. Funciona só em algumas cidades.
- **Lalamove:** cadastro no Partner Portal, onde ficam as chaves de API. Comece pelo sandbox e confirme o tipo de veículo disponível na sua cidade.
- **Loggi:** já vem pelo Melhor Envio. A API própria da Loggi é para contas empresariais com contrato.

### Bom saber

- O endereço do CEP vem da BrasilAPI (com o ViaCEP de reserva). Para Uber e Lalamove, as coordenadas vêm do OpenStreetMap quando a BrasilAPI não tem.
- A cotação de entrega rápida usa só a rua do CEP. O número e o complemento o cliente informa no WhatsApp, e o valor final é confirmado ali.
- **Confira a lista de itens proibidos de cada transportadora.** Isqueiros com gás ou fluido costumam ser proibidos nos Correios e no transporte aéreo. Apps de entrega também podem restringir produtos de tabacaria.
- Se um provedor sair do ar, os outros continuam aparecendo. O erro fica em **Edge Functions → frete → Logs**.

## Pagamento no site (Mercado Pago)

**Antes de tudo:** confirme com o Mercado Pago que a sua atividade (acessórios de tabacaria) é aceita. Os termos deles restringem produtos ligados a tabaco, e uma conta fora das regras pode ter o dinheiro retido.

### Como funciona

1. No carrinho, o cliente calcula o frete e toca em **Ir para o pagamento**.
2. Preenche nome, e-mail, WhatsApp, CPF, número e complemento, e confirma que tem 18 anos ou mais.
3. **Pix:** aparecem o QR Code e o código copia-e-cola, com prazo para pagar (30 minutos por padrão). O site confere sozinho e mostra "Pagamento aprovado" assim que o Pix cai.
4. **Cartão:** o formulário é o oficial do Mercado Pago, dentro do site. Os dados do cartão vão direto para o Mercado Pago e nunca passam pela loja.
5. Com o pagamento aprovado, o carrinho esvazia, o estoque baixa sozinho e aparece o botão **Falar sobre o pedido no WhatsApp**, com o número do pedido na mensagem.

Os preços e o frete são calculados na Edge Function, a partir do banco e da cotação salva. Não dá para mudar o valor cobrado pelo navegador.

### Configurar (cerca de 15 minutos)

1. **Rode o `supabase/schema.sql` de novo.** Ele cria as tabelas `orders` (pedidos) e `shipping_quotes` (cotações de frete) e a função que baixa o estoque.
2. **Crie a aplicação no Mercado Pago:** em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação de pagamentos online. Em **Credenciais**, ficam a **Public Key** e o **Access Token**. Comece pelas **credenciais de teste**.
3. **Publique a função** `pagamento`: **Edge Functions → Deploy a new function → Via Editor**, nome `pagamento`, cole `supabase/functions/pagamento/index.ts`.
   - Desligue **Enforce JWT verification** nessa função. O aviso do Mercado Pago não manda a chave do Supabase.
   - Pelo terminal: `npx supabase functions deploy pagamento --no-verify-jwt`.
4. **Secrets** (Edge Functions → Secrets):

   | Secret | Para quê |
   |---|---|
   | `MP_ACCESS_TOKEN` | **Obrigatório.** Access Token do Mercado Pago. Nunca coloque no site |
   | `MP_WEBHOOK_SECRET` | Recomendado. Assinatura secreta do webhook (passo 5) |
   | `PIX_DESCONTO` | Desconto do Pix. Padrão `0.035`; **use o mesmo valor de `pixDiscount` no `config.js`** |
   | `PIX_EXPIRA_MIN` | Minutos para pagar o Pix. Padrão `30` |
   | `APP_NOME` | Nome da loja na descrição do pagamento |
   | `MP_FATURA` | Nome na fatura do cartão (até 13 letras), ex.: `R15ELETRONICS` |
   | `ALLOWED_ORIGINS` | Recomendado: `https://rl-solutions.github.io` |

5. **Webhook:** na sua aplicação do Mercado Pago, em **Webhooks**, coloque a URL `https://SEU-PROJETO.supabase.co/functions/v1/pagamento/webhook`, marque o evento **Pagamentos** e copie a **assinatura secreta** para o secret `MP_WEBHOOK_SECRET`. Mesmo se o aviso atrasar, o site consulta o Mercado Pago enquanto o cliente espera.
6. **No `config.js`,** cole a Public Key em `mercadoPagoPublicKey`. A Public Key pode ficar no site.
7. **Teste** com as credenciais de teste e os [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards) do Mercado Pago. Depois troque **as duas** (Public Key e Access Token) pelas de produção. As duas precisam ser do mesmo modo, teste ou produção.

### Separar e enviar (aba **Pedidos** do `admin.html`)

Entre no `admin.html` com o usuário da equipe. A aba **Pedidos** abre direto na fila **A enviar** e atualiza sozinha quando chega um pagamento.

1. **A enviar:** pedidos pagos que ainda não saíram. Entregas no mesmo dia (Uber, Lalamove) aparecem primeiro, com o selo **Mesmo dia**; o resto vem na ordem de pagamento, o mais antigo primeiro.
2. **Separar:** marque cada item conforme pega na prateleira. As marcações ficam salvas naquele aparelho.
3. **Imprimir** gera uma folha só com aquele pedido (itens e endereço) para ir junto na caixa. **Copiar endereço** serve para colar na etiqueta dos Correios ou no app de entrega.
4. **Marcar como enviado:** se tiver, digite o código de rastreio antes. O pedido vai para **Enviados**, e aparece o botão **Avisar o cliente**, que abre o WhatsApp do cliente com o número do pedido e o rastreio. Errou? **Desfazer envio** devolve o pedido para a fila.
5. **Revisar:** pedidos com algum problema no pagamento (veja a tabela abaixo). Resolva no Mercado Pago e, se estiver tudo certo, toque em **Resolvido, liberar para envio**: o pedido volta para **A enviar**. Se você estornar o pagamento, o pedido muda para estornado sozinho.

O número vermelho na aba **Pedidos** soma os pedidos a enviar e a revisar. Pelo painel, a equipe só consegue mudar o envio, o rastreio e tirar um pedido da revisão. Valores, itens e dados do cliente só mudam pelas funções do site.

> Já rodou o `schema.sql` antes? Rode de novo o arquivo inteiro: ele acrescenta os campos de envio (`shipped_at`, `tracking_code`, `reviewed_at`) e liga o Realtime dos pedidos, sem apagar nada.

### Os pedidos no Supabase

Os pedidos também ficam em **Table Editor → orders**. O campo `code` é o número que o cliente vê, e `id` é o identificador interno; os dois são únicos.

| `status` | O que quer dizer |
|---|---|
| `pending` | Aguardando o pagamento |
| `paid` | Pago. O estoque já foi baixado; é só separar e enviar. Depois de enviado, `shipped_at` e `tracking_code` ficam preenchidos |
| `expired` / `cancelled` | O Pix venceu ou o pagamento foi cancelado. Nada foi cobrado |
| `refunded` | Estornado ou contestado no cartão |
| `needs_review` | **Precisa da sua atenção.** O motivo fica em `review_reason`: pagamento em dobro, valor menor que o total, estoque que acabou entre o pedido e o pagamento, ou pago depois de vencer. Resolva pelo painel do Mercado Pago (estorno) e fale com o cliente. Se o pedido puder seguir, libere pelo `admin.html` |

Os dados dos clientes (nome, CPF, e-mail, telefone, endereço) só aparecem para quem está logado no Supabase. Cite essa coleta na política de privacidade da loja (LGPD).

## Aviso de idade e o que pode ser vendido

- `ageGate: true` no `config.js` mostra a pergunta "Você tem 18 anos ou mais?" na primeira visita. O rodapé e o pedido no WhatsApp também trazem o aviso.
- O catálogo é só de **acessórios de tabacaria**. Não cadastre:
  - produtos de tabaco (fumo, cigarros), porque a Lei 9.294/96 proíbe vendê-los por via postal;
  - cigarros eletrônicos, refis ou essências, porque a venda e a propaganda são proibidas pela Anvisa (RDC 855/2024).

## Baixa de estoque

Pedidos pagos no site baixam o estoque sozinhos. Vendas fechadas no WhatsApp ou no balcão são baixadas pela equipe no `admin.html` (botão −). Todos os clientes com o site aberto veem o número mudar na hora.
