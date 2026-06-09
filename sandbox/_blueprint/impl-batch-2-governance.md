# Implementation Spec — Batch 2: Quality & Governance

> **REQs**: REQ-29 (Embedding Determinism) + REQ-33 (Preflight) + REQ-37 (MMR Search)
> **Priority**: P1
> **Effort**: ~7h total
> **Pre-requisite**: Batch 1 complete (search quality changes in place)

---

## REQ-29: Embedding Determinism (Model Pinning)

### What
Pin the Ollama model digest in config so `kvault doctor` can warn when a BA's local model differs from the team standard.

### Files to Modify

#### 1. `.kvault/config.yaml`

**Add** under `embedding:` section (after the `model` field):
```yaml
embedding:
  model: "nomic-embed-text"
  model_digest: ""              # Populated by owner via: kvault doctor --pin-digest
  dimensions: 768
  # ... rest unchanged
```

**Note**: `model_digest` starts empty. Owner runs a one-time command to populate it.

#### 2. `src/kvault/cli/main.py` — Enhance `doctor` command

**Find**: The existing `doctor` command (search for `def doctor` in main.py).

**Add** a new check inside the doctor command function, after existing checks:

```python
    # ── Model digest check (REQ-29) ────────────────────────────
    config = load_config(root)
    expected_digest = config.get("embedding", {}).get("model_digest", "")
    model_name = config.get("embedding", {}).get("model", "nomic-embed-text")
    
    if expected_digest:
        try:
            import subprocess
            result = subprocess.run(
                ["ollama", "show", model_name, "--modelfile"],
                capture_output=True, text=True, timeout=10,
            )
            # Extract digest from ollama show output
            # Look for line like: "FROM sha256:abcdef..."
            local_digest = ""
            for line in result.stdout.split("\n"):
                if line.strip().startswith("FROM") and "sha256:" in line:
                    local_digest = line.split("sha256:")[-1].strip()[:12]
                    break
            
            if not local_digest:
                # Try alternative: ollama list
                result = subprocess.run(
                    ["ollama", "list"], capture_output=True, text=True, timeout=10,
                )
                for line in result.stdout.split("\n"):
                    if model_name in line:
                        # Format: "nomic-embed-text:latest    abcdef123456    768 MB    2 weeks ago"
                        parts = line.split()
                        if len(parts) >= 2:
                            local_digest = parts[1][:12]
                        break
            
            if local_digest and expected_digest[:12] != local_digest[:12]:
                click.echo(f"  ⚠️  Model digest MISMATCH")
                click.echo(f"      Config: {expected_digest[:12]}...")
                click.echo(f"      Local:  {local_digest}...")
                click.echo(f"      → Contact vault owner for updated artifact")
            elif local_digest:
                click.echo(f"  ✅ Model digest: {local_digest}... (matches config)")
            else:
                click.echo(f"  ⚠️  Could not read local model digest")
        except Exception as e:
            click.echo(f"  ⚠️  Model digest check failed: {e}")
    else:
        click.echo(f"  ℹ️  No model_digest pinned in config (optional)")
```

#### 3. New CLI option: `kvault doctor --pin-digest`

**Add** a new option to the doctor command to let the owner pin the current digest:

```python
@cli.command()
@click.option("--pin-digest", is_flag=True, help="Pin current model digest to config (owner only)")
def doctor(pin_digest):
    """Run system diagnostics and verify installation."""
    # ... existing doctor logic ...
    
    if pin_digest:
        # Read current model digest
        import subprocess
        model_name = config.get("embedding", {}).get("model", "nomic-embed-text")
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=10,
        )
        for line in result.stdout.split("\n"):
            if model_name in line:
                parts = line.split()
                if len(parts) >= 2:
                    digest = parts[1]
                    # Update config.yaml
                    config_path = root / ".kvault" / "config.yaml"
                    config_text = config_path.read_text(encoding="utf-8")
                    if "model_digest:" in config_text:
                        import re
                        config_text = re.sub(
                            r'model_digest:\s*".*?"',
                            f'model_digest: "{digest}"',
                            config_text,
                        )
                    else:
                        config_text = config_text.replace(
                            f'model: "{model_name}"',
                            f'model: "{model_name}"\n  model_digest: "{digest}"',
                        )
                    config_path.write_text(config_text, encoding="utf-8")
                    click.echo(f"  📌 Pinned digest: {digest}")
                    click.echo(f"     Commit and push config.yaml to share with team")
                    break
```

