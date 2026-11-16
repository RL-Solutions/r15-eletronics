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
--    Só acessórios de tabacaria. Produtos de tabaco não podem ser vendidos
--    por via postal (Lei 9.294/96) e cigarros eletrônicos são proibidos
--    no Brasil (Anvisa, RDC 855/2024).
insert into public.products (name, variant, category, price, sale_price, stock, featured, clearance, ships_today, sort_order) values
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
  ('Bag Grande com Cadeado',        'Preta',                 'Bags',         129.90, 109.90,   0, false, false, true,  15);