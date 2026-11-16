-- =====================================================================
--  Loja — schema do Supabase (produtos + estoque)
--  Como usar: Supabase Dashboard > SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- 1) Tabela de produtos -----------------------------------------------
create table if not exists public.products (
  id           bigint generated always as identity primary key,
  name         text        not null,
  variant      text,                              -- cor / sabor / modelo
  brand        text,
  category     text        not null default 'Acessórios',
  price        numeric(10,2) not null check (price >= 0),          -- preço "de"
  sale_price   numeric(10,2)          check (sale_price >= 0),     -- preço "por" (opcional)
  stock        integer     not null default 0 check (stock >= 0),  -- contagem de estoque
  image_url    text,
  featured     boolean     not null default false,  -- "Mais procurados"
  clearance    boolean     not null default false,  -- "Queima de estoque"
  ships_today  boolean     not null default true,   -- "Envio imediato"
  active       boolean     not null default true,   -- aparece no site?
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists products_active_idx   on public.products (active, sort_order);
create index if not exists products_category_idx on public.products (category);

-- Peso e medidas da embalagem de UMA unidade (usados no cálculo do frete).
-- Os padrões servem para itens pequenos; ajuste bags, cases e bandejas.
alter table public.products add column if not exists weight_kg numeric(6,3) not null default 0.2  check (weight_kg > 0);
alter table public.products add column if not exists width_cm  numeric(5,1) not null default 12   check (width_cm  > 0);
alter table public.products add column if not exists height_cm numeric(5,1) not null default 4    check (height_cm > 0);
alter table public.products add column if not exists length_cm numeric(5,1) not null default 17   check (length_cm > 0);

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
for each row execute function public.touch_updated_at();

-- 2) Segurança (Row Level Security) ------------------------------------
--    Visitantes (anon) só LEEM produtos ativos.
--    Somente usuários logados no painel admin (authenticated) alteram.
alter table public.products enable row level security;

drop policy if exists "Leitura publica de produtos ativos" on public.products;
create policy "Leitura publica de produtos ativos"
  on public.products for select
  to anon, authenticated
  using (active = true or auth.role() = 'authenticated');

drop policy if exists "Admin altera produtos" on public.products;
create policy "Admin altera produtos"
  on public.products for all
  to authenticated
  using (true) with check (true);

-- 3) Ajuste atômico de estoque (usado pelo painel admin) ---------------
--    Ex.: select adjust_stock(5, -1);  -> vendeu 1 unidade
create or replace function public.adjust_stock(p_id bigint, p_delta integer)
returns integer
language plpgsql
security invoker
as $$
declare new_stock integer;
begin
  update public.products
     set stock = greatest(stock + p_delta, 0)
   where id = p_id
  returning stock into new_stock;
  return new_stock;
end $$;

revoke execute on function public.adjust_stock(bigint, integer) from anon, public;
grant  execute on function public.adjust_stock(bigint, integer) to authenticated;

-- 4) Realtime: o site atualiza a contagem ao vivo -----------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;

-- 5) Cotações de frete ---------------------------------------------------
--    A função "frete" salva cada cotação aqui; a função "pagamento" usa o
--    valor salvo, então o cliente não consegue mudar o preço do frete.
create table if not exists public.shipping_quotes (
  id          uuid primary key default gen_random_uuid(),
  cep         text  not null,
  address     jsonb,
  items_key   text  not null,          -- itens e quantidades da cotação
  options     jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.shipping_quotes enable row level security;  -- só as funções (service role) acessam

-- 6) Pedidos --------------------------------------------------------------
--    id   = identificador interno único (uuid)
--    code = número único que o cliente vê, ex.: R15-1001
create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique default ('R15-' || nextval('public.order_number_seq')),
  status                 text not null default 'pending'
                         check (status in ('pending','paid','cancelled','expired','refunded','needs_review')),
  payment_method         text not null check (payment_method in ('pix','card')),
  payment_id             text unique,
  payment_status         text,
  payment_status_detail  text,
  items                  jsonb not null,            -- [{id, name, variant, qty, unit_price}]
  subtotal               numeric(10,2) not null,
  discount               numeric(10,2) not null default 0,
  shipping               numeric(10,2) not null default 0,
  total                  numeric(10,2) not null,
  shipping_option        jsonb,
  shipping_cep           text,
  shipping_address       jsonb,
  address_number         text,
  address_complement     text,
  customer_name          text not null,
  customer_email         text not null,
  customer_phone         text,
  customer_cpf           text,
  age_confirmed          boolean not null default false,
  access_token           uuid not null default gen_random_uuid(),  -- o cliente usa para ver o status
  pix_qr_code            text,
  pix_qr_base64          text,
  pix_expires_at         timestamptz,
  stock_applied          boolean not null default false,
  review_reason          text,
  paid_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders (status, created_at desc);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
for each row execute function public.touch_updated_at();

alter table public.orders enable row level security;
drop policy if exists "Admin le pedidos" on public.orders;
create policy "Admin le pedidos" on public.orders for select to authenticated using (true);
drop policy if exists "Admin altera pedidos" on public.orders;
create policy "Admin altera pedidos" on public.orders for update to authenticated using (true) with check (true);

