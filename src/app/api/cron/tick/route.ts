import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/db/admin";
import { tick } from "@/modules/notifications/service";
import { webPushSender } from "@/modules/notifications/sender";
import { runAdaptationTick } from "@/modules/adaptation/service";
import { anthropicCaller } from "@/modules/companion";
import { tickChallenges } from "@/modules/challenges";
import { tickTrial } from "@/modules/trial/service";
import { runMarginReviewTick } from "@/modules/margins/service";
import { customization } from "@/shared/config";

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
  const marginReview = await runMarginReviewTick(admin, new Date(), customization.adaptation.run_every_days); // 0.5 ب.7: مراجعة الهامش بالقواعد
  return NextResponse.json({ ok: true, ...result, adaptation, challenges, trial: trialTick, margin_review: marginReview });
}
export const GET = run;
export const POST = run;
