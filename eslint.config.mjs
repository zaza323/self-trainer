import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

// 0.5 RULES-5: الحتمية في المحرك — الوقت والبذرة يُحقنان (القائمة يولّدها ويتحقق منها src/lib/boundary.test.ts)
const engineFiles = JSON.parse(readFileSync(new URL("./src/lib/engine/files.json", import.meta.url), "utf8")).files;
const ENGINE_PURITY = "المحرك حتمي (0.5 RULES-5): مرّر الوقت أو البذرة كمدخل.";

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: engineFiles,
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: ENGINE_PURITY },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: ENGINE_PURITY },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: ENGINE_PURITY },
      ],
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/sw.js", "public/swe-worker-*.js"] },
];

export default eslintConfig;