-- Envio e revisão (preenchidos pela equipe no admin.html)
alter table public.orders add column if not exists shipped_at    timestamptz;
alter table public.orders add column if not exists tracking_code text check (char_length(tracking_code) <= 40);
alter table public.orders add column if not exists reviewed_at   timestamptz;

-- A equipe só altera os campos de envio e revisão. Total, itens, cliente e
-- dados do pagamento só mudam pelas funções (service role).
revoke update on public.orders from anon, authenticated;
grant  update (status, shipped_at, tracking_code, reviewed_at) on public.orders to authenticated;
revoke insert, delete on public.orders from anon, authenticated;
revoke all on public.shipping_quotes from anon, authenticated;

-- Pela tela, a equipe só tira um pedido da revisão (volta a "pago")
-- e só marca como enviado um pedido pago.
create or replace function public.guard_order_status()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if new.status is distinct from old.status
       and not (old.status = 'needs_review' and new.status = 'paid') then
      raise exception 'A equipe só pode marcar um pedido em revisão como resolvido';
    end if;
    if new.shipped_at is not null and old.shipped_at is null and new.status <> 'paid' then
      raise exception 'Só pedidos pagos podem ser marcados como enviados';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_guard_status on public.orders;
create trigger orders_guard_status before update on public.orders
for each row execute function public.guard_order_status();

-- Baixa de estoque do pedido pago (uma vez só, mesmo se o aviso chegar repetido).
-- Devolve false se faltou estoque de algum item: o pedido vai para revisão.
create or replace function public.apply_order_stock(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o  public.orders%rowtype;
  it jsonb;
  n  integer;
  ok boolean := true;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.stock_applied then return true; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    update public.products
       set stock = stock - (it->>'qty')::integer
     where id = (it->>'id')::bigint and stock >= (it->>'qty')::integer;
    get diagnostics n = row_count;
    if n = 0 then ok := false; end if;
  end loop;
  update public.orders set stock_applied = true where id = p_order;
  return ok;
end $$;

revoke execute on function public.apply_order_stock(uuid) from anon, authenticated, public;
grant  execute on function public.apply_order_stock(uuid) to service_role;

-- Pedidos novos aparecem na hora no admin.html (o RLS garante que só a equipe vê)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- 7) Produtos de exemplo (apague ou edite à vontade) --------------------
--    Só acessórios de tabacaria. Produtos de tabaco não podem ser vendidos
--    por via postal (Lei 9.294/96) e cigarros eletrônicos são proibidos
--    no Brasil (Anvisa, RDC 855/2024).
--    Só entram com a tabela vazia, então rodar este arquivo de novo é seguro.
insert into public.products (name, variant, category, price, sale_price, stock, featured, clearance, ships_today, sort_order)
select * from (values
  ('Seda King Size Slim',           'Livreto com 33 folhas', 'Sedas',          7.90,   6.50, 120, true,  false, true,   1),
  ('Seda Brown King Size',          'Sem branqueamento',     'Sedas',          8.90,   null,  85, true,  false, true,   2),
  ('Piteira de Vidro Reutilizável', '6 mm',                  'Piteiras',      24.90,  19.90,  18, true,  false, true,   3),
  ('Bloco de Piteiras de Papel',    'Extra longa',           'Piteiras',       6.90,   5.90,  64, true,  false, true,   4),
  ('Isqueiro Recarregável',         'Preto fosco',           'Isqueiros',     14.90,  12.90,  40, true,  false, true,   5),
  ('Isqueiro Maçarico Jet',         'Chama azul',            'Isqueiros',     69.90,  54.90,   5, true,  false, false,  6),
  ('Bag Anti-Odor Média',           'Roxa, com zíper',       'Bags',          89.90,  69.90,  12, true,  false, true,   7),
  ('Case Rígido com Divisórias',    'Preto',                 'Cases',         59.90,  49.90,   9, true,  false, true,   8),
  ('Bag Impermeável Pequena',       'Preta',                 'Bags',          45.00,  34.90,   1, false, true,  true,   9),
  ('Dichavador de Metal 4 Partes',  'Grafite, 50 mm',        'Dichavadores',  79.90,  59.90,   2, false, true,  true,  10),
  ('Case Porta-Sedas',              'Couro sintético',       'Cases',         39.90,  29.90,   1, false, true,  true,  11),
  ('Piteira de Vidro Colorida',     '8 mm, roxa',            'Piteiras',      29.90,  22.90,   2, false, true,  true,  12),
  ('Bandeja de Metal Média',        '27 × 16 cm',            'Acessórios',    34.90,   null,  22, false, false, true,  13),
  ('Cinzeiro de Silicone',          'Roxo',                  'Acessórios',    24.90,  19.90,  15, false, false, true,  14),
  ('Bag Grande com Cadeado',        'Preta',                 'Bags',         129.90, 109.90,   0, false, false, true,  15)
) as seed (name, variant, category, price, sale_price, stock, featured, clearance, ships_today, sort_order)
where not exists (select 1 from public.products);