"""Quick check script for origination-a / CLM embeddings (no pandas)."""
from kvault.lib.vectordb import init_db, search
from kvault.lib.embedding import embed_text
from collections import Counter

table = init_db()
all_rows = table.to_arrow()

teams = all_rows.column("team").to_pylist()
modules = all_rows.column("module").to_pylist()
sources = all_rows.column("source_path").to_pylist()
headings = all_rows.column("chunk_heading").to_pylist()

print(f"=== Full Index: {len(teams)} total chunks ===\n")

# OrgA filter
orga_idx = [i for i, t in enumerate(teams) if t == "origination-a"]
print(f"=== Origination-A Overview ===")
print(f"Total chunks: {len(orga_idx)}")
orga_sources = set(sources[i] for i in orga_idx)
print(f"Documents: {len(orga_sources)}")

orga_modules = Counter(modules[i] for i in orga_idx)
print(f"Modules: {sorted(orga_modules.keys())}\n")

for mod, count in sorted(orga_modules.items()):
    mod_docs = len(set(sources[i] for i in orga_idx if modules[i] == mod))
    print(f"  {mod}: {mod_docs} docs, {count} chunks")

print(f"\n=== CLM Deep Dive ===")
clm_idx = [i for i in orga_idx if modules[i] == "CLM"]
clm_sources = sorted(set(sources[i] for i in clm_idx))
for src in clm_sources:
    src_idx = [i for i in clm_idx if sources[i] == src]
    print(f"  {src}")
    print(f"    Chunks: {len(src_idx)}")
    src_headings = [headings[i] for i in src_idx]
    for h in src_headings[:5]:
        print(f"      - {h}")
    if len(src_headings) > 5:
        print(f"      ... +{len(src_headings)-5} more")

# Search tests
print(f"\n=== Search Test: CLM Queries (with v2 task prefix + MMR) ===")
queries = [
    "CLM contract lifecycle management",
    "COMA CLC module back-office",
    "loan origination BSL contract types",
]

for q in queries:
    print(f"\nQuery: '{q}'")
    vec = embed_text(q, task="search_query:")
    results = search(vec, top_k=3, team="origination-a", mmr_lambda=0.5, mmr_max_per_source=2)
    if not results:
        print("  (no results)")
    for r in results:
        sim = 1.0 - r["score"]
        print(f"  [{sim:.3f}] {r['source_path']} > {r['chunk_heading']}")
        preview = r["text"][:150].replace("\n", " ")
        print(f"           {preview}...")
