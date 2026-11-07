import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { anthropicCaller, getOrCreateSession, handlePlayerMessage } from "@/modules/companion";
import { buildChatContext } from "@/modules/companion/context";
import type { AgeMode } from "@/shared/config";

/** AI-1 / 7.5: المحادثة الحرة بتدفق (SSE). الأحداث: delta (نص)، final (النص النهائي والنوع)، error. */
export async function POST(request: Request) {
  const body = z.object({ text: z.string().trim().min(1).max(2000), mode: z.enum(["free", "comeback", "daily_moment", "mirror", "weekly_review"]).default("free") }).safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response("bad request", { status: 400 });
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return new Response("unauthorized", { status: 401 });
  const db = await createClient();
  const sess = await getOrCreateSession(db, s.profile.id, body.data.mode);
  const { data: m, error } = await db.from("companion_messages").insert({ session_id: sess.id, role: "player", author_id: s.userId, content: body.data.text }).select("id").single();
  if (error || !m) return new Response("forbidden", { status: 403 });
  const admin = createAdminClient();
  const ctx = await buildChatContext(admin, { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: string, data: unknown) => controller.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const r = await handlePlayerMessage(admin, anthropicCaller(), ctx, sess.id, m.id as string, body.data.text, (t) => send("delta", { text: t }));
        send("final", { kind: r.kind, text: "text" in r ? r.text : "", sessionId: sess.id });
      } catch (e) {
        send("error", { message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