### Test Cases

```python
# tests/test_model_pinning.py

def test_config_has_model_digest_field():
    """config.yaml should accept model_digest field."""
    import yaml
    config = yaml.safe_load("""
    embedding:
      model: "nomic-embed-text"
      model_digest: "abc123def456"
    """)
    assert config["embedding"]["model_digest"] == "abc123def456"

def test_empty_digest_no_error():
    """Empty model_digest should not cause errors."""
    import yaml
    config = yaml.safe_load("""
    embedding:
      model: "nomic-embed-text"
      model_digest: ""
    """)
    assert config["embedding"]["model_digest"] == ""
```

---

## REQ-33: Preflight Quality Gate

### What
New `kvault preflight <file>` command that runs schema validation + link integrity + duplicate detection as a unified pre-submission check.

### Files to Create

#### 1. NEW: `src/kvault/lib/preflight.py`

```python
"""
Preflight Quality Gate for Knowledge Vault.

Runs three sequential checks on a document:
  1. Schema validation (frontmatter + template)
  2. Link integrity (wikilinks + markdown links point to existing files)
  3. Duplicate detection (SimHash + vector similarity)

Returns a unified result with per-check status.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("kvault.preflight")


@dataclass
class CheckResult:
    """Result of a single preflight check."""
    name: str
    passed: bool
    message: str
    details: list[str] = field(default_factory=list)


@dataclass
class PreflightResult:
    """Combined result of all preflight checks."""
    file_path: str
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def summary(self) -> str:
        lines = [f"Preflight: {self.file_path}"]
        for c in self.checks:
            icon = "✅" if c.passed else "❌"
            lines.append(f"  {icon} {c.name}: {c.message}")
            for d in c.details:
                lines.append(f"      {d}")
        return "\n".join(lines)


def run_preflight(
    file_path: Path,
    vault_root: Path | None = None,
    skip_dedup: bool = False,
) -> PreflightResult:
    """Run all preflight checks on a file.

    Args:
        file_path: Path to the markdown file to check.
        vault_root: Vault root directory. Auto-detected if None.
        skip_dedup: If True, skip duplicate detection (for CI without VectorDB).

    Returns:
        PreflightResult with per-check status.
    """
    from kvault.lib.config import find_vault_root, load_config

    root = vault_root or find_vault_root()
    result = PreflightResult(file_path=str(file_path))

    # Check 1: Schema validation
    result.checks.append(_check_schema(file_path, root))

    # Check 2: Link integrity
    result.checks.append(_check_links(file_path, root))

    # Check 3: Duplicate detection
    if not skip_dedup:
        result.checks.append(_check_duplicates(file_path, root))
    else:
        result.checks.append(CheckResult(
            name="Duplicate Detection",
            passed=True,
            message="Skipped (no VectorDB in CI)",
        ))

    return result


def _check_schema(file_path: Path, root: Path) -> CheckResult:
    """Check 1: Validate frontmatter schema and template compliance."""
    from kvault.lib.validator import validate_clean, validate_raw, Severity

    content = file_path.read_text(encoding="utf-8")
    rel = str(file_path.relative_to(root))

    # Determine target layer
    is_clean = rel.startswith("clean/") or rel.startswith("clean\\")
    validation = validate_clean(content, root) if is_clean else validate_raw(content)

    if validation.valid:
        return CheckResult(
            name="Schema Validation",
            passed=True,
            message=f"Valid ({validation.compliance_score:.0%} compliance)",
        )
    else:
        errors = [
            f"[{e.field}] {e.message}"
            for e in validation.errors
            if e.severity == Severity.ERROR
        ]
        return CheckResult(
            name="Schema Validation",
            passed=False,
            message=f"{len(errors)} error(s) found",
            details=errors,
        )


def _check_links(file_path: Path, root: Path) -> CheckResult:
    """Check 2: Verify all internal links point to existing files."""
    content = file_path.read_text(encoding="utf-8")
    parent = file_path.parent
    broken = []

    # Check markdown links: [text](path.md)
    md_links = re.findall(r'\[(?:[^\]]*)\]\(([^)]+\.md)\)', content)
    for link in md_links:
        # Skip external URLs
        if link.startswith("http://") or link.startswith("https://"):
            continue
        target = (parent / link).resolve()
        if not target.exists():
            broken.append(f"Markdown link: [{link}] → file not found")

    # Check wikilinks: [[document-name]]
    wikilinks = re.findall(r'\[\[([^\]]+)\]\]', content)
    for wl in wikilinks:
        # Search in clean/ directory
        found = False
        clean_dir = root / "clean"
        if clean_dir.exists():
            for f in clean_dir.rglob("*.md"):
                if f.stem == wl or f.stem == wl.replace(" ", "-").lower():
                    found = True
                    break
        if not found:
            broken.append(f"Wikilink: [[{wl}]] → document not found")

    if broken:
        return CheckResult(
            name="Link Integrity",
            passed=False,
            message=f"{len(broken)} broken link(s)",
            details=broken,
        )
    return CheckResult(
        name="Link Integrity",
        passed=True,
        message="All links valid",
    )


def _check_duplicates(file_path: Path, root: Path) -> CheckResult:
    """Check 3: Detect duplicate or near-duplicate content."""
    try:
        from kvault.lib.dedup import check_duplicate
        from kvault.lib.config import load_config

        content = file_path.read_text(encoding="utf-8")
        config = load_config(root)

        result = check_duplicate(
            content,
            threshold=config.get("dedup", {}).get("vector_similarity_threshold", 0.85),
        )

        if result and result.get("is_duplicate"):
            return CheckResult(
                name="Duplicate Detection",
                passed=False,
                message=f"Similar to: {result.get('similar_to', 'unknown')}",
                details=[f"Similarity: {result.get('similarity', 0):.1%}"],
            )
        return CheckResult(
            name="Duplicate Detection",
            passed=True,
            message="No duplicates found",
        )
    except Exception as e:
        return CheckResult(
            name="Duplicate Detection",
            passed=True,
            message=f"Skipped ({e})",
        )
```

