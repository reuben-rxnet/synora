"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/access";
import { assertPermission, requireSession } from "@/lib/auth/session";

export async function setUserRoles(form: FormData) {
  const s = await requireSession();
  assertPermission(s, "admin.manage");
  const userId = String(form.get("userId"));
  const role = String(form.get("role"));
  if (!(ROLES as readonly string[]).includes(role)) return;
  // An administrator can't remove their own administrator role and lock everyone out.
  if (userId === s.user.id && role !== "administrator") return;
  await db.user.update({ where: { id: userId }, data: { roles: role } });
  await db.auditEvent.create({ data: { actorId: s.user.id, action: "user.roles", target: userId, detail: { role } } });
  revalidatePath("/admin");
}

export async function setSpaceMembership(form: FormData) {
  const s = await requireSession();
  assertPermission(s, "admin.manage");
  const spaceId = String(form.get("spaceId"));
  const userId = String(form.get("userId"));
  const role = String(form.get("role"));
  if (role === "remove") await db.spaceMember.deleteMany({ where: { spaceId, userId } });
  else if (["member", "editor", "owner"].includes(role)) await db.spaceMember.upsert({ where: { spaceId_userId: { spaceId, userId } }, update: { role }, create: { spaceId, userId, role } });
  else return;
  await db.auditEvent.create({ data: { actorId: s.user.id, action: "space.membership", target: spaceId, detail: { userId, role } } });
  revalidatePath("/admin");
}
