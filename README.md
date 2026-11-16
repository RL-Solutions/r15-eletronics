# Loja: vitrine mobile-first com estoque no Supabase

Site estático para GitHub Pages:

- **Vitrine** (`index.html`): pensada primeiro para celular, com navegação inferior, carrosséis com swipe e carrinho em painel deslizante.
- **Estoque ao vivo:** a contagem vem do Supabase e atualiza na tela sem recarregar (Realtime).
- **Carrinho:** respeita o estoque disponível. O pedido é finalizado pelo **WhatsApp**, com a mensagem já montada.
- **Painel admin** (`admin.html`): login da equipe e botões **+ / −** para ajustar o estoque pelo celular.

Sem o Supabase configurado, o site roda com produtos de demonstração.

## Arquivos

| Arquivo | O que é |
|---|---|
| `config.js` | **Único arquivo para personalizar:** nome da marca, WhatsApp, textos das promoções, data da contagem regressiva e chaves do Supabase |
| `index.html` / `styles.css` / `app.js` | Vitrine |
| `admin.html` | Painel de estoque |
| `supabase/schema.sql` | Tabela `products` (com peso e medidas para o frete), segurança (RLS), função `adjust_stock`, Realtime e produtos de exemplo |
| `supabase/functions/frete/index.ts` | Edge Function que calcula o frete (Correios, Melhor Envio, Uber Direct e Lalamove) |

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

## Aviso de idade e o que pode ser vendido

- `ageGate: true` no `config.js` mostra a pergunta "Você tem 18 anos ou mais?" na primeira visita. O rodapé e o pedido no WhatsApp também trazem o aviso.
- O catálogo é só de **acessórios de tabacaria**. Não cadastre:
  - produtos de tabaco (fumo, cigarros), porque a Lei 9.294/96 proíbe vendê-los por via postal;
  - cigarros eletrônicos, refis ou essências, porque a venda e a propaganda são proibidas pela Anvisa (RDC 855/2024).

## Baixa de estoque

As vendas fecham no WhatsApp, então a baixa é feita pela equipe no `admin.html` (botão −). Todos os clientes com o site aberto veem o número mudar na hora.
