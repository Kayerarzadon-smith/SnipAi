import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { REFERENCE_ROOT } from "@/lib/paths";
import { writeJsonAtomic } from "@/lib/jsonStore";

const CATALOGUE = path.join(REFERENCE_ROOT, "products.json");

type Catalogue = {
  affiliate?: { amazonTag?: string };
  products?: { id: string; name: string; brand?: string; links?: Record<string, string> }[];
};

function read(): Catalogue {
  try {
    return JSON.parse(fs.readFileSync(CATALOGUE, "utf8")) as Catalogue;
  } catch {
    return { products: [] };
  }
}

export async function GET() {
  const c = read();
  return NextResponse.json({
    amazonTag: c.affiliate?.amazonTag ?? "",
    products: (c.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      links: p.links ?? {},
    })),
  });
}

/** Save the affiliate tag, or one product's links. */
export async function PATCH(req: NextRequest) {
  let body: { amazonTag?: unknown; productId?: unknown; links?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const c = read();

  if (body.amazonTag !== undefined) {
    if (typeof body.amazonTag !== "string" || body.amazonTag.length > 64) {
      return NextResponse.json({ error: "amazonTag must be a short string" }, { status: 400 });
    }
    c.affiliate = { ...(c.affiliate ?? {}), amazonTag: body.amazonTag.trim() };
  }

  if (body.productId !== undefined) {
    if (typeof body.productId !== "string") {
      return NextResponse.json({ error: "productId must be a string" }, { status: 400 });
    }
    const prod = (c.products ?? []).find((p) => p.id === body.productId);
    if (!prod) {
      return NextResponse.json({ error: `no product '${body.productId}'` }, { status: 404 });
    }
    const links = body.links;
    if (links && typeof links === "object") {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(links as Record<string, unknown>)) {
        if (typeof v !== "string") continue;
        // only real links; a stray word here would be pasted into a caption
        if (v && !/^https?:\/\//i.test(v)) {
          return NextResponse.json({ error: `${k} must be a URL or empty` }, { status: 400 });
        }
        clean[k] = v;
      }
      prod.links = { ...(prod.links ?? {}), ...clean };
    }
  }

  writeJsonAtomic(CATALOGUE, c);
  return NextResponse.json({ ok: true, amazonTag: c.affiliate?.amazonTag ?? "" });
}
