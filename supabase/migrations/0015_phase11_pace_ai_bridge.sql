-- المرحلة 11 (0.4): الوتيرة الشخصية والزيادة (ح)، الجسر بين المخطط والتدريب (ب.11)، اقتراح أسبوع المرآة (ط.2)، G14/G15.
-- الحسابات حتمية في TypeScript؛ هنا التخزين وRLS وقاعدة واحدة في قاعدة البيانات: إنجاز مهمة التدريب يُنجز المهمة الحقيقية.

create table public.pace_baselines (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  metric text not null,
  week_start date not null,
  baseline numeric not null,
  sample_days int not null,
  computed_at timestamptz not null default now(),
  primary key (profile_id, metric, week_start)
);

create table public.growth_increments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  kind text not null check (kind in ('more', 'longer', 'harder', 'new_habit', 'consolidate', 'hold', 'reallocate')),
  metric text,
  from_value numeric,
  target_value numeric,
  description text,                 -- نص بكلمات المستخدم (reallocate/new_habit) أو صياغة الاقتراح
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'edited', 'declined', 'achieved', 'held', 'stepped_back')),
  achieved_days int,
  window_days int,
  requires_guardian boolean not null default false,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index growth_increments_profile_idx on public.growth_increments (profile_id, status, week_start desc);

create table public.mirror_suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('low_follow_through', 'repeated_shortfall', 'monthly', 'follow_up')),
  follow_up_of uuid references public.mirror_reports (id) on delete cascade,   -- ط.6-5: مرآة المتابعة لمرآة سابقة
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.mirror_reports add column if not exists follow_up_of uuid references public.mirror_reports (id) on delete set null;
alter table public.mirror_reports add column if not exists goal_answer text;   -- ط.6-4: جواب فحص الغايات (R3)

-- RLS
alter table public.pace_baselines enable row level security;
alter table public.growth_increments enable row level security;
alter table public.mirror_suggestions enable row level security;
create policy "pace read" on public.pace_baselines for select to authenticated using (app.can_view_planner(profile_id));
create policy "increments read" on public.growth_increments for select to authenticated using (app.can_view_planner(profile_id) or app.has_permission(profile_id, 'manage_settings'));
create policy "mirror_suggestions owner" on public.mirror_suggestions for select to authenticated using (app.is_profile_owner(profile_id));
grant select on public.pace_baselines, public.growth_increments, public.mirror_suggestions to authenticated;

-- ح.5: القرار على الزيادة. child مع increments_require_guardian ⇒ المربي صاحب manage_settings وحده؛ غيره المالك.
create or replace function app.decide_increment(p_id uuid, p_decision text, p_target numeric default null) returns void
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
     set status = p_decision, target_value = case when p_decision = 'edited' and p_target is not null then p_target else target_value end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
grant execute on function app.decide_increment(uuid, text, numeric) to authenticated;
create or replace function public.decide_increment(p_id uuid, p_decision text, p_target numeric default null) returns void language sql security definer set search_path = public as $$ select app.decide_increment(p_id, p_decision, p_target); $$;
grant execute on function public.decide_increment(uuid, text, numeric) to authenticated;

-- ط.2: قرار المتدرب على اقتراح أسبوع المرآة
create or replace function app.decide_mirror_suggestion(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.mirror_suggestions set status = case when p_accept then 'accepted' else 'rejected' end, decided_at = now()
   where id = p_id and status = 'pending' and app.is_profile_owner(profile_id);
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end;
$$;
grant execute on function app.decide_mirror_suggestion(uuid, boolean) to authenticated;
create or replace function public.decide_mirror_suggestion(p_id uuid, p_accept boolean) returns void language sql security definer set search_path = public as $$ select app.decide_mirror_suggestion(p_id, p_accept); $$;
grant execute on function public.decide_mirror_suggestion(uuid, boolean) to authenticated;

-- ب.11: إنجاز مهمة التدريب المرتبطة يُنجز المهمة الحقيقية (completing_mission_completes_task)
create or replace function app.mission_completes_planner_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.planner_task_id is not null and new.status in ('completed', 'reflected', 'transferred') and old.status is distinct from new.status
     and old.status not in ('completed', 'reflected', 'transferred') then
    update public.planner_tasks set status = 'done', completed_at = coalesce(new.completed_at, now()),
      actual_min = coalesce(actual_min, new.actual_duration_min)
     where id = new.planner_task_id and status = 'open';
  end if;
  return new;
end;
$$;
create trigger missions_complete_planner_task after update of status on public.missions for each row execute function app.mission_completes_planner_task();

-- مصدر مهمة التدريب المحوّلة من المخطط
alter type public.mission_source add value if not exists 'planner';
