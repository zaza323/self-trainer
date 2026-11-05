-- ============================================================================
-- المرحلة 0: الأساس التقني
-- الحسابات، الأوضاع العمرية، روابط المربين والصلاحيات، الموافقات،
-- نظام الإعدادات بالطبقات (settings + settings_catalog + settings_audit)،
-- القدرات والميكانيكيات الثابتة، RLS على كل جدول.
--
-- القيم القابلة للضبط لا تُكتب هنا: settings_catalog و config_meta تُملآن من
-- config/customization.json بواسطة `pnpm config:sync` (scripts/sync-config-to-db.ts).
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- الأنواع
-- ----------------------------------------------------------------------------
create type public.age_mode as enum ('child', 'teen', 'adult');
create type public.profile_kind as enum ('player', 'guardian');
create type public.guardian_relation as enum ('mother', 'father', 'teacher', 'coach', 'mentor', 'partner', 'other');
create type public.link_status as enum ('invited', 'active', 'removed');
create type public.setting_role as enum ('player', 'guardian', 'system');
create type public.audit_source as enum ('manual', 'adaptation_suggestion', 'age_transition');

-- ----------------------------------------------------------------------------
-- الجداول الثابتة (تُملأ من content/ عبر config:sync)
-- ----------------------------------------------------------------------------
create table public.capabilities (
  id text primary key,
  name_ar text not null,
  description_ar text not null
);

create table public.mechanics (
  id text primary key,
  name_ar text not null,
  primary_capability_id text not null references public.capabilities (id)
);

-- كتالوج الإعدادات: نسخة قاعدة البيانات من config/customization.json.catalog
-- يُستخدم في الـtrigger للتحقق (CUST-2) وفي RLS للصلاحيات (CUST-3).
create table public.settings_catalog (
  key text primary key,
  type text not null,
  min numeric,
  max numeric,
  allowed_values jsonb,
  max_items int,
  defaults jsonb not null,            -- { child, teen, adult }
  mission_override boolean not null default false,
  player_editable_in_child boolean not null default false,
  config_version text not null
);

-- قواعد التعديل والقفل لكل وضع (config/customization.json.edit_rules) + الإصدار
create table public.config_meta (
  id int primary key default 1 check (id = 1),
  edit_rules jsonb not null,
  resolution_order jsonb not null,
  config_version text not null,
  synced_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- الملفات الشخصية
-- kind = guardian: حساب مربٍ فقط (بلا وضع عمري). kind = player: متدرب بوضع عمري.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  kind public.profile_kind not null default 'player',
  display_name text not null check (char_length(display_name) between 1 and 60),
  age_mode public.age_mode,
  locale text not null default 'ar',
  timezone text not null default 'Asia/Amman',
  space_theme text,
  incentive_stage smallint not null default 1 check (incentive_stage between 1 and 4),
  game_intensity smallint check (game_intensity between 0 and 100),
  game_intensity_override smallint check (game_intensity_override between 0 and 100),
  login_code text unique,              -- للطفل: اسم دخول يختاره المربي (ACC-3)
  created_by uuid references auth.users (id) on delete set null,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint player_has_age_mode check (kind = 'guardian' or age_mode is not null),
  constraint guardian_has_no_age_mode check (kind = 'player' or age_mode is null),
  constraint child_has_creator check (age_mode is distinct from 'child' or created_by is not null)
);
create index profiles_user_id_idx on public.profiles (user_id);

-- ----------------------------------------------------------------------------
-- روابط المربين (ACC-7, ACC-8)
-- ----------------------------------------------------------------------------
create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  relation public.guardian_relation not null,
  is_creator boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  status public.link_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guardian_id, player_id)
);
create index guardian_links_player_idx on public.guardian_links (player_id, status);

create table public.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  email text,
  code text not null unique default encode(gen_random_bytes(6), 'hex'),
  relation public.guardian_relation not null,
  permissions jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  guardian_id uuid not null references auth.users (id) on delete cascade,
  policy_version text not null,
  accepted_at timestamptz not null default now()
);
create index consents_profile_idx on public.consents (profile_id);

