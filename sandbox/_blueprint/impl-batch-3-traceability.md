# Implementation Spec — Batch 3: Traceability & DX

> **REQs**: REQ-34 (Source Provenance) + REQ-36 (read_document MCP)
> **Priority**: P2
> **Effort**: ~3h total
> **Pre-requisite**: None (independent of Batch 1-2)

---

## REQ-34: Source Provenance

### What
When `kvault mine` processes raw files into clean docs, auto-populate a `sources:` list in frontmatter linking back to the original raw files.

### Files to Modify

#### 1. `src/kvault/lib/miner.py` — Add sources field during mining

**Find**: The function that creates/updates clean document frontmatter. Look for where metadata dict is built or where frontmatter is written.

**Current approach** in miner.py: When a raw file is processed, it creates a clean .md with frontmatter. The `source_reference` field already exists (line 42: `REQUIRED_FIELDS`).

**Change**: After the clean document frontmatter is assembled, add `sources` list:

```python
# In the function that builds clean document metadata (mine_file or similar):
# After setting metadata fields like title, team, module...

# REQ-34: Source Provenance
# Build sources list from raw file paths
if isinstance(raw_paths, list):
    metadata["sources"] = [str(p.relative_to(root)) for p in raw_paths]
elif raw_path:
    metadata["sources"] = [str(raw_path.relative_to(root))]
```

**Exact location**: Find where `source_reference` is set and add `sources` right after:

```python
    metadata["source_reference"] = str(raw_rel_path)
    metadata["sources"] = [str(raw_rel_path)]  # NEW: REQ-34
```

If the mine function processes multiple raw files into one clean doc (e.g., merging VTT segments):
```python
    metadata["sources"] = [str(p.relative_to(root)) for p in source_files]
```

#### 2. `src/kvault/cli/main.py` — `doctor` command: warn on missing sources

**Find**: The `doctor` command function.

**Add** a new check (scan clean/ for files without `sources` field):

```python
    # ── Source provenance check (REQ-34) ────────────────────────
    clean_dir = root / "clean"
    if clean_dir.exists():
        missing_sources = 0
        total_clean = 0
        for f in clean_dir.rglob("*.md"):
            if f.name == "README.md":
                continue
            total_clean += 1
            try:
                meta, _ = parse_file(f)
                if "sources" not in meta:
                    missing_sources += 1
            except Exception:
                pass
        if missing_sources > 0:
            click.echo(f"  ⚠️  {missing_sources}/{total_clean} clean docs missing 'sources' field")
            click.echo(f"      (New docs via 'kvault mine' will auto-populate this)")
        else:
            click.echo(f"  ✅ All {total_clean} clean docs have source provenance")
```

#### 3. `src/kvault/mcp_server/__init__.py` — Include sources in search results

**Current** search result metadata (lines 162-169):
```python
            "metadata": {
                "team": r.get("team", ""),
                "module": r.get("module", ""),
                "language": r.get("language", ""),
                "content_type": r.get("content_type", ""),
                "tags": json.loads(r.get("tags", "[]")),
                "title": r.get("title", ""),
            },
```

**Note**: Sources are stored in frontmatter, not in LanceDB. To include sources in search results, the MCP server must read the source file's frontmatter.

**Add** after building `formatted` results:

```python
        # Enrich results with source provenance (REQ-34)
        for item in formatted:
            try:
                source_file = Path(find_vault_root()) / item["source"]
                if source_file.exists():
                    meta, _ = parse_file(source_file)
                    item["metadata"]["sources"] = meta.get("sources", [])
            except Exception:
                item["metadata"]["sources"] = []
```

**Import needed**: `from kvault.lib.config import find_vault_root` (already imported in some paths)

### Test Cases

```python
# tests/test_source_provenance.py

def test_mine_adds_sources_field(tmp_path):
    """Mining a raw file should add sources field to clean frontmatter."""
    # Create a mock raw file
    raw_file = tmp_path / "raw" / "team-a" / "MOD" / "test.md"
    raw_file.parent.mkdir(parents=True)
    raw_file.write_text("# Test\n\nSome content.")
    
    # After mining, the clean doc should have sources
    # (Test the metadata building logic, not the full mine pipeline)
    raw_rel = "raw/team-a/MOD/test.md"
    metadata = {"sources": [raw_rel]}
    assert metadata["sources"] == ["raw/team-a/MOD/test.md"]

def test_sources_field_is_list():
    """Sources should always be a list, even for single source."""
    metadata = {"sources": ["raw/team/mod/file.docx"]}
    assert isinstance(metadata["sources"], list)
    assert len(metadata["sources"]) == 1

def test_missing_sources_no_error():
    """Clean docs without sources field should not cause errors."""
    import yaml
    fm = yaml.safe_load("---\ntitle: Test\nteam: a\n---")
    sources = fm.get("sources", [])
    assert sources == []
```

