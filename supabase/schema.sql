-- =====================================================================
--  Кофейня: предзаказ и доставка — схема базы для Supabase
--  Выполните этот файл целиком в Supabase → SQL Editor → New query → Run.
--  Повторный запуск безопасен для функций и политик; таблицы создаются
--  только если их ещё нет.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Настройки заведения (одна строка)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                 int primary key default 1 check (id = 1),
  name               text not null default 'Кофейня',
  address            text not null default '',
  whatsapp           text not null default '',      -- 77001234567
  kaspi_phone        text not null default '',      -- номер, с которого приходят счета
  timezone           text not null default 'Asia/Almaty',
  open_time          time not null default '08:00',
  close_time         time not null default '21:00',
  prep_minutes       int  not null default 10 check (prep_minutes between 1 and 120),
  accepting_orders   boolean not null default true, -- быстрая пауза приёма заказов
  pickup_enabled     boolean not null default true,
  pay_kaspi          boolean not null default true,
  pay_place          boolean not null default true,
  pay_online         boolean not null default false, -- эквайринг, подключим позже
  delivery_enabled   boolean not null default false,
  delivery_fee       int  not null default 500  check (delivery_fee >= 0),
  delivery_min_order int  not null default 3000 check (delivery_min_order >= 0),
  delivery_minutes   int  not null default 30   check (delivery_minutes between 5 and 240),
  delivery_zone      text not null default '',
  updated_at         timestamptz not null default now()
);
-- зона доставки: точка кофейни и радиус (добавляется и в уже созданную базу)
alter table public.settings add column if not exists shop_lat double precision;
alter table public.settings add column if not exists shop_lng double precision;
alter table public.settings add column if not exists delivery_radius_km numeric(5,2) not null default 2;
alter table public.settings add column if not exists delivery_free_from int not null default 0;
do $$ begin
  alter table public.settings add constraint settings_radius_chk check (delivery_radius_km between 0.2 and 30);
exception when duplicate_object then null; end $$;

insert into public.settings (id, name, address, whatsapp, kaspi_phone, timezone)
values (1, 'Kese Coffee', 'Астана, ул. Лепсы, 42/1', '79033274496', '+7 707 281 68 89', 'Asia/Almaty')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
--  Меню
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  sort   int  not null default 0,
  active boolean not null default true
);

-- Группа добавок: «Молоко» (одна на выбор), «Дополнительно» (несколько)
create table if not exists public.modifier_groups (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  multi boolean not null default false,
  sort  int not null default 0
);

create table if not exists public.modifiers (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.modifier_groups(id) on delete cascade,
  name       text not null,
  price      int  not null default 0 check (price >= 0),
  is_default boolean not null default false,  -- выбран по умолчанию в группе «одна на выбор»
  active     boolean not null default true,
  sort       int  not null default 0
);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  category_id        uuid references public.categories(id) on delete set null,
  name               text not null,
  description        text not null default '',
  image_url          text,
  price              int check (price >= 0),           -- если нет размеров
  sizes              jsonb not null default '[]',      -- [{"label":"M","volume":"350 мл","price":1400}]
  modifier_group_ids uuid[] not null default '{}',
  available          boolean not null default true,    -- false = стоп-лист (закончилось)
  active             boolean not null default true,    -- false = скрыт из меню
  sort               int not null default 0,
  created_at         timestamptz not null default now()
);

-- метка на позиции в меню («Хит», «Новинка»)
alter table public.products add column if not exists badge text not null default '';

-- ---------------------------------------------------------------------
--  Профили и роли: guest (гость), staff (бариста), admin (владелец)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text not null default '',
  phone      text not null default '',
  role       text not null default 'guest' check (role in ('guest','staff','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Гость не может сам повысить себе роль. Из SQL Editor (auth.uid() пустой) — можно.
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Менять роль может только администратор';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    new.email := old.email;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_role();

-- ---------------------------------------------------------------------
--  Заказы
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           int  not null,                 -- номер за день: 1, 2, 3…
  business_date    date not null,
  user_id          uuid references auth.users(id) on delete set null,
  guest_token      uuid not null default gen_random_uuid(),  -- доступ к заказу без аккаунта
  customer_name    text not null,
  customer_phone   text not null default '',
  fulfillment      text not null default 'pickup' check (fulfillment in ('pickup','delivery')),
  asap             boolean not null default true,
  ready_at         timestamptz not null,          -- когда забрать / привезти
  delivery_address text,
  delivery_details text,
  comment          text not null default '',
  payment_method   text not null check (payment_method in ('kaspi','place','online')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid','invoice_sent','paid','refunded')),
  status           text not null default 'new'
                   check (status in ('new','accepted','ready','on_the_way','completed','cancelled')),
  cancel_reason    text,
  subtotal         int not null default 0,
  delivery_fee     int not null default 0,
  total            int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.orders add column if not exists delivery_lat double precision;
alter table public.orders add column if not exists delivery_lng double precision;
alter table public.orders add column if not exists delivery_km numeric(6,2);
-- откуда заказ: online — гость с сайта, counter — бариста внёс у стойки
alter table public.orders add column if not exists source text not null default 'online';
do $$ begin
  alter table public.orders add constraint orders_source_check check (source in ('online', 'counter'));
exception when duplicate_object then null; end $$;

create index if not exists orders_business_date_idx on public.orders (business_date desc, number desc);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status) where status in ('new','accepted','ready','on_the_way');

create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  size        text,
  modifiers   jsonb not null default '[]',
  unit_price  int not null,
  qty         int not null check (qty between 1 and 20),
  line_total  int not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
--  Партнёры: автосервисы и другие точки, где стоит наш QR.
--  Заказ по QR партнёра запоминает партнёра; с выданных заказов
--  партнёру начисляется процент (выплата на Kaspi раз в месяц).
-- ---------------------------------------------------------------------
create table if not exists public.partners (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,23}$'),  -- в ссылке: ?p=code
  name               text not null check (length(btrim(name)) between 1 and 80),
  address            text not null default '',
  place_hint         text not null default '',          -- «зона ожидания, 1 этаж» — подсказка курьеру
  lat                double precision,
  lng                double precision,
  rate_pct           numeric(4,1) not null default 10  check (rate_pct between 0 and 50),
  rate_high_pct      numeric(4,1) not null default 15  check (rate_high_pct between 0 and 50),
  high_from_qty      int  not null default 100 check (high_from_qty >= 0),   -- 0 — без повышенной ставки
  delivery_enabled   boolean not null default true,
  delivery_fee       int  not null default 300 check (delivery_fee >= 0),
  delivery_free_qty  int  not null default 2   check (delivery_free_qty >= 0),  -- бесплатно от N позиций, 0 — всегда платно
  delivery_minutes   int  not null default 15  check (delivery_minutes between 5 and 120),
  payout_phone       text not null default '',          -- номер Kaspi для выплат
  payout_name        text not null default '',          -- кому платим (владелец или сотрудник)
  note               text not null default '',
  active             boolean not null default true,
  stats_token        uuid not null default gen_random_uuid() unique,  -- ссылка на статистику для партнёра
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists partners_touch on public.partners;
create trigger partners_touch before update on public.partners
  for each row execute function public.touch_updated_at();

create table if not exists public.partner_payouts (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  period      date not null check (extract(day from period) = 1),   -- первый день месяца
  amount      int  not null check (amount >= 0),
  paid_at     timestamptz not null default now(),
  note        text not null default '',
  unique (partner_id, period)
);

alter table public.orders add column if not exists partner_id   uuid references public.partners(id) on delete set null;
alter table public.orders add column if not exists partner_name text;
alter table public.orders add column if not exists to_partner   boolean not null default false;
create index if not exists orders_partner_idx on public.orders (partner_id, business_date) where partner_id is not null;

-- расстояние по прямой, км
create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns numeric language sql immutable as $$
  select round((2 * 6371 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2) +
           cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric, 2);
$$;

-- ---------------------------------------------------------------------
--  Правила доступа (RLS)
-- ---------------------------------------------------------------------
alter table public.settings        enable row level security;
alter table public.categories      enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifiers       enable row level security;
alter table public.products        enable row level security;
alter table public.profiles        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;

-- меню и настройки видят все, меняет только админ
do $$
declare t text;
begin
  foreach t in array array['settings','categories','modifier_groups','modifiers','products'] loop
    execute format('drop policy if exists "%s_read" on public.%I', t, t);
    execute format('create policy "%s_read" on public.%I for select using (true)', t, t);
    execute format('drop policy if exists "%s_admin_write" on public.%I', t, t);
    execute format('create policy "%s_admin_write" on public.%I for all using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists orders_admin_delete on public.orders;
create policy orders_admin_delete on public.orders for delete using (public.is_admin());
-- создаются заказы только через функцию place_order (цены считает сервер)

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff()))
);