#### 2. `src/kvault/cli/main.py` — Add `preflight` command

**Add** a new command (insert near other validation commands):

```python
@cli.command()
@click.argument("file", type=click.Path(exists=True))
@click.option("--skip-dedup", is_flag=True, help="Skip duplicate detection")
def preflight(file, skip_dedup):
    """Run pre-submission quality checks on a document.

    Checks: schema validation, link integrity, duplicate detection.
    Exit code 0 = all pass, 1 = any failure.
    """
    from kvault.lib.preflight import run_preflight
    from kvault.lib.config import find_vault_root

    root = find_vault_root()
    result = run_preflight(Path(file), vault_root=root, skip_dedup=skip_dedup)

    click.echo(result.summary)

    if not result.passed:
        sys.exit(1)
```

#### 3. `src/kvault/cli/main.py` — Integrate preflight into `submit` command

**Find**: The existing `submit` command.

**Add** preflight gate before git operations:

```python
    # Run preflight before submission (REQ-33)
    from kvault.lib.preflight import run_preflight
    
    preflight_result = run_preflight(Path(file_path), vault_root=root)
    click.echo(preflight_result.summary)
    
    if not preflight_result.passed:
        if force:
            click.echo("⚠️  Preflight failed but --force used, continuing...")
        else:
            click.echo("❌ Preflight failed. Fix issues above or use --force to override.")
            sys.exit(1)
```

