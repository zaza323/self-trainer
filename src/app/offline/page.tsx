import Link from "next/link";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/offline.ar.json";

/** صفحة السقوط دون اتصال (يقدمها الـService Worker للتنقلات غير المخزنة). */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-xl p-4 py-10">
      <Card>
        <CardHeader><CardTitle>{content.page_title}</CardTitle><CardDescription>{content.page_body}</CardDescription></CardHeader>
        <CardContent className="flex gap-2"><Button asChild><Link href="/app">{content.page_retry}</Link></Button></CardContent>
      </Card>
    </main>
  );
}
