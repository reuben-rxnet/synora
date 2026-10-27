import type { Metadata } from "next";
import { db } from "@/lib/db";
import { DEMO_PERSONAS, isDemoAuthEnabled } from "@/lib/auth/demo";
import { isEntraEnabled } from "@/lib/auth/entra-config";
import { signInAsPersona } from "@/server/auth-actions";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "no-access": "Your account has no Synora role yet. Ask IT to assign you a Synora role and a space in Entra ID.",
  "wrong-tenant": "That account belongs to another organization. Sign in with your EssilorLuxottica account.",
  "group-overage": "Your account is in too many groups to read at sign-in. IT needs to send only the groups assigned to Synora.",
  expired: "The sign-in took too long or was opened in another tab. Start again.",
  "entra-unavailable": "Microsoft sign-in can't be reached right now. Try again in a few minutes.",
  "signin-failed": "Microsoft sign-in didn't complete. Try again; if it keeps happening, contact the service desk.",
  persona: "That demo person isn't available. Run npm run db:seed and try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const demo = isDemoAuthEnabled();
  const users = demo ? await db.user.findMany({ where: { email: { in: DEMO_PERSONAS.map((p) => p.email) } }, include: { spaces: { include: { space: true } } } }) : [];

  return (
    <main className="signin">
      <section className="signin-hero" aria-labelledby="brand">
        <div className="row"><Logo size={40} /><b style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", color: "#fff" }}>Synora</b></div>
        <div>
          <p className="tag">Enterprise intelligence, connected.</p>
          <h1 id="brand">One search across tickets, documents, email and work items</h1>
          <p className="lead">Describe an issue in your own words and get a source-backed answer, similar past cases and what fixed them, limited to what you are allowed to see.</p>
        </div>
        <p className="small" style={{ color: "var(--nav-muted)" }}>Internal application · EssilorLuxottica</p>
      </section>
      <section className="signin-panel" aria-labelledby="signin-h">
        <h2 id="signin-h" className="h2">Sign in</h2>
        {error && <div className="callout c-warn" role="alert"><div className="callout-body">{ERRORS[error] ?? "Sign-in didn't complete. Try again."}</div></div>}
        {isEntraEnabled() && <a className="btn btn-primary" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>Sign in with your company account</a>}
        {demo && (
          <>
            <div className="callout c-info" role="note"><div className="callout-body"><strong>Demonstration sign-in</strong><span>Local development only; production uses Microsoft Entra ID and this list can&apos;t be enabled there. Each person sees only their own departments&apos; content.</span></div></div>
            <ul className="persona-grid">
              {DEMO_PERSONAS.map((p) => {
                const u = users.find((x) => x.email === p.email);
                if (!u) return null;
                return (
                  <li key={p.email}>
                    <form action={signInAsPersona}>
                      <input type="hidden" name="email" value={p.email} />
                      <input type="hidden" name="next" value={next} />
                      <button className="persona-card" type="submit">
                        <span className="avatar">{u.initials}</span>
                        <span className="grow"><b>{u.displayName}</b><span className="muted small">{p.blurb}</span><span className="small">{u.spaces.map((s) => s.space.name).join(", ") || "No spaces"}</span></span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {!demo && !isEntraEnabled() && <div className="callout c-bad"><div className="callout-body">No sign-in method is configured. Set AUTH_PROVIDER=entra (or demo for local development).</div></div>}
      </section>
    </main>
  );
}
