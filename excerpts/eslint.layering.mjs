// Portfolio excerpt from ATALEF (eslint.config.mjs) — the layering contract.

  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "var/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  {
    // Layering contract (docs/architecture/11 §11.2): domain is framework-free;
    // Prisma/DB access only inside src/server.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@prisma/client", "@prisma/*", "next", "next/*", "react", "react/*", "@/src/server/*", "**/server/**", "@/app/*"],
              message: "src/domain must stay pure: no Prisma, Next, React, or server imports." },
          ],
        },
      ],
    },
  },
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "src/ui/**/*.tsx", "src/ui/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@prisma/client", "@/src/server/db", "@/src/server/db/*"],
              message: "No database access in presentation code; call a service." },
          ],
        },
      ],
    },
  },
  {