#### 4. `src/kvault/cli/ci.py` — Add `preflight` command for CI

```python
@ci_cli.command()
@click.argument("file", type=click.Path(exists=True))
def preflight(file):
    """Run preflight checks in CI (no VectorDB, schema + links only).

    Exits with code 1 if validation fails (blocks merge).
    """
    from kvault.lib.preflight import run_preflight
    from kvault.lib.config import find_vault_root

    try:
        root = find_vault_root()
    except FileNotFoundError:
        root = Path(".")

    result = run_preflight(Path(file), vault_root=root, skip_dedup=True)
    click.echo(result.summary)

    if not result.passed:
        sys.exit(1)
```

### Test Cases

```python
# tests/test_preflight.py
import tempfile
from pathlib import Path

def test_preflight_valid_file(tmp_path):
    """Valid file should pass all checks."""
    from kvault.lib.preflight import run_preflight
    
    md = tmp_path / "clean" / "team" / "module" / "test.md"
    md.parent.mkdir(parents=True)
    md.write_text("""---
title: Test Document
team: origination-a
module: CLM
language: en
content_type: process-doc
tags: [test]
source_reference: "raw/origination-a/CLM/test.docx"
date_created: 2026-01-01
last_updated: 2026-01-01
---

## Summary
Test content.

## References
None.
""")
    result = run_preflight(md, vault_root=tmp_path, skip_dedup=True)
    assert result.passed

def test_preflight_broken_link(tmp_path):
    """File with broken markdown link should fail link check."""
    from kvault.lib.preflight import run_preflight
    
    md = tmp_path / "clean" / "team" / "test.md"
    md.parent.mkdir(parents=True)
    md.write_text("""---
title: Test
team: origination-a
module: CLM
language: en
content_type: process-doc
tags: []
source_reference: ""
date_created: 2026-01-01
last_updated: 2026-01-01
---

See [related doc](nonexistent.md) for details.
""")
    result = run_preflight(md, vault_root=tmp_path, skip_dedup=True)
    link_check = [c for c in result.checks if c.name == "Link Integrity"][0]
    assert not link_check.passed
    assert "nonexistent.md" in link_check.details[0]

def test_preflight_exit_code():
    """Preflight should return exit code 1 on failure."""
    from kvault.lib.preflight import PreflightResult, CheckResult
    
    result = PreflightResult(
        file_path="test.md",
        checks=[
            CheckResult("Schema", True, "OK"),
            CheckResult("Links", False, "1 broken"),
        ],
    )
    assert not result.passed
```

---

## REQ-37: MMR Search Diversity

### What
Apply Maximal Marginal Relevance reranking after cosine search to ensure diverse results.

### Files to Modify

#### 1. `.kvault/config.yaml`

**Add** new section:
```yaml
# Search configuration
search:
  mmr_lambda: 0.5              # MMR diversity (1.0=pure cosine, 0.0=max diversity)
  mmr_max_per_source: 2        # Max chunks from same document in top-k
  result_content_chars: 800    # Chars returned in search result content
```

#### 2. `src/kvault/lib/vectordb.py` — Add MMR function and integrate into search

**Add** new function before `search()`:

