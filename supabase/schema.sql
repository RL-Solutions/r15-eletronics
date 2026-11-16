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

-- 5) Produtos de exemplo (apague ou edite à vontade) --------------------
insert into public.products (name, variant, brand, category, price, sale_price, stock, featured, clearance, ships_today, sort_order) values
  ('Fone Bluetooth Pro ANC',        'Preto',        'Sonik',   'Áudio',         249.90, 199.90, 14, true,  false, true,  1),
  ('Caixa de Som Boom Mini',         'Azul',         'Sonik',   'Áudio',         189.90, 159.90,  6, true,  false, true,  2),
  ('Carregador Turbo 65W GaN',       'USB-C x2',     'Voltera', 'Carregadores',  159.90, 129.90, 22, true,  false, true,  3),
  ('Power Bank 20.000mAh',           'Grafite',      'Voltera', 'Carregadores',  199.90, 169.90,  9, true,  false, true,  4),
  ('Smartwatch Fit S3',              'Preto',        'Pulso',   'Wearables',     329.90, 279.90,  4, true,  false, false, 5),
  ('Cabo USB-C Trançado 2m',         '100W',         'Voltera', 'Cabos',          49.90,  39.90, 40, true,  false, true,  6),
  ('Ring Light 10" com Tripé',       'Branco',       'Lumo',    'Acessórios',    139.90,  null, 12, true,  false, true,  7),
  ('Teclado Mecânico Compacto',      'Switch Red',   'Kraft',   'Gamer',         299.90, 259.90,  7, true,  false, false, 8),
  ('Fone TWS Air Lite',              'Branco',       'Sonik',   'Áudio',         129.90,  99.90,  1, false, true,  true,  9),
  ('Mouse Gamer RGB 12.000 DPI',     'Preto',        'Kraft',   'Gamer',         149.90, 119.90,  2, false, true,  true, 10),
  ('Suporte Veicular Magnético',     'MagSafe',      'Lumo',    'Acessórios',     89.90,  69.90,  1, false, true,  true, 11),
  ('Hub USB-C 7 em 1',               'HDMI 4K',      'Voltera', 'Acessórios',    219.90, 179.90,  2, false, true,  true, 12),
  ('Película Hydrogel Premium',      'Universal',    'Lumo',    'Acessórios',     39.90,  null, 55, false, false, true, 13),
  ('Controle Bluetooth Gamepad',     'Preto',        'Kraft',   'Gamer',         179.90, 149.90,  0, false, false, true, 14);
