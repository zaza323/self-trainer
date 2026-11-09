-- ============================================================================
-- 0018: الصلاحية الحادية عشرة set_task_margin (0.5 ب.2) — لازمة لدمج إعدادات 0.5 (customization.permissions_all).
-- الافتراضي: مفعّلة للمربي المنشئ في child، ومعطلة لغيره ولكل مربٍ في teen/adult، وteen→adult تعود معطلة.
-- منطق الهامش نفسه ونطاق margin_scope في المرحلة 14 (هجرة لاحقة). نُسختا الدالتان من 0013 مع إضافة المفتاح فقط.
-- ============================================================================

create or replace function app.create_child_profile(
  p_child_user_id uuid, p_guardian_user_id uuid, p_display_name text, p_login_code text,
  p_relation public.guardian_relation, p_policy_version text, p_timezone text default 'Asia/Amman'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
  v_all jsonb := '{"view_progress":true,"view_chat":true,"intervene_chat":true,"add_missions":true,"receive_alerts":true,"manage_guardians":true,"add_rewards":true,"manage_settings":true,"approve_suggestions":true,"view_planner":true,"set_task_margin":true}'::jsonb;
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

create or replace function app.transition_age_mode(p_profile_id uuid, p_new_mode public.age_mode)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old public.age_mode;
  v_safety jsonb;
  v_view_only jsonb := '{"view_progress":true,"view_chat":false,"intervene_chat":false,"add_missions":false,"receive_alerts":false,"manage_guardians":false,"add_rewards":false,"manage_settings":false,"approve_suggestions":false,"view_planner":false,"set_task_margin":false}'::jsonb;
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
