-- ============================================================================
-- 0017: إغلاق الكتابة المباشرة من المتصفح (مراجعة أمنية بطلب المالك)
--  1) decide_increment: كانت قابلة للاستدعاء من المتصفح بأي هدف وعلم over_cap، فتتجاوز فحص السقف في فعل الخادم.
--     صارت لدور الخدمة فقط، ويمرر فعل الخادم هوية المستخدم من جلسته (p_actor).
--  2) rewards: كان المستخدم يكتب مباشرة (insert/update) عبر RLS، ويستطيع اللاعب تعديل حقول المكافأة (العنوان والمحفز
--     وشروطه) دون تغيير الحالة. سُحبت صلاحيتا الكتابة؛ الإنشاء وتغيير الحالة عبر دالتين لدور الخدمة فقط تطبّقان
--     الشروط نفسها، ولا تغيّران إلا الحالة.
-- growth_increments وpace_baselines وxp_events وevidence_events: قراءة فقط للمستخدم (لا منح كتابة) — تُختبر في tests/rls.
-- ============================================================================

-- هوية الفاعل داخل الدالة كما لو كان هو صاحب الطلب: الحراس والسياسات تقرأ auth.uid() (محلي للمعاملة)
create or replace function app.act_as(p_actor uuid) returns void language plpgsql as $$
begin
  if p_actor is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
end;
$$;
revoke all on function app.act_as(uuid) from public;

-- 1) decide_increment لدور الخدمة فقط
drop function if exists public.decide_increment(uuid, text, numeric, boolean, boolean);
drop function if exists app.decide_increment(uuid, text, numeric, boolean, boolean);
create or replace function app.decide_increment(p_actor uuid, p_id uuid, p_decision text, p_target numeric default null, p_over_cap boolean default false, p_discovery boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare g public.growth_increments%rowtype;
begin
  perform app.act_as(p_actor);
  select * into g from public.growth_increments where id = p_id;
  if not found then raise exception 'not_found' using errcode = '23514'; end if;
  if g.status <> 'proposed' then raise exception 'already_decided' using errcode = '23514'; end if;
  if p_decision not in ('accepted', 'edited', 'declined') then raise exception 'bad_decision' using errcode = '23514'; end if;
  if g.requires_guardian then
    if not app.has_permission(g.profile_id, 'manage_settings') then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not app.is_profile_owner(g.profile_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  update public.growth_increments
     set status = p_decision,
         target_value = case when p_decision = 'edited' and p_target is not null then p_target else target_value end,
         over_cap = (p_decision <> 'declined') and coalesce(p_over_cap, false),
         discovery = coalesce(p_discovery, false),
         decided_by = p_actor, decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function app.decide_increment(uuid, uuid, text, numeric, boolean, boolean) from public, authenticated, anon;
grant execute on function app.decide_increment(uuid, uuid, text, numeric, boolean, boolean) to service_role;
create or replace function public.decide_increment(p_actor uuid, p_id uuid, p_decision text, p_target numeric default null, p_over_cap boolean default false, p_discovery boolean default false) returns void
language sql security definer set search_path = public as $$ select app.decide_increment(p_actor, p_id, p_decision, p_target, p_over_cap, p_discovery); $$;
revoke all on function public.decide_increment(uuid, uuid, text, numeric, boolean, boolean) from public, authenticated, anon;
grant execute on function public.decide_increment(uuid, uuid, text, numeric, boolean, boolean) to service_role;

-- 2) rewards: لا كتابة مباشرة للمستخدم
drop policy if exists "rewards insert" on public.rewards;
drop policy if exists "rewards update" on public.rewards;
revoke insert, update, delete on public.rewards from authenticated, anon;

-- الإنشاء: نفس شرط السياسة السابقة (مربٍ صاحب add_rewards صراحة، أو البالغ لنفسه)؛ الحارس rewards_guard يتحقق من المحفز والحد
create or replace function app.reward_create(p_actor uuid, p_profile_id uuid, p_title text, p_description text, p_icon text, p_trigger_type text, p_trigger_params jsonb, p_status text default 'draft')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.act_as(p_actor);
  if not (app.guardian_has_permission(p_profile_id, 'add_rewards') or (app.is_profile_owner(p_profile_id) and app.profile_age_mode(p_profile_id) = 'adult')) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'active') then raise exception 'bad_status' using errcode = '23514'; end if;
  insert into public.rewards (profile_id, created_by, title, description, icon, trigger_type, trigger_params, status)
  values (p_profile_id, p_actor, p_title, p_description, coalesce(nullif(p_icon, ''), '🎁'), p_trigger_type, coalesce(p_trigger_params, '{}'::jsonb), p_status::public.reward_status)
  returning id into v_id;
  return v_id;
end;
$$;

-- تغيير الحالة فقط: نفس شرط السياسة السابقة؛ الحارس يفرض الانتقالات المسموحة و«المتدرب يؤكد الاستلام فقط»
create or replace function app.reward_transition(p_actor uuid, p_id uuid, p_to text)
returns table (id uuid, profile_id uuid, title text) language plpgsql security definer set search_path = public as $$
declare r public.rewards%rowtype;
begin
  perform app.act_as(p_actor);
  select * into r from public.rewards w where w.id = p_id;
  if not found then raise exception 'not_permitted' using errcode = '42501'; end if;
  if not (app.has_permission(r.profile_id, 'add_rewards') or app.is_profile_owner(r.profile_id)) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  update public.rewards w set status = p_to::public.reward_status where w.id = p_id;
  return query select r.id, r.profile_id, r.title;
end;
$$;

revoke all on function app.reward_create(uuid, uuid, text, text, text, text, jsonb, text) from public, authenticated, anon;
revoke all on function app.reward_transition(uuid, uuid, text) from public, authenticated, anon;
grant execute on function app.reward_create(uuid, uuid, text, text, text, text, jsonb, text) to service_role;
grant execute on function app.reward_transition(uuid, uuid, text) to service_role;
create or replace function public.reward_create(p_actor uuid, p_profile_id uuid, p_title text, p_description text, p_icon text, p_trigger_type text, p_trigger_params jsonb, p_status text default 'draft')
returns uuid language sql security definer set search_path = public as $$ select app.reward_create(p_actor, p_profile_id, p_title, p_description, p_icon, p_trigger_type, p_trigger_params, p_status); $$;
create or replace function public.reward_transition(p_actor uuid, p_id uuid, p_to text)
returns table (id uuid, profile_id uuid, title text) language sql security definer set search_path = public as $$ select * from app.reward_transition(p_actor, p_id, p_to); $$;
revoke all on function public.reward_create(uuid, uuid, text, text, text, text, jsonb, text) from public, authenticated, anon;
revoke all on function public.reward_transition(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.reward_create(uuid, uuid, text, text, text, text, jsonb, text) to service_role;
grant execute on function public.reward_transition(uuid, uuid, text) to service_role;