-- партнёров и выплаты видит и меняет только админ (гостю нужное отдаёт get_partner)
alter table public.partners        enable row level security;
alter table public.partner_payouts enable row level security;
drop policy if exists partners_admin on public.partners;
create policy partners_admin on public.partners for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists partner_payouts_admin on public.partner_payouts;
create policy partner_payouts_admin on public.partner_payouts for all using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.partners, public.partner_payouts to authenticated;
grant select on public.settings, public.categories, public.modifier_groups, public.modifiers, public.products to anon, authenticated;
grant insert, update, delete on public.settings, public.categories, public.modifier_groups, public.modifiers, public.products to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update, delete on public.orders to authenticated;
grant select on public.order_items to authenticated;

-- ---------------------------------------------------------------------
--  Оформление заказа. Цены, время и доступность проверяет сервер.
-- ---------------------------------------------------------------------
create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s         public.settings;
  v_now     timestamptz := now();
  v_today   date;
  v_ful     text := coalesce(p->>'fulfillment', 'pickup');
  v_pay     text := coalesce(p->>'payment_method', 'kaspi');
  v_asap    boolean := coalesce((p->>'asap')::boolean, true);
  v_name    text := btrim(coalesce(p->>'customer_name', ''));
  v_phone   text := regexp_replace(coalesce(p->>'customer_phone', ''), '[^0-9+]', '', 'g');
  v_lead    int;
  v_ready   timestamptz;
  v_rlocal  timestamp;
  v_item    jsonb;
  v_prod    public.products;
  v_size    jsonb;
  v_unit    int;
  v_qty     int;
  v_mods    jsonb;
  v_mod     record;
  v_ids     jsonb;
  v_sub     int := 0;
  v_fee     int := 0;
  v_items   jsonb := '[]';
  v_num     int;
  v_order   public.orders;
  v_lat     double precision;
  v_lng     double precision;
  v_km      numeric;
  v_code    text := lower(btrim(coalesce(p->>'partner', '')));
  v_partner public.partners;
  v_has_partner boolean := false;
  v_to_partner  boolean := false;
  v_cnt     int := 0;
  -- заказ у стойки: вносит бариста (через counter_order), гость стоит рядом
  v_counter boolean := coalesce((p->>'counter')::boolean, false);
  v_status  text := 'new';
  v_paid    boolean := false;
