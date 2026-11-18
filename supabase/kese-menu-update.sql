-- =====================================================================
--  Kese Coffee: обновление меню под фирменный стиль
--  Выполните в Supabase → SQL Editor. Повторный запуск безопасен.
-- =====================================================================

-- 1. Метка на позициях («Хит», «Новинка»)
alter table public.products add column if not exists badge text not null default '';

-- 2. Фото напитков (файлы лежат на сайте в папке assets/products)
update public.products p
set image_url = 'assets/products/' || v.file || '.jpg'
from (values
  ('Эспрессо', 'espresso'), ('Американо', 'americano'), ('Капучино', 'cappuccino'),
  ('Латте', 'latte'), ('Флэт уайт', 'flatwhite'), ('Раф ванильный', 'raf'), ('Какао', 'cocoa')
) as v(name, file)
where p.name = v.name;

update public.products set badge = 'Хит' where name = 'Эспрессо';

-- 3. Объёмы под ваши стаканы: S 300 мл, M 400 мл, L 500 мл (цены не меняются)
update public.products p
set sizes = (
  select jsonb_agg(
           case e->>'label'
             when 'S' then jsonb_set(e, '{volume}', '"300 мл"')
             when 'M' then jsonb_set(e, '{volume}', '"400 мл"')
             when 'L' then jsonb_set(e, '{volume}', '"500 мл"')
             else e end
           order by t.ord)
  from jsonb_array_elements(p.sizes) with ordinality as t(e, ord))
where jsonb_array_length(p.sizes) > 0;

-- 4. Описания из фирменных карточек
update public.products set description = 'Классический вкус и насыщенный аромат, 40 мл' where name = 'Эспрессо';
update public.products set description = 'Густая молочная пена, эспрессо и нежный вкус' where name = 'Капучино';
update public.products set description = 'Двойной эспрессо, тонкая пена, 200 мл' where name = 'Флэт уайт';
