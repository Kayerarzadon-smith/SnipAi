#!/usr/bin/env python3
"""Work out which product a video is about, from what was actually said.

    python3 tools/match_product.py projects/<name>
    python3 tools/match_product.py projects/<name> --caption

Every word in the video is already transcribed, so the product does not need
to be typed in twice -- if the words "medicube nad plus" are spoken, the video
is about the Medicube NAD+ serum, and its affiliate link can be attached
without anyone hunting for it.

Scoring is deliberately dull and inspectable: count how many of a product's
aliases are spoken, weight longer aliases higher (matching "zero pore pads"
means more than matching "medicube"), and require a clear winner. If two
products score close together it says so rather than guessing -- attaching the
wrong affiliate link to a video is worse than attaching none.

Reads reference/products.json. Never posts anything anywhere.
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGUE = os.path.join(ROOT, "reference", "products.json")


def norm(t):
    return re.sub(r"[^a-z0-9 ]", " ", t.lower())


def spoken_text(project):
    """Everything said in the video, as one normalised string."""
    tpath = os.path.join(project, "work", "transcript.json")
    if not os.path.exists(tpath):
        return None
    segs = json.load(open(tpath))
    return re.sub(r"\s+", " ", norm(" ".join(s.get("text", "") for s in segs)))


def alias_owners(catalogue):
    """How many products each alias belongs to.

    A brand name shared by three products is almost no evidence about WHICH
    of them a video is about, but a bare count treats it the same as a unique
    phrase. Dividing by the number of owners is standard inverse-frequency
    weighting: distinctive words decide, shared words barely register.
    """
    owners = {}
    for prod in catalogue["products"]:
        for alias in {prod["name"], *prod.get("aliases", []), prod.get("brand", "")}:
            a = norm(alias).strip()
            if a:
                owners[a] = owners.get(a, 0) + 1
    return owners


def score_products(text, catalogue):
    owners = alias_owners(catalogue)
    results = []
    for prod in catalogue["products"]:
        hits, weight = [], 0.0
        # the product's own name counts as an alias
        for alias in {prod["name"], *prod.get("aliases", []), prod.get("brand", "")}:
            alias = norm(alias).strip()
            if not alias:
                continue
            n = text.count(alias)
            if n:
                # longer alias = stronger evidence; shared alias = weaker
                words = len(alias.split())
                shared = owners.get(alias, 1)
                w = n * (words ** 2) / shared
                weight += w
                hits.append({"alias": alias, "times": n,
                             "weight": round(w, 2), "sharedBy": shared})
        if hits:
            results.append({
                "id": prod["id"], "name": prod["name"], "brand": prod.get("brand"),
                "score": round(weight, 2), "hits": sorted(hits, key=lambda h: -len(h["alias"])),
                "links": prod.get("links", {}),
            })
    return sorted(results, key=lambda r: -r["score"])


def amazon_with_tag(url, tag):
    if not url or not tag:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}tag={tag}"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--catalogue", default=CATALOGUE)
    ap.add_argument("--min-score", type=float, default=4.0,
                    help="below this, say 'not sure' instead of guessing")
    ap.add_argument("--margin", type=float, default=1.5,
                    help="the winner must beat the runner-up by this multiple")
    ap.add_argument("--caption", action="store_true", help="print a ready-to-paste caption")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    catalogue = json.load(open(a.catalogue))
    text = spoken_text(a.project.rstrip("/"))
    if text is None:
        print("no transcript yet -- transcribe the video first", file=sys.stderr)
        return 1

    ranked = score_products(text, catalogue)
    tag = (catalogue.get("affiliate") or {}).get("amazonTag", "")

    if not ranked:
        out = {"match": None, "reason": "no catalogue product was mentioned"}
    else:
        top = ranked[0]
        runner = ranked[1]["score"] if len(ranked) > 1 else 0.0
        confident = top["score"] >= a.min_score and top["score"] >= runner * a.margin
        out = {
            "match": top if confident else None,
            "candidates": ranked[:3],
            "reason": None if confident else (
                "nothing scored high enough" if top["score"] < a.min_score
                else f"{top['name']} and {ranked[1]['name']} scored too close to call"
            ),
            "amazonTag": tag or None,
        }
        if confident and top["links"].get("amazon"):
            out["amazonLink"] = amazon_with_tag(top["links"]["amazon"], tag)

    if a.json:
        print(json.dumps(out, indent=1))
        return 0

    if out["match"]:
        m = out["match"]
        print(f"{m['name']}  (score {m['score']})")
        for h in m["hits"][:4]:
            shared = f"  (shared by {h['sharedBy']} products)" if h.get("sharedBy", 1) > 1 else ""
            print(f"    heard \"{h['alias']}\" x{h['times']}  +{h.get('weight', 0)}{shared}")
        for kind, url in (m.get("links") or {}).items():
            if url:
                shown = amazon_with_tag(url, tag) if kind == "amazon" else url
                print(f"    {kind}: {shown}")
        if not any((m.get("links") or {}).values()):
            print("    no links saved for this product yet")
        if a.caption:
            print("\n--- caption ---")
            print(f"{m['name']}")
            link = out.get("amazonLink") or (m.get("links") or {}).get("tiktokShop") or ""
            if link:
                print(link)
    else:
        print(f"Not sure: {out['reason']}")
        for c in out.get("candidates", [])[:3]:
            print(f"    {c['name']:44} score {c['score']}")
        print("  Add what you actually call it to that product's aliases.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
