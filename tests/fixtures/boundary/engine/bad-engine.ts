// ملف مخالف عمدًا لاختبار المدقق (لا يُستورد في التطبيق).
import Anthropic from "@anthropic-ai/sdk";
import { runFunction } from "@/modules/companion/runtime";
export const stamp = () => Date.now();
export const unused = [Anthropic, runFunction];
