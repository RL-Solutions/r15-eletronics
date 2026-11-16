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
| `supabase/schema.sql` | Tabela `products`, segurança (RLS), função `adjust_stock`, Realtime e produtos de exemplo |

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

## Aviso de idade e o que pode ser vendido

- `ageGate: true` no `config.js` mostra a pergunta "Você tem 18 anos ou mais?" na primeira visita. O rodapé e o pedido no WhatsApp também trazem o aviso.
- O catálogo é só de **acessórios de tabacaria**. Não cadastre:
  - produtos de tabaco (fumo, cigarros), porque a Lei 9.294/96 proíbe vendê-los por via postal;
  - cigarros eletrônicos, refis ou essências, porque a venda e a propaganda são proibidas pela Anvisa (RDC 855/2024).

## Baixa de estoque

As vendas fecham no WhatsApp, então a baixa é feita pela equipe no `admin.html` (botão −). Todos os clientes com o site aberto veem o número mudar na hora.
