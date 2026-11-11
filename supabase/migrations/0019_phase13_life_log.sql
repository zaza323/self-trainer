-- ============================================================================
-- 0019 — المرحلة 13 (0.5 الجزء أ): المرافق يبدأ من حياة الشخص.
-- «سجل حياتي» (توسيع personal_context)، رحلة التعارف، life_binding للقوالب، ومصدر كل متغير سيناريو (variables_provenance).
-- (CHANGE-0.5 سمّاها 0017؛ الترقيم الفعلي في docs/CONFIG-MERGE-0.5.md.)
-- ============================================================================

-- أ.2/أ.8: الحقول الأربعة الجديدة عناصرها { id, text, source, confirmed_at, last_confirmed_at, archived }
alter table public.personal_context
  add column if not exists roles jsonb not null default '[]'::jsonb,
  add column if not exists responsibilities jsonb not null default '[]'::jsonb,
  add column if not exists dependents jsonb not null default '[]'::jsonb,
  add column if not exists pressures jsonb not null default '[]'::jsonb,
  add column if not exists intake_status text not null default 'not_started' check (intake_status in ('not_started', 'partial', 'done', 'skipped')),
  add column if not exists intake_step int not null default 0,
  add column if not exists intake_followups_used int not null default 0,
  add column if not exists intake_completed_at timestamptz,
  add column if not exists intake_skipped_at timestamptz,
  add column if not exists last_refresh_at timestamptz;

alter table public.context_suggestions drop constraint if exists context_suggestions_field_check;
alter table public.context_suggestions add constraint context_suggestions_field_check
  check (field in ('interests', 'routine', 'free_windows', 'contexts', 'roles', 'responsibilities', 'dependents', 'pressures'));

-- أ.7 الخصوصية: المالك؛ في child المربي صاحب manage_settings؛ في teen/adult المربي فقط عند share_life_log_with_guardians = true
create or replace function app.can_view_life_log(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_profile_owner(p_profile_id) or app.is_admin()
    or (app.profile_age_mode(p_profile_id) = 'child' and app.has_permission(p_profile_id, 'manage_settings'))
    or (app.profile_age_mode(p_profile_id) in ('teen', 'adult') and app.is_active_guardian(p_profile_id)
        and app.setting_effective(p_profile_id, 'share_life_log_with_guardians') = 'true'::jsonb);
$$;
grant execute on function app.can_view_life_log(uuid) to authenticated;

drop policy if exists "pc select" on public.personal_context;
create policy "pc select" on public.personal_context for select to authenticated using (app.can_view_life_log(profile_id));
drop policy if exists "context_suggestions select" on public.context_suggestions;
create policy "context_suggestions select" on public.context_suggestions for select to authenticated
  using (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.has_permission(profile_id, 'manage_settings')));

-- عند عدم المشاركة يرى المربي النشط عدد العناصر لكل حقل فقط (بلا نصوص)
create or replace function app.life_log_counts(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.personal_context%rowtype;
begin
  if not (app.is_profile_owner(p_profile_id) or app.is_active_guardian(p_profile_id) or app.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.personal_context where profile_id = p_profile_id;
  if not found then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'roles', (select count(*) from jsonb_array_elements(r.roles) e where not coalesce((e ->> 'archived')::boolean, false)),
    'responsibilities', (select count(*) from jsonb_array_elements(r.responsibilities) e where not coalesce((e ->> 'archived')::boolean, false)),
    'dependents', (select count(*) from jsonb_array_elements(r.dependents) e where not coalesce((e ->> 'archived')::boolean, false)),
    'pressures', (select count(*) from jsonb_array_elements(r.pressures) e where not coalesce((e ->> 'archived')::boolean, false)),
    'interests', jsonb_array_length(r.interests), 'routine', jsonb_array_length(r.routine),
    'free_windows', jsonb_array_length(r.free_windows), 'contexts', jsonb_array_length(r.contexts));
end;
$$;
grant execute on function app.life_log_counts(uuid) to authenticated;
create or replace function public.life_log_counts(p_profile_id uuid) returns jsonb language sql stable security definer set search_path = public as $$ select app.life_log_counts(p_profile_id); $$;
grant execute on function public.life_log_counts(uuid) to authenticated;

-- أ.5: ارتباط القالب بحياة المستخدم
alter table public.mission_templates add column if not exists life_binding text not null default 'none' check (life_binding in ('none', 'optional', 'required'));

-- أ.8: مصدر كل متغير سيناريو: [{ name, ref_type (planner_task|life_entry|user_typed), ref_id }]
alter table public.missions add column if not exists variables_provenance jsonb;

/**
 * حارس المصدر: لا كتابة من المتصفح على variables_provenance؛ وكل ref يجب أن يخص صاحب المهمة نفسه
 * (مهمة مخطط له، أو عنصر سجل مؤكَّد غير مؤرشف له، أو نص كتبه الآن)؛ والقالب required لا يُنتج مهمة بلا ref صالح.
 */
create or replace function app.missions_provenance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_binding text; e jsonb; v_ok boolean; v_has boolean := false;
begin
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.variables_provenance is not null)
    or (tg_op = 'UPDATE' and new.variables_provenance is distinct from old.variables_provenance)) then
    raise exception 'variables_provenance is written by the server only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.variables_provenance is not distinct from old.variables_provenance then return new; end if;
  select life_binding into v_binding from public.mission_templates where id = new.template_id and version = new.template_version;
  if new.variables_provenance is not null then
    if jsonb_typeof(new.variables_provenance) <> 'array' then raise exception 'bad_provenance' using errcode = '23514'; end if;
    for e in select * from jsonb_array_elements(new.variables_provenance) loop
      if coalesce(e ->> 'name', '') = '' then raise exception 'bad_provenance: name' using errcode = '23514'; end if;
      if e ->> 'ref_type' = 'planner_task' then
        select exists (select 1 from public.planner_tasks t where t.id = (e ->> 'ref_id')::uuid and t.profile_id = new.profile_id) into v_ok;
      elsif e ->> 'ref_type' = 'life_entry' then
        select exists (
          select 1 from public.personal_context pc,
            lateral jsonb_array_elements(pc.roles || pc.responsibilities || pc.dependents || pc.pressures) it
          where pc.profile_id = new.profile_id and it ->> 'id' = e ->> 'ref_id'
            and it ->> 'confirmed_at' is not null and not coalesce((it ->> 'archived')::boolean, false)) into v_ok;
      elsif e ->> 'ref_type' = 'user_typed' then
        v_ok := (e ->> 'ref_id') is null;
      else v_ok := false;
      end if;
      if not v_ok then raise exception 'provenance_ref_invalid: % %', e ->> 'ref_type', e ->> 'ref_id' using errcode = '23514'; end if;
      v_has := true;
    end loop;
  end if;
  if tg_op = 'INSERT' and v_binding = 'required' and not v_has then
    raise exception 'life_binding_required: scenario variable needs a valid ref' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists missions_provenance_guard_trg on public.missions;
create trigger missions_provenance_guard_trg before insert or update on public.missions for each row execute function app.missions_provenance_guard();
