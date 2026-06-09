# Architecture Overview — v2.0

> **Version**: 2.0 (planned)
> **Previous**: [architecture.md](architecture.md) (v1.0 — baseline)
> **Date**: 2026-05-25
> **Requirements**: [kvault-improvement-requirements.md]
> **Status**: Planned — chưa implement

---

## Design Principles (bất biến)

| # | Nguyên tắc | Ý nghĩa |
|---|---|---|
| P1 | **Local-first** | Không yêu cầu server. `pip install .` + Ollama là chạy |
| P2 | **Git-backed** | GitLab là source-of-truth duy nhất |
| P3 | **Offline capable** | Không cần internet khi search/validate |
| P4 | **Model kiểm soát được** | Embedding model local (Ollama). Không gửi data ra cloud |
| P5 | **BA-friendly** | Target user là BA, không phải developer |
| P6 | **Three-layer** | Raw → Clean → Index |
| P7 | **Keep it simple** | Mỗi feature phải justify rõ "giải quyết vấn đề gì" |

---

## System Design (v2)

```
BA's Machine (Local-first)
┌────────────────────────────────────────────────────────────────┐
│  IDE (VS Code + Antigravity)                                   │
│  ├── AI Agent ←→ MCP Server (9 tools)                          │
│  │              ├── search_knowledge  ← +task prefix, +MMR     │
│  │              ├── read_document     ← NEW (v2)               │
│  │              ├── create_draft                                │
│  │              ├── suggest_tags                                │
│  │              ├── check_duplicates                            │
│  │              ├── validate_draft                              │
│  │              ├── list_modules                                │
│  │              └── explore_graph                               │
│  └── Terminal → kvault CLI (21+ commands)                       │
│                  ├── kvault preflight   ← NEW (v2)             │
│                  └── kvault dashboard   ← UPGRADED (v2)        │
│                                                                 │
│  Local Storage                                                  │
│  ├── ~/.kvault-local/profile.yaml  (BA identity)                │
│  ├── ~/.kvault-local/vectordb/     (LanceDB)                    │
│  ├── ~/.kvault-local/metrics/      (SQLite)                     │
│  ├── ~/.kvault-local/cache/        (SimHash)                    │
│  └── ~/kvault-drafts/              (Pending docs)               │
│                                                                 │
│  Ollama (local, pinned digest)                                  │
│  └── nomic-embed-text (768-dim, sha256 pinned in config)        │
│      ├── search_document: prefix (embed time)                   │
│      └── search_query: prefix (query time)                      │
└────────────────────────────────────────────────────────────────┘
         │ git push/pull (VPN required)
         ▼
┌────────────────────────────────────────────────────────────────┐
│  GitLab (git.homecredit.net)                                   │
│  ├── raw/{team}/{module}/*.md                                  │
│  ├── clean/{team}/{module}/*.md  ← +sources: frontmatter (v2) │
│  ├── artifacts/vault-index-*.tar.gz  (Git LFS tracked)         │
│  ├── artifacts/dashboard.html        ← CI-generated (v2)      │
│  └── .gitlab-ci.yml                                            │
│       ├── validate stage  (kvault-ci preflight)    ← v2        │
│       └── report stage    (kvault-ci dashboard)    ← v2        │
│       image: python:3.11-slim (shared runner, Docker executor) │
└────────────────────────────────────────────────────────────────┘
```

### Thay đổi so với v1

| Component | v1 | v2 | REQ |
|---|---|---|---|
| MCP tools | 7 tools | 9 tools (+`read_document`, `explore_graph` counted) | REQ-8 |
| Embedding prefix | Raw text | `search_document:` / `search_query:` prefix | REQ-2 |
| Chunk context | Heading text only | Heading hierarchy injected vào embed text | REQ-3 |
| Truncation limit | 4000 chars (hardcoded) | 12000 chars (config-driven) | REQ-4 |
| Model pinning | Không | `model_digest: sha256:...` in config, `kvault doctor` warns mismatch | REQ-1 |
| Search reranking | Top-k cosine thuần | MMR (λ=0.5), max 2 chunks/source | REQ-9 |
| Preflight | Không có | `kvault preflight` = schema + links + dedup | REQ-5 |
| Source provenance | `source_reference` (single) | `sources: []` list in frontmatter | REQ-6 |
| Dashboard | Owner-only, operational | +BOD sections, print mode, funnel, heatmap | REQ-10 |
| CI pipeline | Placeholder only | Preflight + dashboard generation | REQ-7 |
| Artifact storage | Git commit | Git LFS tracked | REQ-1 |

