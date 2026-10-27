import type { Connector } from "./types";
import { demoConnector } from "./demo/connector";
import { hdaConnector } from "./hda/connector";

/** Connector types this build can sync. The Sources page lists the rest as "coming next". */
export const CONNECTORS: Record<string, Connector> = {
  demo: demoConnector,
  hda: hdaConnector,
};

export const CONNECTOR_CATALOG = [
  { type: "hda", name: "HDA Ticketing", category: "Ticketing", description: "Incidents and requests from HelpDesk Advanced", available: true },
  { type: "demo", name: "Demonstration data", category: "Custom", description: "Fictional records for trying Synora", available: true },
  { type: "ado", name: "Azure DevOps", category: "Engineering", description: "Bugs, work items, repos and wikis", available: false },
  { type: "sharepoint", name: "SharePoint", category: "Documents", description: "Sites, libraries and lists", available: false },
  { type: "onedrive", name: "OneDrive", category: "Documents", description: "Personal and shared files", available: false },
  { type: "outlook", name: "Microsoft Outlook", category: "Communication", description: "Shared mailboxes", available: false },
  { type: "teams", name: "Microsoft Teams", category: "Communication", description: "Channels and chat threads", available: false },
  { type: "confluence", name: "Confluence", category: "Documents", description: "Spaces and pages", available: false },
  { type: "csv", name: "CSV import", category: "Custom", description: "Exports from any system", available: false },
  { type: "mcp", name: "Custom MCP Connector", category: "Custom", description: "Model Context Protocol server", available: false },
] as const;

export function connectorFor(type: string): Connector {
  const c = CONNECTORS[type];
  if (!c) throw new Error(`No connector is available for "${type}" yet.`);
  return c;
}
