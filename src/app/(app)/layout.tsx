import { requirePageSession } from "@/lib/auth/session";
import { isDemoAuthEnabled } from "@/lib/auth/demo";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePageSession();
  return (
    <Shell user={{
      displayName: s.user.displayName, initials: s.user.initials, email: s.user.email, jobTitle: s.user.jobTitle, roles: s.roles,
      spaces: s.spaces, demoAuth: isDemoAuthEnabled(),
      can: { connectors: s.permissions.has("connectors.view"), admin: s.permissions.has("admin.view"), investigate: s.permissions.has("investigate") },
    }}>
      {children}
    </Shell>
  );
}
