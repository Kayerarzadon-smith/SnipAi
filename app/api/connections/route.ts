import { NextResponse } from "next/server";
import { loadConnections } from "@/lib/connections";

export async function GET() {
  return NextResponse.json({ connections: loadConnections() });
}
