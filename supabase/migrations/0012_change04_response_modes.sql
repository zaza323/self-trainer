-- 0.4 الخطوة 1: أنواع إعدادات جديدة (int_or_auto، time_local_or_null، enum_array، moment_windows، list، category_list)،
-- وتطبيق allowed_age_modes في المشغّل، وأعمدة أشكال الرد الذكية للمرافق (الجزء أ).
-- لا قيم هنا: الكتالوج يُملأ من config/customization.json عبر pnpm config:sync.

alter table public.settings_catalog
  add column if not exists item_spec jsonb,
  add column if not exists unknown_required boolean not null default false,
  add column if not exists max_by_age_mode jsonb,
  add column if not exists allowed_age_modes jsonb;

create or replace function app.settings_validate()
returns trigger language plpgsql as $$
declare
  c public.settings_catalog%rowtype;
  v jsonb := new.value;
  t text;
  n numeric;
  elem jsonb;
begin
  select * into c from public.settings_catalog where key = new.key;
  if not found then raise exception 'setting key % is not in catalog', new.key using errcode = '23514'; end if;
  t := jsonb_typeof(v);
  if c.allowed_age_modes is not null and not (c.allowed_age_modes ? coalesce(app.profile_age_mode(new.profile_id)::text, 'adult')) then
    raise exception 'setting % is not available for this age mode', new.key using errcode = '23514';
  end if;

  if c.type in ('int', 'int_or_null') then
    if t = 'null' then
      if c.type = 'int' then raise exception 'setting % cannot be null', new.key using errcode = '23514'; end if;
    elsif t <> 'number' then
      raise exception 'setting % must be a number', new.key using errcode = '23514';
    else
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < c.min or n > c.max then
        raise exception 'setting % out of range [%, %]', new.key, c.min, c.max using errcode = '23514';
      end if;
    end if;
  elsif c.type = 'bool' then
    if t <> 'boolean' then raise exception 'setting % must be boolean', new.key using errcode = '23514'; end if;
  elsif c.type in ('enum', 'enum_or_null') then
    if t = 'null' then
      if c.type = 'enum' then raise exception 'setting % cannot be null', new.key using errcode = '23514'; end if;
    elsif not (c.allowed_values @> jsonb_build_array(v)) then
      raise exception 'setting % value not allowed', new.key using errcode = '23514';
    end if;
  elsif c.type = 'capability_array' then
    if t <> 'array' then raise exception 'setting % must be an array', new.key using errcode = '23514'; end if;
    if jsonb_array_length(v) > c.max_items then raise exception 'setting % exceeds max items', new.key using errcode = '23514'; end if;
    for elem in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(elem) <> 'string' or not exists (select 1 from public.capabilities where id = elem #>> '{}') then
        raise exception 'setting % contains unknown capability', new.key using errcode = '23514';
      end if;
    end loop;
    if (select count(distinct e) from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
      raise exception 'setting % contains duplicates', new.key using errcode = '23514';
    end if;
  elsif c.type = 'time_windows' then
    if t <> 'array' then raise exception 'setting % must be an array', new.key using errcode = '23514'; end if;
    if jsonb_array_length(v) > c.max_items then raise exception 'setting % exceeds max items', new.key using errcode = '23514'; end if;
    for elem in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(elem) <> 'object' or not (elem ? 'from' and elem ? 'to')
         or (elem ->> 'from') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (elem ->> 'to') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'setting % window must be {from:"HH:MM", to:"HH:MM"}', new.key using errcode = '23514';
      end if;
    end loop;
  elsif c.type = 'time_local' then
    if t <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'setting % must be HH:MM', new.key using errcode = '23514';
    end if;
  elsif c.type = 'time_range' then
    if t <> 'array' or jsonb_array_length(v) <> 2
       or (v ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v ->> 1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'setting % must be ["HH:MM","HH:MM"]', new.key using errcode = '23514';
    end if;
  elsif c.type = 'int_or_auto' then
    if t = 'string' then
      if (v #>> '{}') <> 'auto' then raise exception 'setting % must be a number or auto', new.key using errcode = '23514'; end if;
    elsif t <> 'number' then
      raise exception 'setting % must be a number or auto', new.key using errcode = '23514';
    else
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < c.min or (c.max is not null and n > c.max) then
        raise exception 'setting % out of range [%, %]', new.key, c.min, c.max using errcode = '23514';
      end if;
    end if;
  elsif c.type = 'time_local_or_null' then
    if t <> 'null' and (t <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception 'setting % must be HH:MM or null', new.key using errcode = '23514';
    end if;
  elsif c.type = 'enum_array' then
    if t <> 'array' then raise exception 'setting % must be an array', new.key using errcode = '23514'; end if;
    for elem in select * from jsonb_array_elements(v) loop
      if not (c.allowed_values @> jsonb_build_array(elem)) then
        raise exception 'setting % value not allowed', new.key using errcode = '23514';
      end if;
    end loop;
    if (select count(distinct e) from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
      raise exception 'setting % contains duplicates', new.key using errcode = '23514';
    end if;
  elsif c.type = 'moment_windows' then
    if t <> 'object' then raise exception 'setting % must be an object', new.key using errcode = '23514'; end if;
    for elem in select value from jsonb_each(v) loop
      if jsonb_typeof(elem) <> 'array' or jsonb_array_length(elem) <> 2
         or jsonb_typeof(elem -> 0) <> 'string' or jsonb_typeof(elem -> 1) <> 'string' then
        raise exception 'setting % windows must be ["from","to"] pairs', new.key using errcode = '23514';
      end if;
    end loop;
  elsif c.type = 'list' then
    if t <> 'array' then raise exception 'setting % must be an array', new.key using errcode = '23514'; end if;
    if jsonb_array_length(v) > c.max_items then raise exception 'setting % exceeds max items', new.key using errcode = '23514'; end if;
    for elem in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(elem) <> 'object' or exists (
        select 1 from jsonb_each_text(c.item_spec) s
        where case s.value
          when 'int' then jsonb_typeof(elem -> s.key) <> 'number' or (elem ->> s.key)::numeric <> trunc((elem ->> s.key)::numeric) or (elem ->> s.key)::numeric <= 0
          else jsonb_typeof(elem -> s.key) <> 'string' or btrim(elem ->> s.key) = '' end
      ) then
        raise exception 'setting % item does not match its spec', new.key using errcode = '23514';
      end if;
    end loop;
  elsif c.type = 'category_list' then
    if t <> 'array' then raise exception 'setting % must be an array', new.key using errcode = '23514'; end if;
    if jsonb_array_length(v) > c.max_items then raise exception 'setting % exceeds max items', new.key using errcode = '23514'; end if;
    for elem in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(elem) <> 'string' or btrim(elem #>> '{}') = '' then
        raise exception 'setting % contains an invalid category', new.key using errcode = '23514';
      end if;
    end loop;
    if (select count(distinct e) from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
      raise exception 'setting % contains duplicates', new.key using errcode = '23514';
    end if;
    if c.unknown_required and not (v @> '["unknown"]'::jsonb) then
      raise exception 'setting % must include unknown', new.key using errcode = '23514';
    end if;
  else
    raise exception 'unknown catalog type % for %', c.type, new.key using errcode = '23514';
  end if;

  if new.locked and new.locked_by_user_id is null then new.locked_by_user_id := auth.uid(); end if;
  if not new.locked then new.locked_by_user_id := null; end if;
  if new.set_by_user_id is null then new.set_by_user_id := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;

-- أشكال الرد (أ.7): كل رسالة تحمل لحظتها وشكل الرد وخياراتها، وردّ المستخدم يسجّل طريقة الإدخال.
alter table public.companion_messages
  add column if not exists moment text,
  add column if not exists response_mode text check (response_mode in ('quick_replies', 'choices_plus_other', 'free_text')),
  add column if not exists options jsonb,
  add column if not exists chosen_option_id text,
  add column if not exists input_method text check (input_method in ('typed', 'voice', 'option'));

-- ميزانية الكتابة (أ.4) لكل جلسة: السقف المحسوب عند فتح الجلسة والمستهلَك حتى الآن.
alter table public.companion_sessions
  add column if not exists free_text_budget int,
  add column if not exists free_text_used int not null default 0,
  add column if not exists stuck_pending boolean not null default false;

-- سجل استبدال الشكل (أ.7): ما اقترحه النموذج وما فرضته السياسة.
alter table public.ai_calls add column if not exists meta jsonb;
