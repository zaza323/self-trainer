import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
  "@": path.resolve(__dirname, "src"),
  "@tests": path.resolve(__dirname, "tests"),
  "@config": path.resolve(__dirname, "config"),
  "@content": path.resolve(__dirname, "content"),
};

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias },
  test: {
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        esbuild: { jsx: "automatic" },
        test: { name: "unit", include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "rls",
          include: ["tests/rls/**/*.test.ts"],
          environment: "node",
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