-- ----------------------------------------------------------------------------
-- الإعدادات بالطبقات (4.11.1)
-- ----------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key text not null references public.settings_catalog (key),
  value jsonb not null,
  set_by_user_id uuid references auth.users (id) on delete set null,
  set_by_role public.setting_role not null,
  locked boolean not null default false,
  locked_by_user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (profile_id, key, set_by_role),
  constraint lock_only_by_guardian check (locked = false or set_by_role = 'guardian')
);
create index settings_profile_idx on public.settings (profile_id);

create table public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid,
  actor_role text not null,
  source public.audit_source not null default 'manual',
  config_version text,
  at timestamptz not null default now()
);
create index settings_audit_profile_idx on public.settings_audit (profile_id, at desc);

-- إشعارات (الحد الأدنى للمرحلة 0: إشعار صاحب الحساب بتغييرات المربين، CUST-6)
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

-- سجل تدقيق عام (ADMIN-6 وما يشبهه)
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- دوال مساعدة (تُستخدم في RLS)
-- ----------------------------------------------------------------------------
create or replace function app.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create or replace function app.is_profile_owner(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = auth.uid());
$$;

create or replace function app.profile_age_mode(p_profile_id uuid)
returns public.age_mode language sql stable security definer set search_path = public as $$
  select p.age_mode from public.profiles p where p.id = p_profile_id;
$$;

create or replace function app.is_active_guardian(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_links l
    where l.player_id = p_profile_id and l.guardian_id = auth.uid() and l.status = 'active'
  );
$$;

create or replace function app.is_creator_guardian(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_links l
    where l.player_id = p_profile_id and l.guardian_id = auth.uid() and l.status = 'active' and l.is_creator
  );
$$;

