import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/db/admin";
import { tick } from "@/modules/notifications/service";
import { webPushSender } from "@/modules/notifications/sender";
import { runAdaptationTick } from "@/modules/adaptation/service";
import { anthropicCaller } from "@/modules/companion";
import { tickChallenges } from "@/modules/challenges";
import { tickTrial } from "@/modules/trial/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * الدورة المجدولة (كل limits.notifications.tick_minutes): تخطيط الإشعارات، التسليم بـWeb Push، الاحتفاظ (8.4).
 * تُستدعى من Vercel Cron (vercel.json) أو pg_cron + pg_net، بسر CRON_SECRET.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const result = await tick(admin, webPushSender());
  // المرحلة 7: المستشار الأسبوعي، انتهاء الاقتراحات، مقاييس القوالب ومسوداتها
  const adaptation = await runAdaptationTick(admin, anthropicCaller());
  const challenges = await tickChallenges(admin); // تعديل 0.3 §2
  const trialTick = await tickTrial(admin); // المرحلة 8
  return NextResponse.json({ ok: true, ...result, adaptation, challenges, trial: trialTick });
}
export const GET = run;
export const POST = run;
