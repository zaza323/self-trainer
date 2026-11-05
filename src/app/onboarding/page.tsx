import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { OnboardingForm } from "@/shared/ui/forms/onboarding-form";
import explainers from "@content/explainers.ar.json";

/** P01: اختيار الوضع / شرح التطبيق. child لا يُختار هنا (ينشئه المربي من G01). */
export default async function OnboardingPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile) redirect("/");
  return (
    <main className="mx-auto max-w-xl p-4 py-8">
      <OnboardingForm explainers={{ what: explainers.what_is_app, ai: explainers.ai_disclosure, who: explainers.who_sees_what, guardrails: explainers.guardrails_intro, noDiagnosis: explainers.no_diagnosis }} />
    </main>
  );
}