-- صاحب الحساب (4.11.2 / ACC-7): المربي المنشئ في child، والمتدرب نفسه في teen وadult.
create or replace function app.is_account_owner(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when app.profile_age_mode(p_profile_id) = 'child' then app.is_creator_guardian(p_profile_id)
    else app.is_profile_owner(p_profile_id)
  end;
$$;

-- صلاحية مربٍ نشط. صاحب الحساب يملك كل الصلاحيات ضمنًا (ACC-8).
create or replace function app.has_permission(p_profile_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_account_owner(p_profile_id) or exists (
    select 1 from public.guardian_links l
    where l.player_id = p_profile_id and l.guardian_id = auth.uid() and l.status = 'active'
      and coalesce((l.permissions ->> p_permission)::boolean, false)
  );
$$;

-- هل يستطيع المستخدم الحالي كتابة إعداد في الطبقة المعطاة؟ (CUST-3, CUST-4)
create or replace function app.settings_can_write(
  p_profile_id uuid, p_key text, p_role public.setting_role, p_lock boolean
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_mode public.age_mode;
  v_rules jsonb;
  v_cat public.settings_catalog%rowtype;
  v_existing public.settings%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_cat from public.settings_catalog where key = p_key;
  if not found then return false; end if;             -- خارج الكتالوج: مرفوض (CUST-2)
  v_mode := app.profile_age_mode(p_profile_id);
  if v_mode is null then return false; end if;         -- حساب مربٍ فقط: لا إعدادات
  select edit_rules -> v_mode::text into v_rules from public.config_meta where id = 1;
  if v_rules is null then return false; end if;

  if p_role = 'player' then
    if p_lock then return false; end if;
    if not app.is_profile_owner(p_profile_id) then return false; end if;
    if (v_rules ->> 'player') = 'player_editable_keys_only' and not v_cat.player_editable_in_child then
      return false;
    end if;
    -- إعداد مقفل من مربٍ: المتدرب لا يعدّله (CUST-4)
    if exists (select 1 from public.settings s where s.profile_id = p_profile_id and s.key = p_key and s.locked) then
      return false;
    end if;
    return true;
  end if;

  if p_role = 'guardian' then
    if not app.has_permission(p_profile_id, 'manage_settings') then return false; end if;
    -- المنشئ يقفل ضد بقية المربين (CUST-4)
    select * into v_existing from public.settings s
      where s.profile_id = p_profile_id and s.key = p_key and s.set_by_role = 'guardian';
    if found and v_existing.locked and v_existing.locked_by_user_id is distinct from auth.uid()
       and coalesce((v_rules ->> 'creator_can_lock_against_guardians')::boolean, false)
       and exists (select 1 from public.guardian_links l where l.player_id = p_profile_id
                   and l.guardian_id = v_existing.locked_by_user_id and l.is_creator and l.status = 'active') then
      return false;
    end if;
    if p_lock then
      if coalesce((v_rules ->> 'guardian_can_lock')::boolean, false) then return true; end if;
      -- في teen: القفل لإعدادات الأمان فقط (lockable_keys_override)
      if v_rules -> 'lockable_keys_override' ? p_key then return true; end if;
      return false;
    end if;
    return true;
  end if;

  return false; -- طبقة system لا تُكتب من المتصفح أبدًا
end;
$$;

-- ----------------------------------------------------------------------------
-- التحقق من قيمة الإعداد ضد الكتالوج (CUST-2) + تحديث الوقت
-- ----------------------------------------------------------------------------
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

create trigger settings_validate_trg
  before insert or update on public.settings
  for each row execute function app.settings_validate();

-- سجل التدقيق + إشعار صاحب الحساب بتغييرات المربين (CUST-6)
create or replace function app.settings_audit_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
  v_key text := coalesce(new.key, old.key);
  v_role text := coalesce(new.set_by_role::text, old.set_by_role::text);
  v_source public.audit_source := coalesce(nullif(current_setting('app.audit_source', true), '')::public.audit_source, 'manual');
  v_version text := (select config_version from public.config_meta where id = 1);
  v_actor uuid := coalesce(auth.uid(), new.set_by_user_id);
  v_owner_user uuid;
begin
  insert into public.settings_audit (profile_id, key, old_value, new_value, actor_id, actor_role, source, config_version)
  values (
    v_profile, v_key,
    case when tg_op = 'INSERT' then null else jsonb_build_object('value', old.value, 'locked', old.locked) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('value', new.value, 'locked', new.locked) end,
    v_actor, v_role, v_source, v_version
  );

  if v_role = 'guardian' and v_source = 'manual' then
    select user_id into v_owner_user from public.profiles where id = v_profile;
    if v_owner_user is distinct from v_actor then
      insert into public.notifications (profile_id, type, payload)
      values (v_profile, 'settings_changed_by_guardian',
              jsonb_build_object('key', v_key, 'actor_id', v_actor, 'op', tg_op));
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger settings_audit_trg
  after insert or update or delete on public.settings
  for each row execute function app.settings_audit_trg();

-- ----------------------------------------------------------------------------
-- ACC-9: في child لا يُسمح بإزالة آخر مربٍ يملك receive_alerts
-- ----------------------------------------------------------------------------
create or replace function app.guardian_links_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode public.age_mode;
  v_had boolean;
  v_has boolean;
begin
  new.updated_at := now();
  if new.is_creator and new.status = 'removed' then
    raise exception 'creator guardian link cannot be removed' using errcode = '23514';
  end if;
  v_mode := app.profile_age_mode(new.player_id);
  if v_mode = 'child' then
    v_had := old.status = 'active' and coalesce((old.permissions ->> 'receive_alerts')::boolean, false);
    v_has := new.status = 'active' and coalesce((new.permissions ->> 'receive_alerts')::boolean, false);
    if v_had and not v_has then
      if not exists (
        select 1 from public.guardian_links l
        where l.player_id = new.player_id and l.id <> new.id and l.status = 'active'
          and coalesce((l.permissions ->> 'receive_alerts')::boolean, false)
      ) then
        raise exception 'child must keep at least one guardian with receive_alerts' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger guardian_links_guard_trg
  before update on public.guardian_links
  for each row execute function app.guardian_links_guard();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.capabilities enable row level security;
alter table public.mechanics enable row level security;
alter table public.settings_catalog enable row level security;
alter table public.config_meta enable row level security;
alter table public.profiles enable row level security;
alter table public.guardian_links enable row level security;
alter table public.guardian_invites enable row level security;
alter table public.consents enable row level security;
alter table public.settings enable row level security;
alter table public.settings_audit enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- الجداول المرجعية: قراءة للجميع المسجلين
create policy "ref read" on public.capabilities for select to authenticated using (true);
create policy "ref read" on public.mechanics for select to authenticated using (true);
create policy "ref read" on public.settings_catalog for select to authenticated using (true);
create policy "ref read" on public.config_meta for select to authenticated using (true);

-- profiles
create policy "profiles select" on public.profiles for select to authenticated
  using (user_id = auth.uid() or app.is_active_guardian(id) or app.is_admin());

-- إنشاء ملف لنفسك فقط؛ وضع child لا يُنشأ من المتصفح (ACC-3: عبر المربي والخادم)
create policy "profiles insert self" on public.profiles for insert to authenticated
  with check (user_id = auth.uid() and age_mode is distinct from 'child' and created_by is null);

-- تعديل: المالك (إن لم يكن طفلًا) أو المربي المنشئ للطفل
create policy "profiles update" on public.profiles for update to authenticated
  using ((user_id = auth.uid() and age_mode is distinct from 'child') or app.is_creator_guardian(id))
  with check ((user_id = auth.uid() and age_mode is distinct from 'child') or app.is_creator_guardian(id));

-- الحذف: الطفل لا يحذف حسابه (القسم 13)؛ المنشئ أو المالك البالغ/المراهق
create policy "profiles delete" on public.profiles for delete to authenticated
  using ((user_id = auth.uid() and age_mode is distinct from 'child') or app.is_creator_guardian(id));

-- guardian_links
create policy "links select" on public.guardian_links for select to authenticated
  using (guardian_id = auth.uid() or app.is_profile_owner(player_id) or app.is_active_guardian(player_id) or app.is_admin());

-- الإدراج المباشر ممنوع؛ يتم عبر app.accept_guardian_invite أو إنشاء الطفل (security definer)
create policy "links update" on public.guardian_links for update to authenticated
  using (app.has_permission(player_id, 'manage_guardians'))
  with check (app.has_permission(player_id, 'manage_guardians'));

-- guardian_invites
create policy "invites select" on public.guardian_invites for select to authenticated
  using (app.has_permission(player_id, 'manage_guardians') or invited_by = auth.uid());
create policy "invites insert" on public.guardian_invites for insert to authenticated
  with check (app.has_permission(player_id, 'manage_guardians') and invited_by = auth.uid());
create policy "invites delete" on public.guardian_invites for delete to authenticated
  using (app.has_permission(player_id, 'manage_guardians'));

-- consents
create policy "consents select" on public.consents for select to authenticated
  using (guardian_id = auth.uid() or app.is_profile_owner(profile_id) or app.is_admin());
create policy "consents insert" on public.consents for insert to authenticated
  with check (guardian_id = auth.uid() and (app.is_active_guardian(profile_id) or app.is_profile_owner(profile_id)));

-- settings
create policy "settings select" on public.settings for select to authenticated
  using (app.is_profile_owner(profile_id) or app.is_active_guardian(profile_id));
create policy "settings insert" on public.settings for insert to authenticated
  with check (app.settings_can_write(profile_id, key, set_by_role, locked));
create policy "settings update" on public.settings for update to authenticated
  using (app.settings_can_write(profile_id, key, set_by_role, locked))
  with check (app.settings_can_write(profile_id, key, set_by_role, locked));
create policy "settings delete" on public.settings for delete to authenticated
  using (app.settings_can_write(profile_id, key, set_by_role, false));

-- settings_audit: قراءة فقط (الكتابة عبر الـtrigger)
create policy "audit select" on public.settings_audit for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'manage_settings') or app.is_admin());

-- notifications
create policy "notif select" on public.notifications for select to authenticated
  using (app.is_profile_owner(profile_id) or app.is_account_owner(profile_id));
create policy "notif update" on public.notifications for update to authenticated
  using (app.is_profile_owner(profile_id) or app.is_account_owner(profile_id))
  with check (app.is_profile_owner(profile_id) or app.is_account_owner(profile_id));

-- audit_log: المشرف فقط
create policy "audit_log admin" on public.audit_log for select to authenticated using (app.is_admin());

-- ----------------------------------------------------------------------------
-- دوال RPC (security definer) للعمليات المركبة
-- ----------------------------------------------------------------------------

-- إنشاء ملف طفل مع رابط المربي المنشئ والموافقة (ACC-3, 8.2). تُستدعى من الخادم
-- بعد إنشاء مستخدم auth للطفل (service role). المربي = p_guardian_user_id.
create or replace function app.create_child_profile(
  p_child_user_id uuid, p_guardian_user_id uuid, p_display_name text, p_login_code text,
  p_relation public.guardian_relation, p_policy_version text, p_timezone text default 'Asia/Amman'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
  v_all jsonb := '{"view_progress":true,"view_chat":true,"intervene_chat":true,"add_missions":true,"receive_alerts":true,"manage_guardians":true,"add_rewards":true,"manage_settings":true,"approve_suggestions":true}'::jsonb;
begin
  if not exists (select 1 from public.profiles where user_id = p_guardian_user_id) then
    raise exception 'guardian must have a profile' using errcode = '23514';
  end if;
  insert into public.profiles (user_id, kind, display_name, age_mode, timezone, login_code, created_by)
  values (p_child_user_id, 'player', p_display_name, 'child', p_timezone, p_login_code, p_guardian_user_id)
  returning id into v_profile_id;

  insert into public.guardian_links (guardian_id, player_id, relation, is_creator, permissions, status, invited_by)
  values (p_guardian_user_id, v_profile_id, p_relation, true, v_all, 'active', p_guardian_user_id);

  insert into public.consents (profile_id, guardian_id, policy_version)
  values (v_profile_id, p_guardian_user_id, p_policy_version);

  insert into public.audit_log (actor_id, action, target)
  values (p_guardian_user_id, 'child_profile_created', v_profile_id::text);
  return v_profile_id;
end;
$$;
revoke all on function app.create_child_profile(uuid, uuid, text, text, public.guardian_relation, text, text) from public, anon, authenticated;

-- قبول دعوة مربٍ برمز (ACC-7). المستخدم الحالي يصبح مربيًا بالصفة والصلاحيات المحددة في الدعوة.
create or replace function app.accept_guardian_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.guardian_invites%rowtype;
  v_link_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.guardian_invites where code = p_code for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'invite invalid or expired' using errcode = '23514';
  end if;
  if app.is_profile_owner(inv.player_id) then
    raise exception 'cannot be your own guardian' using errcode = '23514';
  end if;
  insert into public.guardian_links (guardian_id, player_id, relation, is_creator, permissions, status, invited_by)
  values (auth.uid(), inv.player_id, inv.relation, false, inv.permissions, 'active', inv.invited_by)
  on conflict (guardian_id, player_id) do update
    set relation = excluded.relation, permissions = excluded.permissions, status = 'active'
  returning id into v_link_id;
  update public.guardian_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  insert into public.audit_log (actor_id, action, target) values (auth.uid(), 'guardian_invite_accepted', v_link_id::text);
  return v_link_id;
end;
$$;
grant execute on function app.accept_guardian_invite(text) to authenticated;

-- تغيير الوضع العمري بقواعد القسم 13 (ACC-11)
--  child → teen : المربون وصلاحياتهم تبقى، الأقفال تُرفع عدا إعدادات الأمان (lockable_keys_override).
--  teen  → adult: كل صلاحيات المربين تعود إلى view_progress فقط.
--  من يستطيع: المربي المنشئ لطفل؛ المتدرب نفسه في teen/adult.
create or replace function app.transition_age_mode(p_profile_id uuid, p_new_mode public.age_mode)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old public.age_mode;
  v_safety jsonb;
  v_view_only jsonb := '{"view_progress":true,"view_chat":false,"intervene_chat":false,"add_missions":false,"receive_alerts":false,"manage_guardians":false,"add_rewards":false,"manage_settings":false,"approve_suggestions":false}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select age_mode into v_old from public.profiles where id = p_profile_id and kind = 'player';
  if not found then raise exception 'player profile not found' using errcode = '23514'; end if;
  if v_old = p_new_mode then return; end if;
  if p_new_mode = 'child' then
    raise exception 'cannot transition into child mode' using errcode = '23514';
  end if;
  if v_old = 'child' then
    if not app.is_creator_guardian(p_profile_id) then raise exception 'only the creator guardian can change a child mode' using errcode = '42501'; end if;
  else
    if not app.is_profile_owner(p_profile_id) then raise exception 'only the player can change their mode' using errcode = '42501'; end if;
  end if;

  perform set_config('app.audit_source', 'age_transition', true);

  if v_old = 'child' and p_new_mode = 'teen' then
    select coalesce(edit_rules -> 'teen' -> 'lockable_keys_override', '[]'::jsonb) into v_safety from public.config_meta where id = 1;
    update public.settings set locked = false, locked_by_user_id = null
      where profile_id = p_profile_id and locked and not (v_safety ? key);
  end if;

  if p_new_mode = 'adult' then
    update public.guardian_links set permissions = v_view_only
      where player_id = p_profile_id and status = 'active';
  end if;

  update public.profiles set age_mode = p_new_mode where id = p_profile_id;
  insert into public.audit_log (actor_id, action, target, meta)
  values (auth.uid(), 'age_mode_transition', p_profile_id::text, jsonb_build_object('from', v_old, 'to', p_new_mode));
end;
$$;
grant execute on function app.transition_age_mode(uuid, public.age_mode) to authenticated;

-- القيمة الفعّالة لإعداد من داخل قاعدة البيانات (مرآة لـ settings.effective في TypeScript).
-- تُستخدم لاحقًا من pg_cron والوظائف المجدولة؛ الواجهة تستخدم النسخة TypeScript.
create or replace function app.setting_effective(p_profile_id uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_mode public.age_mode;
  v_cat public.settings_catalog%rowtype;
  v_rules jsonb;
  v_locked boolean;
  v_val jsonb;
begin
  select * into v_cat from public.settings_catalog where key = p_key;
  if not found then raise exception 'setting key % is not in catalog', p_key using errcode = '23514'; end if;
  v_mode := app.profile_age_mode(p_profile_id);
  select edit_rules -> coalesce(v_mode::text, 'adult') into v_rules from public.config_meta where id = 1;
  select bool_or(locked) into v_locked from public.settings where profile_id = p_profile_id and key = p_key;

  if not coalesce(v_locked, false)
     and ((v_rules ->> 'player') = 'all' or v_cat.player_editable_in_child) then
    select value into v_val from public.settings where profile_id = p_profile_id and key = p_key and set_by_role = 'player';
    if found then return v_val; end if;
  end if;
  select value into v_val from public.settings where profile_id = p_profile_id and key = p_key and set_by_role = 'guardian';
  if found then return v_val; end if;
  select value into v_val from public.settings where profile_id = p_profile_id and key = p_key and set_by_role = 'system';
  if found then return v_val; end if;
  if v_mode is not null and v_cat.defaults ? v_mode::text then return v_cat.defaults -> v_mode::text; end if;
  return v_cat.defaults -> 'adult';
end;
$$;
grant execute on function app.setting_effective(uuid, text) to authenticated;

-- منح الصلاحيات على الدوال المساعدة
grant execute on function app.is_admin(), app.is_profile_owner(uuid), app.profile_age_mode(uuid),
  app.is_active_guardian(uuid), app.is_creator_guardian(uuid), app.is_account_owner(uuid),
  app.has_permission(uuid, text), app.settings_can_write(uuid, text, public.setting_role, boolean)
  to authenticated;

grant select on public.capabilities, public.mechanics, public.settings_catalog, public.config_meta to authenticated;
grant select, insert, update, delete on public.profiles, public.guardian_links, public.guardian_invites,
  public.consents, public.settings, public.notifications to authenticated;
grant select on public.settings_audit, public.audit_log to authenticated;