begin
  select * into s from public.settings where id = 1;
  v_today := (v_now at time zone s.timezone)::date;

  if v_counter then
    if not public.is_staff() then raise exception 'Нет доступа'; end if;
    v_ful := 'pickup'; v_asap := true; v_code := '';
    if v_name = '' then v_name := 'Гость'; end if;
    v_status := case when p->>'status' = 'completed' then 'completed' else 'accepted' end;
    v_paid := coalesce((p->>'paid')::boolean, false);
    if v_pay not in ('kaspi', 'place') then raise exception 'Неизвестный способ оплаты'; end if;
  elsif not s.accepting_orders then
    raise exception 'Сейчас мы не принимаем онлайн-заказы. Загляните к нам лично!';
  end if;
  if v_name = '' or length(v_name) > 60 then raise exception 'Укажите имя'; end if;
  if v_ful not in ('pickup','delivery') then raise exception 'Неизвестный способ получения'; end if;

  -- партнёр (QR в автосервисе и т. п.): неизвестный или отключённый код просто не учитываем
  if v_code <> '' then
    select * into v_partner from public.partners where code = v_code and active;
    v_has_partner := found;
  end if;
  v_to_partner := v_has_partner and v_ful = 'delivery' and coalesce((p->>'to_partner')::boolean, false);
  if v_to_partner and not v_partner.delivery_enabled then
    raise exception 'Доставка в «%» сейчас недоступна. Можно оформить самовывоз', v_partner.name;
  end if;

  if v_ful = 'pickup'   and not s.pickup_enabled and not v_counter then raise exception 'Самовывоз сейчас недоступен'; end if;
  if v_ful = 'delivery' and not s.delivery_enabled and not v_to_partner then raise exception 'Доставка пока недоступна'; end if;
  if not v_counter and (v_pay not in ('kaspi','place','online')
     or (v_pay = 'kaspi'  and not s.pay_kaspi)
     or (v_pay = 'place'  and not s.pay_place)
     or (v_pay = 'online' and not s.pay_online)) then
    raise exception 'Этот способ оплаты сейчас недоступен';
  end if;
  if not v_counter and (v_pay = 'kaspi' or v_ful = 'delivery') and length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
    raise exception 'Укажите номер телефона: на него придёт счёт в Kaspi';
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Корзина пуста';
  end if;
  if jsonb_array_length(p->'items') > 30 then raise exception 'Слишком большой заказ, позвоните нам'; end if;

  -- защита от случайных дублей и спама: не больше 3 заказов с одного номера за 5 минут
  if not v_counter and v_phone <> '' and (select count(*) from public.orders
       where customer_phone = v_phone and created_at > v_now - interval '5 minutes') >= 3 then
    raise exception 'Заказ уже отправлен. Подождите пару минут или напишите нам';
  end if;

  -- время
  v_lead := case when v_to_partner then v_partner.delivery_minutes
                 when v_ful = 'delivery' then s.delivery_minutes else s.prep_minutes end;
  if v_counter then
    -- у стойки: готовим сейчас, часы работы не проверяем
    v_ready := v_now + case when v_status = 'completed' then interval '0 minutes' else make_interval(mins => s.prep_minutes) end;
  elsif v_asap then
    if v_now < ((v_today + s.open_time) at time zone s.timezone)
       or v_now + make_interval(mins => s.prep_minutes) > ((v_today + s.close_time) at time zone s.timezone) then
      raise exception 'Сейчас мы закрыты. Выберите время, когда заберёте заказ';
    end if;
    v_ready := v_now + make_interval(mins => v_lead);
  else
    begin
      v_ready := (p->>'ready_at')::timestamptz;
    exception when others then
      raise exception 'Не удалось прочитать время';
    end;
    if v_ready is null then raise exception 'Выберите время'; end if;
    if v_ready < v_now + make_interval(mins => v_lead - 1) then
      raise exception 'К этому времени не успеем. Выберите время не раньше чем через % мин', v_lead;
    end if;
    if v_ready > v_now + interval '36 hours' then raise exception 'Заказать можно на сегодня или на завтра'; end if;
    v_rlocal := v_ready at time zone s.timezone;
    if v_rlocal::time < s.open_time or v_rlocal::time > s.close_time then
      raise exception 'Мы работаем с % до %', to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI');
    end if;
  end if;

  -- позиции: цену берём только из базы
  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty < 1 or v_qty > 20 then raise exception 'Неверное количество'; end if;

    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and active;
    if not found then raise exception 'Одна из позиций больше не продаётся. Обновите меню'; end if;
    if not v_prod.available then raise exception '«%» закончился, уберите его из заказа', v_prod.name; end if;

    if jsonb_array_length(v_prod.sizes) > 0 then
      select e into v_size from jsonb_array_elements(v_prod.sizes) e where e->>'label' = v_item->>'size' limit 1;
      if v_size is null then raise exception 'Выберите размер для «%»', v_prod.name; end if;
      v_unit := (v_size->>'price')::int;
    else
      v_size := null;
      v_unit := coalesce(v_prod.price, 0);
    end if;

    v_ids  := coalesce(v_item->'modifier_ids', '[]');
    v_mods := '[]';
    for v_mod in
      select m.id, m.name, m.price, m.group_id, m.active, m.is_default, g.multi
      from public.modifiers m join public.modifier_groups g on g.id = m.group_id
      where m.id::text in (select jsonb_array_elements_text(v_ids))
      order by g.sort, m.sort
    loop
      if not v_mod.active or not (v_mod.group_id = any(v_prod.modifier_group_ids)) then
        raise exception 'Добавка к «%» недоступна, выберите другую', v_prod.name;
      end if;
      v_unit := v_unit + v_mod.price;
      v_mods := v_mods || jsonb_build_object('id', v_mod.id, 'name', v_mod.name, 'price', v_mod.price,
                                             'group_id', v_mod.group_id, 'is_default', v_mod.is_default);
    end loop;
    if jsonb_array_length(v_mods) <> (select count(distinct x) from jsonb_array_elements_text(v_ids) x) then
      raise exception 'Добавка к «%» недоступна, обновите меню', v_prod.name;
    end if;
    if exists (select 1 from jsonb_array_elements(v_mods) e
               join public.modifier_groups g on g.id = (e->>'group_id')::uuid
               where not g.multi group by g.id having count(*) > 1) then
      raise exception 'В «%» выбрано несколько вариантов там, где нужен один', v_prod.name;
    end if;

    v_sub := v_sub + v_unit * v_qty;
    v_cnt := v_cnt + v_qty;
    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name,
      'size', case when v_size is null then null
                   else btrim((v_size->>'label') || ' ' || coalesce(v_size->>'volume', '')) end,
      'modifiers', v_mods, 'unit_price', v_unit, 'qty', v_qty);
  end loop;

  if v_to_partner then
    -- к партнёру: без минимальной суммы, адрес и точка — партнёра, своя цена доставки
    v_lat := v_partner.lat; v_lng := v_partner.lng;
    if v_lat is not null and v_lng is not null and s.shop_lat is not null and s.shop_lng is not null then
      v_km := public.km_between(s.shop_lat, s.shop_lng, v_lat, v_lng);
    end if;
    v_fee := case when v_partner.delivery_free_qty > 0 and v_cnt >= v_partner.delivery_free_qty then 0
                  else v_partner.delivery_fee end;
  elsif v_ful = 'delivery' then
    if v_sub < s.delivery_min_order then
      raise exception 'Минимальный заказ на доставку % ₸', s.delivery_min_order;
    end if;
    if btrim(coalesce(p->>'delivery_address', '')) = '' then raise exception 'Укажите адрес доставки'; end if;
    begin
      v_lat := nullif(p->>'delivery_lat', '')::double precision;
      v_lng := nullif(p->>'delivery_lng', '')::double precision;
    exception when others then v_lat := null; v_lng := null;
    end;
    if v_lat is not null and (v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180) then
      v_lat := null; v_lng := null;
    end if;
    if s.shop_lat is not null and s.shop_lng is not null then
      if v_lat is null then raise exception 'Отметьте адрес на карте, чтобы мы проверили зону доставки'; end if;
      v_km := round((2 * 6371 * asin(sqrt(
                power(sin(radians(v_lat - s.shop_lat) / 2), 2) +
                cos(radians(s.shop_lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - s.shop_lng) / 2), 2))))::numeric, 2);
      if v_km > s.delivery_radius_km then
        raise exception 'Этот адрес в % км от нас, а доставляем в радиусе % км. Можно оформить самовывоз',
          replace(to_char(v_km, 'FM990.0'), '.', ','), replace(to_char(s.delivery_radius_km, 'FM990.0'), '.', ',');
      end if;
    end if;
    v_fee := case when s.delivery_free_from > 0 and v_sub >= s.delivery_free_from then 0 else s.delivery_fee end;
  end if;

  perform pg_advisory_xact_lock(hashtext('orders_daily_number'));
  select coalesce(max(number), 0) + 1 into v_num from public.orders where business_date = v_today;

  insert into public.orders (number, business_date, user_id, customer_name, customer_phone, fulfillment,
                             asap, ready_at, delivery_address, delivery_details, comment,
                             payment_method, subtotal, delivery_fee, total, delivery_lat, delivery_lng, delivery_km,
                             partner_id, partner_name, to_partner, status, payment_status, source)
  values (v_num, v_today, case when v_counter then null else auth.uid() end, v_name, v_phone, v_ful, v_asap, v_ready,
          case when v_to_partner then left(v_partner.name || case when v_partner.address <> '' then ', ' || v_partner.address else '' end, 300)
               when v_ful = 'delivery' then left(btrim(p->>'delivery_address'), 300) end,
          case when v_to_partner then left(coalesce(nullif(btrim(coalesce(p->>'delivery_details', '')), ''), v_partner.place_hint), 300)
               when v_ful = 'delivery' then left(btrim(coalesce(p->>'delivery_details', '')), 300) end,
          left(btrim(coalesce(p->>'comment', '')), 500),
          v_pay, v_sub, v_fee, v_sub + v_fee,
          case when v_ful = 'delivery' then v_lat end, case when v_ful = 'delivery' then v_lng end, v_km,
          case when v_has_partner then v_partner.id end, case when v_has_partner then v_partner.name end, v_to_partner,
          v_status, case when v_paid then 'paid' else 'unpaid' end, case when v_counter then 'counter' else 'online' end)
  returning * into v_order;

  insert into public.order_items (order_id, product_id, name, size, modifiers, unit_price, qty, line_total)
  select v_order.id, (e->>'product_id')::uuid, e->>'name', e->>'size', e->'modifiers',
         (e->>'unit_price')::int, (e->>'qty')::int, (e->>'unit_price')::int * (e->>'qty')::int
  from jsonb_array_elements(v_items) e;

  if auth.uid() is not null and not v_counter then
    update public.profiles set
      name  = case when name  = '' then v_name  else name  end,
      phone = case when phone = '' then v_phone else phone end
    where id = auth.uid();
  end if;

  -- уведомление персоналу на телефоны (если настроено; ошибка уведомления заказ не ломает).
  -- Заказ у стойки бариста внёс сам — о нём не сообщаем.
  if not v_counter then
    perform public.push_order_event(v_order.id, 'new_order');
  end if;

  return jsonb_build_object('id', v_order.id, 'number', v_order.number, 'token', v_order.guest_token,
                            'total', v_order.total, 'ready_at', v_order.ready_at, 'status', v_order.status,
                            'counter', v_counter);
