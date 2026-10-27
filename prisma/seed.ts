// Seeds spaces, fictional demo people and the demonstration connector, then indexes it.
// Never touches real connectors' records. Safe to run more than once.
import { db } from "../src/lib/db";
import { adoConnectorRow } from "../src/lib/connectors/ado/connector";
import { runSync } from "../src/lib/connectors/sync";

const SPACES = [
  { key: "it-support", name: "IT Support", description: "Service desk and application support: incidents, requests, runbooks." },
  { key: "development", name: "Development", description: "Engineering work items, bugs, wikis and design notes." },
  { key: "hr", name: "HR", description: "HR policies and HR service requests. Cases are visible to HR Operations only.", visibility: "restricted" },
  { key: "finance", name: "Finance", description: "Accounting procedures, month-end close and finance system incidents." },
  { key: "retail", name: "Retail", description: "Store systems and retail operations." },
  { key: "shared-services", name: "Shared Services", description: "Shared service centre requests and incidents." },
  { key: "facilities", name: "Facilities", description: "Car fleet and workplace requests." },
];

const PEOPLE: { email: string; name: string; title: string; dept: string; roles: string; spaces: [string, string][] }[] = [
  { email: "tomas.ferreira@demo.synora", name: "Tomás Ferreira", title: "Support engineer", dept: "App Support – Lab Systems", roles: "support-engineer", spaces: [["it-support", "member"]] },
  { email: "mei.lin.ong@demo.synora", name: "Mei Lin Ong", title: "Developer", dept: "Platform Engineering", roles: "support-engineer,connector-owner", spaces: [["development", "owner"], ["it-support", "member"]] },
  { email: "priya.natarajan@demo.synora", name: "Priya Natarajan", title: "Knowledge manager", dept: "Knowledge Management", roles: "knowledge-manager", spaces: [["it-support", "editor"], ["development", "editor"]] },
  { email: "camille.durand@demo.synora", name: "Camille Durand", title: "HR advisor", dept: "HR Operations", roles: "search-user", spaces: [["hr", "member"]] },
  { email: "lukas.becker@demo.synora", name: "Lukas Becker", title: "Finance analyst", dept: "Group Accounting", roles: "search-user", spaces: [["finance", "member"]] },
  { email: "jordan.blake@demo.synora", name: "Jordan Blake", title: "Service desk analyst", dept: "Service Desk L1", roles: "search-user", spaces: [["it-support", "member"]] },
  { email: "alex.morgan@demo.synora", name: "Alex Morgan", title: "Platform administrator", dept: "Platform Engineering", roles: "administrator", spaces: [["it-support", "owner"]] },
  { email: "sam.okafor@demo.synora", name: "Sam Okafor", title: "Auditor", dept: "Risk & Compliance", roles: "auditor", spaces: [] },
];

const ALIASES: [string, string][] = [["rxcnc", "RxCNC"], ["rx cnc", "RxCNC"], ["rx.net", "Rx.Net"], ["rxnet", "Rx.Net"], ["labex", "LABEX"], ["eolp", "EOLP"], ["ecm", "ECM API"]];

async function main() {
  const spaces = new Map<string, string>();
  for (const s of SPACES) {
    const row = await db.space.upsert({ where: { key: s.key }, update: { name: s.name, description: s.description, visibility: s.visibility ?? "internal" }, create: { ...s, visibility: s.visibility ?? "internal" } });
    spaces.set(s.key, row.id);
  }

  for (const p of PEOPLE) {
    const initials = p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const user = await db.user.upsert({
      where: { email: p.email },
      update: { displayName: p.name, initials, jobTitle: p.title, department: p.dept, roles: p.roles, active: true },
      create: { email: p.email, displayName: p.name, initials, jobTitle: p.title, department: p.dept, roles: p.roles, hdaUsername: p.email.split("@")[0]! },
    });
    await db.spaceMember.deleteMany({ where: { userId: user.id } });
    for (const [key, role] of p.spaces) await db.spaceMember.create({ data: { userId: user.id, spaceId: spaces.get(key)!, role } });
  }

  for (const [alias, application] of ALIASES) await db.applicationAlias.upsert({ where: { alias }, update: { application }, create: { alias, application } });

  let demo = await db.connector.findFirst({ where: { type: "demo" } });
  demo ??= await db.connector.create({ data: { type: "demo", name: "Demonstration data", spaceId: spaces.get("it-support")!, ownerGroup: "Platform Engineering", status: "connected", schedule: "manual" } });

  if (!(await db.connector.findFirst({ where: { type: "hda" } }))) {
    await db.connector.create({ data: {
      type: "hda", name: "HDA Ticketing (QA)", spaceId: spaces.get("it-support")!, ownerGroup: "Service Desk L1", status: "not_configured", schedule: "hourly",
      secretRef: "env:HDA_PASSWORD", config: { baseUrl: process.env.HDA_BASE_URL ?? "", authMode: process.env.HDA_AUTH_MODE ?? "login" },
      statusNote: "Set HDA_USERNAME and HDA_PASSWORD in .env (the same HDA API user as CSAT Pulse), then test the connection. Needs the company VPN.",
    } });
  }

  if (!(await db.connector.findFirst({ where: { type: "ado" } }))) await db.connector.create({ data: adoConnectorRow(spaces.get("development")!) });

  console.log("Indexing the demonstration data (the first run downloads the embedding model, ~120 MB)...");
  const r = await runSync(demo.id, { full: true });
  console.log("Demonstration data indexed:", r);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
