import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // prototype/ is the standalone published artifact (plain browser JS), not part of the app.
    ignores: [".next/**", "node_modules/**", "test-results/**", "next-env.d.ts", "prototype/**", ".models/**"],
  },
];

export default config;