---

## Three-Layer Architecture

### Raw Layer (`raw/`)
- **Purpose**: Staging area for rough drafts
- **Validation**: Minimal (title, team, module required)
- **Who**: Any BA can submit
- **Formats**: `.md`, `.docx`, `.pptx`, `.vtt`, `.pdf`

### Clean Layer (`clean/`)
- **Purpose**: Reviewed, schema-compliant knowledge
- **Validation**: Full (frontmatter schema + template sections)
- **Who**: Submitted via MR, reviewed by peers
- **Indexed**: Embedded into Vector DB for search
- **v2**: `sources:` frontmatter field links back to raw origin files

### Index Layer (local)
- **Purpose**: Semantic search via vector embeddings
- **Storage**: LanceDB (file-based, no server needed)
- **Embedding**: Ollama nomic-embed-text (768d, digest-pinned)
- **Distribution**: Exported as `.tar.gz` artifacts (Git LFS), imported by BAs
- **v2**: Task prefix (`search_document:` / `search_query:`) + heading hierarchy injection + MMR reranking

---

## Core Libraries

| Library | Responsibility | v2 changes |
|---------|---------------|------------|
| `config.py` | Load vault configs, auto-detect root | +`model_digest`, +`embedding.max_chars`, +`search.mmr_lambda` |
| `profile.py` | BA identity (team, name) | — |
| `validator.py` | 3-level validation (markdown → frontmatter → template) | +link integrity check |
| `chunker.py` | Split documents by heading for embedding | +heading hierarchy injection into embed text |
| `converter.py` | VTT/DOCX/PPTX/PDF → Markdown | — |
| `embedding.py` | Ollama embedding + full/incremental pipeline | +task prefix, +config-driven truncation limit, +model digest check |
| `vectordb.py` | LanceDB CRUD + search | +MMR reranking post-search |
| `dedup.py` | SimHash + vector similarity duplicate detection | — |
| `git_ops.py` | Branch, commit, push, MR URL generation | — |
| `freshness.py` | Stale document detection | — |
| `metrics.py` | SQLite KPI collection | +BOD metrics (funnel, heatmap, freshness) |
| `dashboard.py` | HTML dashboard generation | +BOD sections, print mode, team heatmap |
| `ci.py` | Lightweight CI CLI | +`preflight` command, +`dashboard` command |

---

## Data Flow (v2)

```
1. BA creates/converts document
   └── kvault convert/create → ~/kvault-drafts/pending/

2. BA runs preflight (NEW v2)
   └── kvault preflight → schema ✓ → links ✓ → dedup ✓
       └── Unified report: ✅/⚠️/❌ per check

3. BA submits (now with preflight gate)
   └── kvault submit → preflight (auto) → git branch → commit → push
       └── Blocked if preflight fails (override: --force)

4. GitLab CI validates + reports (UPGRADED v2)
   └── .gitlab-ci.yml (image: python:3.11-slim)
       ├── validate stage: kvault-ci preflight on changed files
       └── report stage: kvault-ci dashboard (on main merge)

5. Owner embeds (after merge)
   └── kvault embed --full → chunk (with heading context) → embed (with prefix) → LanceDB
       └── kvault doctor warns if model digest ≠ config pinned digest

6. Owner exports artifact (Git LFS)
   └── kvault artifact export → artifacts/vault-index-*.tar.gz
       └── .gitattributes: artifacts/*.tar.gz filter=lfs

7. BAs import artifact
   └── kvault artifact import --latest → local LanceDB

8. BA searches via agent (UPGRADED v2)
   └── MCP search_knowledge
       → embed query (search_query: prefix)
       → LanceDB cosine search
       → MMR rerank (λ=0.5, max 2 chunks/source)
       → results (800 chars content)
       → read_document for full text (NEW)
```

---

## Embedding Pipeline (v2 detail)

