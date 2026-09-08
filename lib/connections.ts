import path from "node:path";
import { STATE_ROOT } from "./paths";
import { readJson } from "./jsonStore";
import type { PlatformConnection } from "./types";

const FILE = path.join(STATE_ROOT, "connections.json");

// Every platform starts (and, for this build, stays) not_connected. No
// credential fields exist anywhere in this app — wiring a real OAuth flow
// per platform is future work that needs Kayer's own developer accounts.
// Phone / SMS removed at Kayer's request. Pinterest and Trybe added.
const DEFAULT: PlatformConnection[] = [
  { id: "tiktok-shop", label: "TikTok Shop", status: "not_connected" },
  { id: "instagram", label: "Instagram", status: "not_connected" },
  { id: "pinterest", label: "Pinterest", status: "not_connected" },
  { id: "trybe", label: "Trybe", status: "not_connected" },
  { id: "x", label: "X", status: "not_connected" },
  { id: "snapchat", label: "Snapchat", status: "not_connected" },
  { id: "facebook", label: "Facebook", status: "not_connected" },
  { id: "amazon-storefront", label: "Amazon Storefront", status: "not_connected" },
];

export function loadConnections(): PlatformConnection[] {
  return readJson<PlatformConnection[]>(FILE, DEFAULT);
}
