// ملف مخالف عمدًا: خارج قائمة المنسّقين ويستورد الطبقة ويستدعي runFunction (لا يُستورد في التطبيق).
import { runFunction } from "@/modules/companion/runtime";
export const go = (a: Parameters<typeof runFunction>[0]) => runFunction(a);
