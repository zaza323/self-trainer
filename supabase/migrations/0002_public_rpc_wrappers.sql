-- أغلفة في public للدوال المخصصة حتى يصل إليها PostgREST دون كشف schema app.
-- الصلاحيات تطابق الدوال الأصلية.

create or replace function public.create_child_profile(
  p_child_user_id uuid, p_guardian_user_id uuid, p_display_name text, p_login_code text,
  p_relation public.guardian_relation, p_policy_version text, p_timezone text default 'Asia/Amman'
) returns uuid language sql security definer set search_path = public as $$
  select app.create_child_profile(p_child_user_id, p_guardian_user_id, p_display_name, p_login_code, p_relation, p_policy_version, p_timezone);
$$;
revoke all on function public.create_child_profile(uuid, uuid, text, text, public.guardian_relation, text, text) from public, anon, authenticated;
grant execute on function public.create_child_profile(uuid, uuid, text, text, public.guardian_relation, text, text) to service_role;

create or replace function public.accept_guardian_invite(p_code text)
returns uuid language sql security definer set search_path = public as $$
  select app.accept_guardian_invite(p_code);
$$;
grant execute on function public.accept_guardian_invite(text) to authenticated;

create or replace function public.transition_age_mode(p_profile_id uuid, p_new_mode public.age_mode)
returns void language sql security definer set search_path = public as $$
  select app.transition_age_mode(p_profile_id, p_new_mode);
$$;
grant execute on function public.transition_age_mode(uuid, public.age_mode) to authenticated;

create or replace function public.setting_effective(p_profile_id uuid, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select app.setting_effective(p_profile_id, p_key);
$$;
grant execute on function public.setting_effective(uuid, text) to authenticated;
