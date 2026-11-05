import { NewChildForm } from "@/shared/ui/forms/new-child-form";
import dataPolicy from "@content/data_policy.ar.json";
import explainers from "@content/explainers.ar.json";

/** G01: إنشاء حساب الطفل + الموافقة (ACC-3, 8.2). */
export default function NewChildPage() {
  return <NewChildForm policy={dataPolicy} childExplainers={{ what: explainers.what_is_app.child, ai: explainers.ai_disclosure.child, who: explainers.who_sees_what.child }} />;
}
