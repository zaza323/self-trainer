import { ChildLoginForm } from "@/shared/ui/forms/auth-forms";
import explainers from "@content/explainers.ar.json";
export default function ChildLoginPage() {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4"><ChildLoginForm explainer={explainers.child_login_explainer} /></main>;
}
