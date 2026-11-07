-- ============================================================================
-- 0016: سقف الزيادة على مرحلتين (تعديل بطلب المالك بعد 0.4 ح.4)
-- فترة اكتشاف بلا سقف، ثم سقف ناعم يُتجاوز بتأكيد (أو ثابت للطفل حسب pace_cap_mode).
-- الهدف المتجاوز للسقف وغير المحقق يُسجَّل كمعلومة (noted) لا كرجوع.
-- القيم كلها في config/planner.json.pace.cap؛ الإنفاذ في فعل الخادم، وهنا الأعمدة والحالة الجديدة فقط.
-- ============================================================================

alter table public.growth_increments
  add column if not exists over_cap boolean not null default false,       -- الهدف المختار تجاوز السقف الناعم بتأكيد المستخدم
  add column if not exists discovery boolean not null default false,      -- قُرّر خلال فترة الاكتشاف (بلا سقف)
  add column if not exists achieved_ratio numeric,                        -- نسبة أيام التحقيق في نافذة الزيادة
  add column if not exists achieved_value numeric,                        -- متوسط المحقق في النافذة (لتسجيل الفرق)
  add column if not exists gap numeric;                                   -- الهدف − المحقق (معلومة)

alter table public.growth_increments drop constraint if exists growth_increments_status_check;
alter table public.growth_increments add constraint growth_increments_status_check
  check (status in ('proposed', 'accepted', 'edited', 'declined', 'achieved', 'held', 'stepped_back', 'noted'));

-- قرار الزيادة مع علمي السقف والاكتشاف (يحددهما الخادم من config؛ RPC تحفظهما مع القرار)
drop function if exists public.decide_increment(uuid, text, numeric);
drop function if exists app.decide_increment(uuid, text, numeric);
create or replace function app.decide_increment(p_id uuid, p_decision text, p_target numeric default null, p_over_cap boolean default false, p_discovery boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare g public.growth_increments%rowtype;
begin
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
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
grant execute on function app.decide_increment(uuid, text, numeric, boolean, boolean) to authenticated;
create or replace function public.decide_increment(p_id uuid, p_decision text, p_target numeric default null, p_over_cap boolean default false, p_discovery boolean default false) returns void
language sql security definer set search_path = public as $$ select app.decide_increment(p_id, p_decision, p_target, p_over_cap, p_discovery); $$;
grant execute on function public.decide_increment(uuid, text, numeric, boolean, boolean) to authenticated;