end $$;

-- Заказ у стойки: гость пришёл в кофейню, бариста вносит заказ в панели.
-- Не зависит от паузы онлайн-заказов и часов работы; телефон и имя не обязательны.
-- p: { items, customer_name?, customer_phone?, payment_method: 'place'|'kaspi', paid, status: 'accepted'|'completed', comment? }
create or replace function public.counter_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  return public.place_order(coalesce(p, '{}'::jsonb) || jsonb_build_object('counter', true));
end $$;

-- Заказ целиком (для гостя по токену, для владельца аккаунта и персонала — без токена)
create or replace function public.get_order(p_id uuid, p_token uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select (to_jsonb(o) - 'guest_token') || jsonb_build_object(
           'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id = o.id), '[]'))
  from public.orders o
  where o.id = p_id
    and (o.guest_token = p_token or (auth.uid() is not null and o.user_id = auth.uid()) or public.is_staff());
$$;

-- История гостя без аккаунта: [{ "id": "...", "token": "..." }, ...]
create or replace function public.get_guest_orders(p_pairs jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
           (to_jsonb(o) - 'guest_token') || jsonb_build_object(
             'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id = o.id), '[]'))
           order by o.created_at desc), '[]')
  from public.orders o
  join jsonb_to_recordset(coalesce(p_pairs, '[]')) as x(id uuid, token uuid)
    on x.id = o.id and x.token = o.guest_token;
$$;

-- Гость отменяет заказ, пока его не приняли
create or replace function public.cancel_order(p_id uuid, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders
   where id = p_id and (guest_token = p_token or (auth.uid() is not null and user_id = auth.uid()));
  if not found then raise exception 'Заказ не найден'; end if;
  if v.status <> 'new' then raise exception 'Заказ уже готовят. Напишите нам, если нужно его отменить'; end if;
  update public.orders set status = 'cancelled', cancel_reason = 'Отменён гостем' where id = p_id;
  perform public.push_order_event(p_id, 'cancelled');
  return public.get_order(p_id, p_token);
end $$;

-- После входа в аккаунт привязываем к нему заказы, сделанные без регистрации
create or replace function public.claim_orders(p_pairs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.orders o set user_id = auth.uid()
  from jsonb_to_recordset(coalesce(p_pairs, '[]')) as x(id uuid, token uuid)
  where o.id = x.id and o.guest_token = x.token and o.user_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Бариста ставит позицию на стоп и обратно (менять цены может только админ)
create or replace function public.set_available(p_id uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  update public.products set available = p_value where id = p_id;
end $$;

-- Бариста может временно убрать добавку (например, закончилось овсяное молоко)
create or replace function public.set_modifier_active(p_id uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  update public.modifiers set active = p_value where id = p_id;
end $$;

-- Пауза приёма заказов доступна и бариста
create or replace function public.set_accepting(p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  update public.settings set accepting_orders = p_value, updated_at = now() where id = 1;
end $$;

-- Команда: список и назначение ролей по email (человек должен сначала зарегистрироваться)
create or replace function public.list_team() returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where public.is_admin() and role in ('staff','admin') order by role, email;
$$;

create or replace function public.set_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if p_role not in ('guest','staff','admin') then raise exception 'Неизвестная роль'; end if;
  select id into v_id from public.profiles where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Пользователь % ещё не зарегистрирован. Пусть сначала создаст аккаунт в приложении', p_email;
  end if;
  if v_id = auth.uid() and p_role <> 'admin' then raise exception 'Нельзя снять права администратора с самого себя'; end if;
  update public.profiles set role = p_role where id = v_id;
end $$;

-- ---------------------------------------------------------------------
--  Партнёры: данные для гостя, отчёт для админа, статистика для партнёра
-- ---------------------------------------------------------------------
-- Гость открыл ссылку с ?p=code: только то, что нужно для заказа (без номеров для выплат)
create or replace function public.get_partner(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'name', name, 'address', address, 'place_hint', place_hint,
           'delivery_enabled', delivery_enabled, 'delivery_fee', delivery_fee,
           'delivery_free_qty', delivery_free_qty, 'delivery_minutes', delivery_minutes)
  from public.partners where code = lower(btrim(coalesce(p_code, ''))) and active;
$$;

-- Итоги партнёра за месяц. Считаются только выданные заказы (status = completed).
-- Сумма — без платы за доставку. Ставка повышается, если позиций за месяц >= high_from_qty.
-- Функция не вызывается напрямую из приложения: её используют partner_report и partner_stats.
create or replace function public.partner_month(p_partner uuid, p_month date) returns jsonb
language sql stable set search_path = public as $$
  with pr as (select * from public.partners where id = p_partner),
  m as (select date_trunc('month', p_month)::date as d1, (date_trunc('month', p_month) + interval '1 month')::date as d2),
  o as (
    select o.business_date, o.subtotal, o.status,
           coalesce((select sum(i.qty) from public.order_items i where i.order_id = o.id), 0)::int as qty
    from public.orders o, m
    where o.partner_id = p_partner and o.business_date >= m.d1 and o.business_date < m.d2
  ),
  done as (select * from o where status = 'completed'),
  t as (select count(*)::int as orders, coalesce(sum(qty), 0)::int as qty, coalesce(sum(subtotal), 0)::int as subtotal from done),
  r as (select case when pr.high_from_qty > 0 and t.qty >= pr.high_from_qty then pr.rate_high_pct else pr.rate_pct end as rate from pr, t)
  select jsonb_build_object(
    'month', (select d1 from m),
    'orders', t.orders, 'qty', t.qty, 'subtotal', t.subtotal,
    'in_progress', (select count(*) from o where status in ('new','accepted','ready','on_the_way')),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'rate', r.rate, 'payout', floor(t.subtotal * r.rate / 100)::int,
    'rate_pct', pr.rate_pct, 'rate_high_pct', pr.rate_high_pct, 'high_from_qty', pr.high_from_qty,
    'paid', (select jsonb_build_object('amount', x.amount, 'paid_at', x.paid_at, 'note', x.note)
               from public.partner_payouts x, m where x.partner_id = p_partner and x.period = m.d1),
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', business_date, 'orders', n, 'qty', q, 'subtotal', sm) order by business_date)
                        from (select business_date, count(*) as n, sum(qty) as q, sum(subtotal) as sm from done group by business_date) d), '[]'))
  from pr, t, r;
$$;
revoke execute on function public.partner_month(uuid, date) from public, anon, authenticated;

-- Отчёт по всем партнёрам за месяц — для выплат
create or replace function public.partner_report(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'active', p.active,
             'payout_phone', p.payout_phone, 'payout_name', p.payout_name, 'stats_token', p.stats_token)
             || public.partner_month(p.id, p_month)
           order by p.active desc, p.name)
    from public.partners p), '[]');
end $$;

-- Статистика для самого партнёра по секретной ссылке (без данных гостей)
create or replace function public.partner_stats(p_token uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.partners; s public.settings; m date;
begin
  select * into v from public.partners where stats_token = p_token;
  if not found then raise exception 'Ссылка недействительна. Попросите новую у кофейни'; end if;
  select * into s from public.settings where id = 1;
  m := date_trunc('month', coalesce(p_month, (now() at time zone s.timezone)::date))::date;
  return jsonb_build_object('name', v.name, 'active', v.active, 'shop', s.name,
           'history', (select jsonb_agg(public.partner_month(v.id, (m - make_interval(months => k))::date) - 'days' order by k)
                         from generate_series(1, 5) k))
         || public.partner_month(v.id, m);
end $$;

-- ---------------------------------------------------------------------
--  Push-уведомления персоналу о новых заказах.
--  Телефон бариста подписывается в панели (push_subscribe). При новом
--  заказе база через pg_net отправляет POST на ваш сервер (/push/order),
--  а сервер рассылает уведомления. Адрес и секрет сервера задаются один
--  раз командой, которую печатает deploy.sh:
--    select public.set_push_config('https://ваш-сайт/push/order', 'секрет');
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net недоступен — push-уведомления работать не будут (%).', sqlerrm;
end $$;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device       text not null default '',
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz
);
create table if not exists public.push_config (
  id         int primary key default 1 check (id = 1),
  url        text not null,
  secret     text not null,
  updated_at timestamptz not null default now()
);
-- напрямую эти таблицы не читает никто: только через функции ниже
alter table public.push_subscriptions enable row level security;
alter table public.push_config        enable row level security;
revoke all on public.push_subscriptions, public.push_config from anon, authenticated;

create or replace function public.set_push_config(p_url text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Нет доступа'; end if;
  if coalesce(p_url, '') !~ '^https://' or length(coalesce(p_secret, '')) < 16 then
    raise exception 'Нужен адрес https://…/push/order и секрет из deploy.sh';
  end if;
  insert into public.push_config (id, url, secret) values (1, btrim(p_url), btrim(p_secret))
  on conflict (id) do update set url = excluded.url, secret = excluded.secret, updated_at = now();
end $$;
revoke execute on function public.set_push_config(text, text) from public, anon, authenticated;

-- Отправка на сервер уведомлений: текст + список подписок [{endpoint, p256dh, auth}].
-- Возвращает число устройств; 0 — некому или не настроено. Никогда не падает.
create or replace function public.push_post(p_payload jsonb, p_subs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c public.push_config; n int := coalesce(jsonb_array_length(p_subs), 0);
begin
  if n = 0 then return 0; end if;
  select * into c from public.push_config where id = 1;
  if not found or to_regnamespace('net') is null then return 0; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
    using c.url, jsonb_build_object('payload', p_payload, 'subs', p_subs),
          jsonb_build_object('Content-Type', 'application/json', 'x-kese-secret', c.secret);
  return n;
exception when others then
  raise warning 'push_post: %', sqlerrm;
  return 0;
end $$;
revoke execute on function public.push_post(jsonb, jsonb) from public, anon, authenticated;

-- Персоналу. p_user: только этому сотруднику (для теста).
create or replace function public.push_send(p_payload jsonb, p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_subs jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]')
    into v_subs
  from public.push_subscriptions s join public.profiles pr on pr.id = s.user_id
  where pr.role in ('staff', 'admin') and (p_user is null or s.user_id = p_user);
  return public.push_post(p_payload, v_subs);
exception when others then
  raise warning 'push_send: %', sqlerrm;
  return 0;
end $$;
revoke execute on function public.push_send(jsonb, uuid) from public, anon, authenticated;

-- Текст уведомления о заказе
create or replace function public.push_order_event(p_order uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.settings; v_items text; v_when text; v_title text; v_body text;
begin
  select * into o from public.orders where id = p_order;
  if not found then return; end if;
  select * into s from public.settings where id = 1;
  select string_agg(i.name || coalesce(' ' || nullif(split_part(i.size, ' ', 1), ''), '') || case when i.qty > 1 then ' ×' || i.qty else '' end, ', ' order by i.id)
    into v_items from public.order_items i where i.order_id = o.id;
  v_when := case when o.asap then 'как можно скорее' else 'к ' || to_char(o.ready_at at time zone s.timezone, 'HH24:MI') end;
  if p_kind = 'cancelled' then
    v_title := 'Гость отменил заказ №' || o.number;
    v_body  := coalesce(v_items, '');
  else
    v_title := 'Новый заказ №' || o.number || ' · ' || replace(to_char(o.total, 'FM999,999,990'), ',', ' ') || ' ₸';
    v_body  := left(coalesce(v_items, ''), 140) || ' · ' || v_when
               || case when o.to_partner then ' · к партнёру ' || coalesce(o.partner_name, '')
                       when o.fulfillment = 'delivery' then ' · доставка' else '' end
               || ' · ' || o.customer_name;
  end if;
  perform public.push_send(jsonb_build_object('type', p_kind, 'title', v_title, 'body', v_body,
            'tag', 'order-' || o.id, 'url', './#admin', 'order', o.id, 'number', o.number), null);
exception when others then
  raise warning 'push_order_event: %', sqlerrm;
end $$;
revoke execute on function public.push_order_event(uuid, text) from public, anon, authenticated;

-- Сотрудник включает уведомления на своём телефоне
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Уведомления доступны только персоналу'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Браузер вернул неполную подписку. Обновите страницу и попробуйте ещё раз';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_device, ''), 80))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and (user_id = auth.uid() or public.is_admin());
$$;

-- Состояние для панели: настроен ли сервер и сколько устройств подписано
create or replace function public.push_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  return jsonb_build_object(
    'configured', exists (select 1 from public.push_config where id = 1) and to_regnamespace('net') is not null,
    'pg_net', to_regnamespace('net') is not null,
    'mine', (select count(*) from public.push_subscriptions where user_id = auth.uid()),
    'team', case when public.is_admin() then (
      select coalesce(jsonb_agg(jsonb_build_object('who', coalesce(nullif(pr.name, ''), pr.email), 'device', s.device, 'since', s.created_at) order by s.created_at desc), '[]')
      from public.push_subscriptions s join public.profiles pr on pr.id = s.user_id where pr.role in ('staff', 'admin')) end);
end $$;

-- Тест: уведомление только на устройства текущего сотрудника
create or replace function public.push_test() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  if not exists (select 1 from public.push_config where id = 1) then
    raise exception 'Сервер уведомлений не подключён. Выполните в Supabase команду set_push_config из вывода deploy.sh';
  end if;
  if to_regnamespace('net') is null then raise exception 'В Supabase не включено расширение pg_net. Выполните schema.sql ещё раз'; end if;
  n := public.push_send(jsonb_build_object('type', 'test', 'title', 'Kese Coffee: уведомления работают',
         'body', 'Так будут приходить новые заказы', 'tag', 'test', 'url', './#admin'), auth.uid());
  if n = 0 then raise exception 'На этом аккаунте нет подписанных устройств. Нажмите «Включить на этом устройстве»'; end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Push-уведомления гостю о его заказе: «принят», «счёт в Kaspi»,
--  «готов», «курьер выехал», «отменён». Гость нажимает «Сообщить,
--  когда будет готов» на странице заказа; подписка живёт, пока заказ
--  не выдан или не отменён. Работает через тот же сервер /push/order.
-- ---------------------------------------------------------------------
create table if not exists public.order_push (
  order_id   uuid not null references public.orders(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  primary key (order_id, endpoint)
);
alter table public.order_push enable row level security;
revoke all on public.order_push from anon, authenticated;

-- Гость подписывает свой телефон на заказ (по токену заказа или из своего аккаунта).
-- configured = false: сервер уведомлений не подключён, приложение покажет их само, пока страница открыта.
create or replace function public.order_push_subscribe(p_id uuid, p_token uuid, p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders
   where id = p_id and (guest_token = p_token or (auth.uid() is not null and user_id = auth.uid()));
  if not found then raise exception 'Заказ не найден'; end if;
  if o.status not in ('new', 'accepted', 'ready', 'on_the_way') then
    return jsonb_build_object('configured', false, 'closed', true);
  end if;
  if not exists (select 1 from public.push_config where id = 1) or to_regnamespace('net') is null then
    return jsonb_build_object('configured', false);
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Браузер вернул неполную подписку. Обновите страницу и попробуйте ещё раз';
  end if;
  delete from public.order_push where created_at < now() - interval '2 days';
  insert into public.order_push (order_id, endpoint, p256dh, auth)
  values (o.id, left(p_endpoint, 1000), left(p_p256dh, 200), left(p_auth, 100))
  on conflict (order_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  -- не больше 5 устройств на один заказ
  delete from public.order_push where order_id = o.id and endpoint not in (
    select endpoint from public.order_push where order_id = o.id order by created_at desc limit 5);
  return jsonb_build_object('configured', true);
end $$;

create or replace function public.order_push_unsubscribe(p_id uuid, p_token uuid, p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.order_push p using public.orders o
   where p.order_id = p_id and p.endpoint = p_endpoint and o.id = p.order_id
     and (o.guest_token = p_token or (auth.uid() is not null and o.user_id = auth.uid()));
$$;

-- Текст уведомления гостю
create or replace function public.push_guest_event(p_order uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.settings; v_subs jsonb; v_title text; v_body text; v_at text; v_urgent boolean := false;
begin
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]')
    into v_subs from public.order_push p where p.order_id = p_order;
  if jsonb_array_length(v_subs) = 0 then return; end if;
  select * into o from public.orders where id = p_order;
  if not found then return; end if;
  select * into s from public.settings where id = 1;
  v_at := case when o.ready_at > now() then (case when o.asap then 'примерно к ' else 'к ' end) || to_char(o.ready_at at time zone s.timezone, 'HH24:MI') end;
  if p_kind = 'accepted' then
    v_title := 'Заказ №' || o.number || ' принят';
    v_body  := 'Готовим' || case when v_at is null then '' when o.to_partner then ', принесём ' || v_at
                                 when o.fulfillment = 'delivery' then ', привезём ' || v_at else ', будет готов ' || v_at end;
  elsif p_kind = 'invoice' then
    v_title := 'Счёт в Kaspi: ' || replace(to_char(o.total, 'FM999,999,990'), ',', ' ') || ' ₸';
    v_body  := 'Откройте Kaspi.kz и оплатите заказ №' || o.number;
  elsif p_kind = 'ready' then
    v_title := 'Заказ №' || o.number || ' готов!';
    v_body  := 'Заберите на стойке' || coalesce(' · ' || nullif(s.address, ''), '');
    v_urgent := true;
  elsif p_kind = 'on_the_way' then
    v_title := case when o.to_partner then 'Несём ваш кофе · заказ №' else 'Курьер выехал · заказ №' end || o.number;
    v_body  := 'Скоро будем: ' || coalesce(nullif(o.delivery_address, ''), 'по вашему адресу');
    v_urgent := true;
  elsif p_kind = 'cancelled' then
    v_title := 'Заказ №' || o.number || ' отменён';
    v_body  := coalesce(nullif(o.cancel_reason, ''), 'Если есть вопросы, напишите нам в WhatsApp');
  else
    return;
  end if;
  perform public.push_post(jsonb_build_object('type', 'guest', 'status', p_kind, 'urgent', v_urgent,
            'title', v_title, 'body', v_body, 'tag', 'order-' || o.id, 'url', './#order/' || o.id), v_subs);
exception when others then
  raise warning 'push_guest_event: %', sqlerrm;
end $$;
revoke execute on function public.push_guest_event(uuid, text) from public, anon, authenticated;

-- Смена статуса или оплаты → уведомление гостю. Отмену самим гостем не присылаем.
create or replace function public.orders_guest_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' then perform public.push_guest_event(new.id, 'accepted');
    elsif new.status = 'ready' and new.fulfillment = 'pickup' then perform public.push_guest_event(new.id, 'ready');
    elsif new.status = 'on_the_way' then perform public.push_guest_event(new.id, 'on_the_way');
    elsif new.status = 'cancelled' and public.is_staff() then perform public.push_guest_event(new.id, 'cancelled');
    end if;
  end if;
  if new.payment_status = 'invoice_sent' and old.payment_status is distinct from 'invoice_sent'
     and new.status not in ('completed', 'cancelled') then
    perform public.push_guest_event(new.id, 'invoice');
  end if;
  if new.status in ('completed', 'cancelled') then delete from public.order_push where order_id = new.id; end if;
  return null;
exception when others then
  raise warning 'orders_guest_push: %', sqlerrm;
  return null;
end $$;
drop trigger if exists orders_guest_push on public.orders;
create trigger orders_guest_push after update of status, payment_status on public.orders
  for each row execute function public.orders_guest_push();

-- Сервер сообщает, какие подписки устарели (телефон сброшен, браузер удалён)
create or replace function public.push_report(p_secret text, p_ok text[] default '{}', p_gone text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if not found or c.secret <> coalesce(p_secret, '') then raise exception 'Нет доступа'; end if;
  delete from public.push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
  delete from public.order_push         where endpoint = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_ok_at = now() where endpoint = any(coalesce(p_ok, '{}'));
end $$;

grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text)      to authenticated;
grant execute on function public.push_status()               to authenticated;
grant execute on function public.push_test()                 to authenticated;
grant execute on function public.push_report(text, text[], text[]) to anon, authenticated;
grant execute on function public.order_push_subscribe(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.order_push_unsubscribe(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_partner(text)           to anon, authenticated;
grant execute on function public.partner_report(date)        to authenticated;
grant execute on function public.partner_stats(uuid, date)   to anon, authenticated;
grant execute on function public.place_order(jsonb)          to anon, authenticated;
revoke execute on function public.counter_order(jsonb) from public, anon;
grant execute on function public.counter_order(jsonb)        to authenticated;
grant execute on function public.get_order(uuid, uuid)       to anon, authenticated;
grant execute on function public.get_guest_orders(jsonb)     to anon, authenticated;
grant execute on function public.cancel_order(uuid, uuid)    to anon, authenticated;
grant execute on function public.claim_orders(jsonb)         to authenticated;
grant execute on function public.set_available(uuid, boolean) to authenticated;
grant execute on function public.set_accepting(boolean)      to authenticated;
grant execute on function public.set_modifier_active(uuid, boolean) to authenticated;
grant execute on function public.list_team()                 to authenticated;
grant execute on function public.set_role(text, text)        to authenticated;
grant execute on function public.is_staff()                  to anon, authenticated;
grant execute on function public.is_admin()                  to anon, authenticated;

-- ---------------------------------------------------------------------
--  Хранилище фото меню (Supabase Storage): видят все, загружает админ
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu', 'menu', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute 'drop policy if exists menu_photos_read on storage.objects';
  execute 'create policy menu_photos_read on storage.objects for select using (bucket_id = ''menu'')';
  execute 'drop policy if exists menu_photos_insert on storage.objects';
  execute 'create policy menu_photos_insert on storage.objects for insert to authenticated with check (bucket_id = ''menu'' and public.is_admin())';
  execute 'drop policy if exists menu_photos_update on storage.objects';
  execute 'create policy menu_photos_update on storage.objects for update to authenticated using (bucket_id = ''menu'' and public.is_admin()) with check (bucket_id = ''menu'' and public.is_admin())';
  execute 'drop policy if exists menu_photos_delete on storage.objects';
  execute 'create policy menu_photos_delete on storage.objects for delete to authenticated using (bucket_id = ''menu'' and public.is_admin())';
end $$;

-- ---------------------------------------------------------------------
--  Живые обновления заказов для панели персонала
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
--  Стартовое меню (только если меню пустое). Потом правится в панели.
-- ---------------------------------------------------------------------
do $$
declare
  c_coffee uuid; c_nocoffee uuid; c_cold uuid; c_food uuid;
  g_milk uuid; g_syrup uuid; g_extra uuid;
  s3 text := '[{"label":"S","volume":"300 мл","price":%s},{"label":"M","volume":"400 мл","price":%s},{"label":"L","volume":"500 мл","price":%s}]';
begin
  if exists (select 1 from public.products) then return; end if;

  insert into public.categories (name, sort) values ('Кофе', 1)    returning id into c_coffee;
  insert into public.categories (name, sort) values ('Не кофе', 2) returning id into c_nocoffee;
  insert into public.categories (name, sort) values ('Холодное', 3) returning id into c_cold;
  insert into public.categories (name, sort) values ('К кофе', 4)  returning id into c_food;

  insert into public.modifier_groups (name, multi, sort) values ('Молоко', false, 1)        returning id into g_milk;
  insert into public.modifier_groups (name, multi, sort) values ('Сироп', false, 2)         returning id into g_syrup;
  insert into public.modifier_groups (name, multi, sort) values ('Дополнительно', true, 3)  returning id into g_extra;

  insert into public.modifiers (group_id, name, price, is_default, sort) values
    (g_milk, 'Обычное', 0, true, 1), (g_milk, 'Овсяное', 300, false, 2),
    (g_milk, 'Миндальное', 300, false, 3), (g_milk, 'Безлактозное', 200, false, 4),
    (g_syrup, 'Без сиропа', 0, true, 1), (g_syrup, 'Ваниль', 200, false, 2),
    (g_syrup, 'Карамель', 200, false, 3), (g_syrup, 'Лесной орех', 200, false, 4),
    (g_syrup, 'Солёная карамель', 200, false, 5),
    (g_extra, 'Доп. шот эспрессо', 300, false, 1), (g_extra, 'Сливки', 200, false, 2);

  insert into public.products (category_id, name, description, price, sizes, modifier_group_ids, sort) values
    (c_coffee, 'Эспрессо', 'Классический вкус и насыщенный аромат, 40 мл', 700, '[]', array[g_extra], 1),
    (c_coffee, 'Американо', 'Эспрессо и горячая вода', null, format(s3, 900, 1100, 1300)::jsonb, array[g_milk, g_syrup, g_extra], 2),
    (c_coffee, 'Капучино', 'Густая молочная пена, эспрессо и нежный вкус', null, format(s3, 1200, 1400, 1600)::jsonb, array[g_milk, g_syrup, g_extra], 3),
    (c_coffee, 'Латте', 'Больше молока, мягкий вкус', null, format(s3, 1300, 1500, 1700)::jsonb, array[g_milk, g_syrup, g_extra], 4),
    (c_coffee, 'Флэт уайт', 'Двойной эспрессо, тонкая пена, 200 мл', 1500, '[]', array[g_milk], 5),
    (c_coffee, 'Раф ванильный', 'Сливки, эспрессо и ванильный сахар', null, format(s3, 1500, 1700, 1900)::jsonb, array[g_syrup], 6),
    (c_nocoffee, 'Какао', 'На молоке', null, format(s3, 1100, 1300, 1500)::jsonb, array[g_milk, g_syrup], 1),
    (c_nocoffee, 'Матча латте', 'Японский зелёный чай с молоком', null, format(s3, 1500, 1700, 1900)::jsonb, array[g_milk, g_syrup], 2),
    (c_nocoffee, 'Чай', 'Чёрный, зелёный или травяной, укажите в комментарии', null, format(s3, 700, 800, 900)::jsonb, '{}', 3),
    (c_cold, 'Айс-латте', 'Эспрессо, молоко, лёд', null, '[{"label":"M","volume":"400 мл","price":1600},{"label":"L","volume":"500 мл","price":1800}]', array[g_milk, g_syrup, g_extra], 1),
    (c_cold, 'Эспрессо-тоник', 'Тоник, лёд и двойной эспрессо', 1700, '[]', '{}', 2),
    (c_cold, 'Лимонад', 'Цитрус и мята', null, '[{"label":"M","volume":"400 мл","price":1300},{"label":"L","volume":"500 мл","price":1500}]', '{}', 3),
    (c_food, 'Круассан', 'Сливочный, печём утром', 900, '[]', '{}', 1),
    (c_food, 'Синнабон', 'Корица и сливочный крем', 1100, '[]', '{}', 2),
    (c_food, 'Чизкейк', 'Нью-Йорк, кусочек', 1400, '[]', '{}', 3),
    (c_food, 'Печенье', 'Шоколадное, большое', 600, '[]', '{}', 4);
end $$;

-- ---------------------------------------------------------------------
--  ПОСЛЕ ПЕРВОГО ВХОДА в приложение сделайте себя администратором:
--  update public.profiles set role = 'admin' where email = 'ваш@email.kz';
-- ---------------------------------------------------------------------
