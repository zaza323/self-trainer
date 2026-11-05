import { AcceptInviteForm } from "@/shared/ui/forms/accept-invite-form";
export default async function InviteCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <main className="mx-auto max-w-md p-4 py-8"><AcceptInviteForm code={code} /></main>;
}
