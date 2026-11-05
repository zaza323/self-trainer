"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseEnv } from "./env";

export function createClient() {
  const { url, anon } = publicSupabaseEnv();
  return createBrowserClient(url, anon);
}
