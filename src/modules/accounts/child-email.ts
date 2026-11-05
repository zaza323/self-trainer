/** الطفل يدخل برمز، ويُحوَّل داخليًا إلى بريد اصطناعي لأن Supabase Auth يتطلب بريدًا. */
const CHILD_EMAIL_DOMAIN = "child.local";
export const childEmailFromCode = (code: string) => `${code.toLowerCase()}@${CHILD_EMAIL_DOMAIN}`;