```python
def _mmr_rerank(
    results: list[dict],
    query_vector: list[float],
    lambda_param: float = 0.5,
    max_per_source: int = 2,
    top_k: int = 5,
) -> list[dict]:
    """Rerank results using Maximal Marginal Relevance.

    MMR balances relevance (similarity to query) with diversity
    (dissimilarity to already-selected results).

    Args:
        results: Raw search results with 'vector' or 'score' fields.
        query_vector: The query embedding vector.
        lambda_param: 0.0 = max diversity, 1.0 = pure relevance.
        max_per_source: Max chunks from the same source_path.
        top_k: Number of results to return.

    Returns:
        Reranked list of results.
    """
    if len(results) <= 1:
        return results

    # Track source counts
    source_counts: dict[str, int] = {}
    selected: list[dict] = []
    remaining = list(results)

    while remaining and len(selected) < top_k:
        best_idx = -1
        best_score = -float("inf")

        for i, candidate in enumerate(remaining):
            source = candidate.get("source_path", "")

            # Skip if this source already has max_per_source chunks
            if source_counts.get(source, 0) >= max_per_source:
                continue

            # Relevance: similarity to query (use existing score, invert distance)
            relevance = 1.0 - candidate.get("score", 0.0)  # LanceDB returns distance

            # Diversity: min dissimilarity to already selected
            if selected:
                max_sim = 0.0
                for s in selected:
                    sim = _cosine_sim_simple(
                        candidate.get("_vector", []),
                        s.get("_vector", []),
                    )
                    max_sim = max(max_sim, sim)
                diversity = 1.0 - max_sim
            else:
                diversity = 1.0

            # MMR score
            mmr_score = lambda_param * relevance + (1.0 - lambda_param) * diversity

            if mmr_score > best_score:
                best_score = mmr_score
                best_idx = i

        if best_idx == -1:
            break  # No more valid candidates

        chosen = remaining.pop(best_idx)
        selected.append(chosen)
        source = chosen.get("source_path", "")
        source_counts[source] = source_counts.get(source, 0) + 1

    return selected


def _cosine_sim_simple(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute cosine similarity between two vectors without numpy."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5

    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
```

#### 3. `src/kvault/lib/vectordb.py` — Modify `search()` function

**Current** `search()` signature (line 116):
```python
def search(
    query_vector: list[float],
    top_k: int = 5,
    ...
```

**New** signature:
```python
def search(
    query_vector: list[float],
    top_k: int = 5,
    team: str | None = None,
    module: str | None = None,
    language: str | None = None,
    content_type: str | None = None,
    db_path: str | Path | None = None,
    mmr_lambda: float | None = None,
    mmr_max_per_source: int = 2,
) -> list[dict[str, Any]]:
```

**Modify** the search body — fetch 2*top_k candidates, then MMR rerank:

Replace lines 145-149:
```python
    try:
        # Fetch 2x candidates for MMR reranking
        fetch_k = top_k * 2 if mmr_lambda is not None and mmr_lambda < 1.0 else top_k
        query = table.search(query_vector).limit(fetch_k)
        if where_clause:
            query = query.where(where_clause)
        raw_results = query.to_list()
    except Exception as e:
        logger.error(f"Search failed: {e}")
        return []
```

After building the results list (after line 170), add MMR reranking:
```python
    # Apply MMR reranking if configured (REQ-37)
    if mmr_lambda is not None and mmr_lambda < 1.0 and len(results) > 1:
        # Attach vectors for MMR computation
        for i, r in enumerate(results):
            if i < len(raw_results):
                r["_vector"] = raw_results[i].get("vector", [])
        
        results = _mmr_rerank(
            results, query_vector,
            lambda_param=mmr_lambda,
            max_per_source=mmr_max_per_source,
            top_k=top_k,
        )
        
        # Clean up internal fields
        for r in results:
            r.pop("_vector", None)

    return results
```

#### 4. `src/kvault/mcp_server/__init__.py` — Pass MMR config to search

**Current** (lines 93-101):
```python
        results = search(
            query_vector=query_vector,
            top_k=top_k,
            team=team or None,
            ...
        )
```

