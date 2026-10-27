// Demo authentication — LOCAL DEVELOPMENT ONLY. Production identity is Microsoft Entra ID.

export const SESSION_COOKIE = "synora_session";

/** Refused in production builds regardless of configuration, so a copied .env can't switch it on. */
export function isDemoAuthEnabled(env: { NODE_ENV?: string; AUTH_PROVIDER?: string } = process.env): boolean {
  return env.AUTH_PROVIDER === "demo" && env.NODE_ENV !== "production";
}

/** Fictional people, one per department, so permission trimming can be seen by switching persona. */
export const DEMO_PERSONAS = [
  { email: "tomas.ferreira@demo.synora", blurb: "Support engineer, Lab Systems (IT Support)" },
  { email: "mei.lin.ong@demo.synora", blurb: "Developer, Lab Platforms (Development + IT Support)" },
  { email: "priya.natarajan@demo.synora", blurb: "Knowledge manager (IT Support, Development)" },
  { email: "camille.durand@demo.synora", blurb: "HR advisor (HR)" },
  { email: "lukas.becker@demo.synora", blurb: "Finance analyst (Finance)" },
  { email: "jordan.blake@demo.synora", blurb: "Service desk analyst (IT Support, read only)" },
  { email: "alex.morgan@demo.synora", blurb: "Platform administrator (configures everything, sees IT content only)" },
  { email: "sam.okafor@demo.synora", blurb: "Auditor (audit log and usage, no department content)" },
] as const;
