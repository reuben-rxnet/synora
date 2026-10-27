// Formatting shared by server and client components.
const TYPE_TEXT: Record<string, string> = { incident: "Incident", request: "Request", problem: "Problem", bug: "Bug", work_item: "Work item", document: "Document", email: "Email", chat: "Chat thread", knowledge_article: "Knowledge article" };
export const typeText = (t: string) => TYPE_TEXT[t] ?? t;
export const fmtDate = (iso: string | Date | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