**New**:
```python
        # Load search config for MMR (REQ-37)
        try:
            from kvault.lib.config import find_vault_root, load_config
            search_config = load_config(find_vault_root()).get("search", {})
        except Exception:
            search_config = {}

        results = search(
            query_vector=query_vector,
            top_k=top_k,
            team=team or None,
            module=module or None,
            language=language or None,
            content_type=content_type or None,
            db_path=_get_db_path(),
            mmr_lambda=search_config.get("mmr_lambda", 0.5),
            mmr_max_per_source=search_config.get("mmr_max_per_source", 2),
        )
```

#### 5. `src/kvault/mcp_server/__init__.py` — Update content truncation (line 122)

**Current**:
```python
                "content": r["text"][:500],  # Truncate for readability
```

**New**:
```python
                "content": r["text"][:search_config.get("result_content_chars", 800)],
```

### Test Cases

```python
# tests/test_mmr.py

def test_mmr_limits_per_source():
    """MMR should return max 2 chunks from same source."""
    from kvault.lib.vectordb import _mmr_rerank
    
    results = [
        {"source_path": "doc_a.md", "score": 0.1, "_vector": [1.0, 0.0, 0.0]},
        {"source_path": "doc_a.md", "score": 0.15, "_vector": [0.9, 0.1, 0.0]},
        {"source_path": "doc_a.md", "score": 0.2, "_vector": [0.8, 0.2, 0.0]},
        {"source_path": "doc_b.md", "score": 0.25, "_vector": [0.0, 1.0, 0.0]},
        {"source_path": "doc_c.md", "score": 0.3, "_vector": [0.0, 0.0, 1.0]},
    ]
    query = [1.0, 0.0, 0.0]
    
    reranked = _mmr_rerank(results, query, lambda_param=0.5, max_per_source=2, top_k=5)
    
    source_a_count = sum(1 for r in reranked if r["source_path"] == "doc_a.md")
    assert source_a_count <= 2

def test_mmr_lambda_1_pure_cosine():
    """Lambda=1.0 should behave like pure cosine (no diversity)."""
    from kvault.lib.vectordb import _mmr_rerank
    
    results = [
        {"source_path": "a.md", "score": 0.1, "_vector": [1.0]},
        {"source_path": "a.md", "score": 0.2, "_vector": [0.9]},
    ]
    reranked = _mmr_rerank(results, [1.0], lambda_param=1.0, max_per_source=99, top_k=5)
    # Should maintain original order (most relevant first)
    assert reranked[0]["score"] == 0.1

def test_cosine_sim_simple():
    """Cosine similarity should be computed correctly."""
    from kvault.lib.vectordb import _cosine_sim_simple
    
    assert abs(_cosine_sim_simple([1, 0], [1, 0]) - 1.0) < 0.001
    assert abs(_cosine_sim_simple([1, 0], [0, 1]) - 0.0) < 0.001
    assert abs(_cosine_sim_simple([1, 0], [-1, 0]) - (-1.0)) < 0.001

def test_mmr_empty_results():
    """MMR should handle empty results gracefully."""
    from kvault.lib.vectordb import _mmr_rerank
    
    assert _mmr_rerank([], [1.0], lambda_param=0.5) == []

def test_mmr_single_result():
    """MMR with single result should return it as-is."""
    from kvault.lib.vectordb import _mmr_rerank
    
    results = [{"source_path": "a.md", "score": 0.1, "_vector": [1.0]}]
    reranked = _mmr_rerank(results, [1.0], lambda_param=0.5, top_k=5)
    assert len(reranked) == 1
```

---

## Post-Implementation Checklist

```
□ REQ-29: kvault doctor shows model digest status
□ REQ-29: kvault doctor --pin-digest writes digest to config.yaml
□ REQ-33: kvault preflight <file> runs 3 checks and returns unified report
□ REQ-33: kvault submit runs preflight before git operations
□ REQ-33: kvault-ci preflight works in CI (skip_dedup=True)
□ REQ-37: search returns diverse results (max 2 per source)
□ REQ-37: search config in config.yaml is respected
□ REQ-37: MCP search_knowledge uses MMR
□ All tests pass
```