```
Clean Layer .md file
    │ parse_file() → metadata + body
    ▼
chunk_document()
    │ Split by H2/H3 (max 1000 tokens, min 50 tokens)
    │ Inject: "[Context: {heading_hierarchy}]\n" prefix      ← NEW v2
    ▼
embed_text()
    │ Prefix: "search_document: {chunk_text}"                ← NEW v2
    │ Truncation: config.embedding.max_chars (default 12000) ← NEW v2
    │ Model: nomic-embed-text (digest-pinned)                ← NEW v2
    │ via Ollama local
    ▼
768-dim vectors
    │ upsert_chunks() → LanceDB
    ▼
search()
    │ Query prefix: "search_query: {query}"                  ← NEW v2
    │ Cosine similarity → top 2*k candidates
    │ MMR rerank (λ=0.5) → top k results                    ← NEW v2
    │ Max 2 chunks per source_path                           ← NEW v2
    ▼
Results → MCP / CLI
```

---

## Dashboard Architecture (v2)

```
┌─────────────────────────────────────────────────────┐
│  Dashboard HTML (static, Chart.js)                   │
│                                                      │
│  ┌─ BOD View (NEW v2) ─────────────────────────────┐│
│  │  Executive KPIs (4 cards)                        ││
│  │  Knowledge Conversion Funnel (raw→clean→indexed) ││
│  │  Team Contribution Heatmap (team × month)        ││
│  │  Document Freshness Health (donut)               ││
│  │  MR Pipeline Velocity (if GitLab API available)  ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Owner View (existing) ─────────────────────────┐│
│  │  Current State (5 KPI cards)                     ││
│  │  Growth Over Time (2 line charts)                ││
│  │  Recent Activity (8 commits)                     ││
│  │  Distribution (team + content type charts)       ││
│  │  Module Breakdown (table)                        ││
│  │  Contributors (table)                            ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  Features: print mode (?print=1), export metrics.json│
└─────────────────────────────────────────────────────┘

Data sources (zero new deps):
  ├── Git log → growth, contributors, activity
  ├── File scan → raw/clean counts, modules, content types
  ├── freshness.py → stale/aging/fresh document counts
  ├── metrics.py → SQLite KPIs, usage stats
  └── GitLab API → MR velocity (CI only, via $CI_JOB_TOKEN)
```

---

## CI Pipeline Architecture (v2)

```yaml
# .gitlab-ci.yml (planned)
image: python:3.11-slim    # Shared runner, Docker executor

stages:
  - validate
  - report

validate-documents:
  stage: validate
  script:
    - pip install ".[ci]"
    - |
      CHANGED=$(git diff --name-only $CI_MERGE_REQUEST_DIFF_BASE_SHA HEAD -- 'raw/**/*.md' 'clean/**/*.md')
      for FILE in $CHANGED; do
        kvault-ci preflight "$FILE"
      done
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

generate-dashboard:
  stage: report
  script:
    - pip install ".[ci]"
    - kvault-ci dashboard --output artifacts/dashboard.html
  artifacts:
    paths: [artifacts/dashboard.html, artifacts/metrics.json]
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

---

## Config Changes (v2)

```yaml
# .kvault/config.yaml — new fields

embedding:
  model: "nomic-embed-text"
  model_digest: "sha256:..."          # NEW — pinned model version
  dimensions: 768
  batch_size: 32
  chunk_max_tokens: 1000
  chunk_min_tokens: 50
  max_chars: 12000                     # NEW — truncation limit (was hardcoded 4000)
  task_prefix: true                    # NEW — enable search_document/search_query prefix
  ollama_host: "http://localhost:11434"

search:
  mmr_lambda: 0.5                      # NEW — MMR diversity (1.0 = pure cosine)
  mmr_max_per_source: 2                # NEW — max chunks from same document
  result_content_chars: 800            # NEW — was hardcoded 500
```

---

## Migration Notes: v1 → v2

### Breaking changes
- **Re-embed required**: Task prefix + heading injection changes embedding vectors
  - Owner must run `kvault embed --full` after upgrade
  - Re-export artifact: `kvault artifact export`
  - All BAs must re-import: `kvault artifact import --latest`

### Non-breaking additions
- `kvault preflight` — new command, doesn't affect existing workflow
- `read_document` MCP tool — new tool, no impact on existing tools
- Dashboard BOD sections — additive, existing sections unchanged
- `sources:` frontmatter — new field, not required retroactively
- CI pipeline — new stages, existing placeholder replaced

### Upgrade checklist
```
□ 1. Update code (git pull)
□ 2. Reinstall: pip install .
□ 3. Pin model digest: kvault doctor (note sha256)
□ 4. Owner: kvault embed --full (re-embed with prefix)
□ 5. Owner: kvault artifact export
□ 6. BAs: kvault artifact import --latest
□ 7. Verify: kvault doctor (all green)
```