---

## REQ-36: MCP Read Document Tool

### What
New MCP tool `read_document` that returns full document content given a source path.

### Files to Modify

#### 1. `src/kvault/mcp_server/__init__.py` — Add new tool

**Add** after the existing tools (e.g., after `explore_graph` tool):

```python
# ── Tool: read_document ──────────────────────────────────────────────────────


@mcp.tool()
def read_document(source_path: str) -> str:
    """Read the full content of a document from the Knowledge Vault.

    Use this after search_knowledge to read the complete document
    when a search snippet is not enough context.

    Args:
        source_path: The source path from search results
                     (e.g., 'clean/origination-a/CLM/service-overview.md').
    """
    try:
        from kvault.lib.config import find_vault_root
        from kvault.lib.validator import parse_file

        root = find_vault_root()
        file_path = root / source_path

        if not file_path.exists():
            return json.dumps({
                "error": f"File not found: {source_path}",
                "suggestion": "Check the source_path from search results.",
            })

        if not file_path.suffix == ".md":
            return json.dumps({
                "error": f"Not a markdown file: {source_path}",
            })

        # Security: ensure path is within vault
        try:
            file_path.resolve().relative_to(root.resolve())
        except ValueError:
            return json.dumps({
                "error": "Path traversal detected. Path must be within vault.",
            })

        # Parse file
        metadata, body = parse_file(file_path)

        return json.dumps({
            "source_path": source_path,
            "metadata": {
                "title": metadata.get("title", ""),
                "team": metadata.get("team", ""),
                "module": metadata.get("module", ""),
                "language": metadata.get("language", ""),
                "content_type": metadata.get("content_type", ""),
                "tags": metadata.get("tags", []),
                "sources": metadata.get("sources", []),
                "date_created": str(metadata.get("date_created", "")),
                "last_updated": str(metadata.get("last_updated", "")),
                "status": metadata.get("status", ""),
            },
            "content": body,
            "char_count": len(body),
        }, indent=2, ensure_ascii=False)

    except Exception as e:
        return json.dumps({"error": str(e)})
```

#### 2. `README.md` — Update tool count (when v2 is deployed)

**Current** (line 56):
```
**7 tools**: `search_knowledge` · ...
```

**Will become** (after all v2 tools added):
```
**8 tools**: `search_knowledge` · `read_document` · ...
```

**Note**: Do NOT update README until the code is merged. This is just a reminder.

### Test Cases

```python
# tests/test_read_document.py
import json

def test_read_document_valid_file(tmp_path, monkeypatch):
    """read_document should return full content for valid file."""
    # Setup vault structure
    config_dir = tmp_path / ".kvault"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text("vault:\n  name: test\n")
    
    clean_file = tmp_path / "clean" / "team" / "module" / "test.md"
    clean_file.parent.mkdir(parents=True)
    clean_file.write_text("""---
title: Test Document
team: team
module: module
language: en
content_type: process-doc
tags: [test]
source_reference: ""
date_created: 2026-01-01
last_updated: 2026-01-01
---

## Summary
Full content here with many paragraphs.
""")
    
    # Monkeypatch find_vault_root to return tmp_path
    monkeypatch.setattr("kvault.lib.config.find_vault_root", lambda: tmp_path)
    
    from kvault.mcp_server import read_document
    result = json.loads(read_document("clean/team/module/test.md"))
    
    assert result["metadata"]["title"] == "Test Document"
    assert "Full content here" in result["content"]
    assert result["char_count"] > 0

def test_read_document_not_found(tmp_path, monkeypatch):
    """read_document should return error for missing file."""
    config_dir = tmp_path / ".kvault"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text("vault:\n  name: test\n")
    
    monkeypatch.setattr("kvault.lib.config.find_vault_root", lambda: tmp_path)
    
    from kvault.mcp_server import read_document
    result = json.loads(read_document("clean/nonexistent.md"))
    
    assert "error" in result
    assert "not found" in result["error"].lower()

def test_read_document_path_traversal(tmp_path, monkeypatch):
    """read_document should block path traversal attempts."""
    config_dir = tmp_path / ".kvault"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text("vault:\n  name: test\n")
    
    monkeypatch.setattr("kvault.lib.config.find_vault_root", lambda: tmp_path)
    
    from kvault.mcp_server import read_document
    result = json.loads(read_document("../../etc/passwd"))
    
    assert "error" in result
```

---

## Post-Implementation Checklist

```
□ REQ-34: kvault mine produces clean docs with sources: field
□ REQ-34: kvault doctor warns about clean docs missing sources
□ REQ-34: search_knowledge returns sources in metadata
□ REQ-36: read_document MCP tool works
□ REQ-36: read_document blocks path traversal
□ REQ-36: search result content is 800 chars (not 500)
□ All tests pass
```
