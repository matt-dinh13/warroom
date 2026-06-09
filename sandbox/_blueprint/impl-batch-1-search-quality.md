# Implementation Spec — Batch 1: Search Quality

> **REQs**: REQ-30 (Task Prefix) + REQ-31 (Heading Context) + REQ-32 (Truncation Limit)
> **Priority**: P0 — Highest impact
> **Effort**: ~2.5h total
> **CRITICAL**: All three changes require a **single full re-embed** after implementation.
> **Pre-requisite**: None (first batch)

---

## Overview

These three changes modify the embedding pipeline to produce higher-quality vectors:
1. Add `search_document:` / `search_query:` task prefixes
2. Inject heading hierarchy into chunk text before embedding
3. Raise truncation limit from 4000 to 12000 chars

All three affect the **same embedding flow**, so they must be implemented together and followed by one `kvault embed --full`.

---

## REQ-30: Task Prefix

### What
nomic-embed-text is fine-tuned with task prefixes. Adding `search_document: ` before document text and `search_query: ` before query text aligns vectors to the correct semantic space.

### Files to Modify

#### 1. `src/kvault/lib/embedding.py` — Lines 28-77

**Current** (line 44-46):
```python
    # Truncate very long texts (nomic-embed-text context ~8192 tokens ≈ ~4000 chars safe)
    if len(text) > 4000:
        text = text[:4000]
```

**Change**: Add a `task` parameter to `embed_text()`.

**New function signature** (line 28):
```python
def embed_text(
    text: str,
    model: str = "nomic-embed-text",
    task: str = "",
) -> list[float]:
```

**New logic** (replace lines 44-46):
```python
    # Read truncation limit from config, fallback to 12000
    max_chars = 12000  # See REQ-32 for config-driven version
    if len(text) > max_chars:
        logger.warning(f"Truncated {len(text)} → {max_chars} chars for embedding")
        text = text[:max_chars]

    # Apply task prefix for nomic-embed-text (REQ-30)
    if task:
        text = f"{task} {text}"
```

**Important**: The prefix is added AFTER truncation so it doesn't count toward the limit.

#### 2. `src/kvault/lib/embedding.py` — Lines 80-98 (`embed_batch`)

**Current** (line 80):
```python
def embed_batch(texts: list[str], model: str = "nomic-embed-text") -> list[list[float]]:
```

**New signature**:
```python
def embed_batch(
    texts: list[str],
    model: str = "nomic-embed-text",
    task: str = "",
) -> list[list[float]]:
```

**New logic** (insert after line 90, before `response = ollama.embed(...)`):
```python
    # Apply task prefix and truncation
    max_chars = 12000
    processed = []
    for t in texts:
        if len(t) > max_chars:
            logger.warning(f"Truncated {len(t)} → {max_chars} chars for embedding")
            t = t[:max_chars]
        if task:
            t = f"{task} {t}"
        processed.append(t)
    
    # Use processed texts for embedding
    response = ollama.embed(model=model, input=processed)
```

**Remove** the old line 93: `response = ollama.embed(model=model, input=texts)`

#### 3. `src/kvault/lib/embedding.py` — Line 145-146 (`run_full_embed`)

**Current** (line 145-146):
```python
            texts = [c.text for c in chunks]
            vectors = embed_batch(texts, model=model)
```

**New**:
```python
            texts = [c.text for c in chunks]
            vectors = embed_batch(texts, model=model, task="search_document:")
```

#### 4. `src/kvault/mcp_server/__init__.py` — Line 91

**Current** (line 91):
```python
        query_vector = embed_text(query)
```

**New**:
```python
        query_vector = embed_text(query, task="search_query:")
```

#### 5. `src/kvault/lib/vectordb.py` — Search function does NOT call embed_text directly, so no change needed here. The caller (MCP server, CLI) is responsible for passing the correct task prefix.

#### 6. Check all other callers of `embed_text()`:

Search the codebase for all calls to `embed_text(` and `embed_batch(`. Each call must specify the correct `task`:
- Document embedding: `task="search_document:"`
- Query embedding: `task="search_query:"`
- Dedup similarity checks: `task="search_document:"` (comparing documents)

**Command to find all callers**:
```bash
grep -rn "embed_text\|embed_batch" src/kvault/ --include="*.py"
```

### Test Cases

```python
# tests/test_embedding_prefix.py

def test_embed_text_with_task_prefix(mocker):
    """Task prefix should be prepended to text before calling Ollama."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    from kvault.lib.embedding import embed_text
    embed_text("hello world", task="search_document:")
    
    # Verify the text sent to Ollama includes the prefix
    call_args = mock_ollama.embed.call_args
    assert call_args.kwargs["input"].startswith("search_document: ")

def test_embed_text_without_task_prefix(mocker):
    """When task is empty, no prefix should be added."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    from kvault.lib.embedding import embed_text
    embed_text("hello world", task="")
    
    call_args = mock_ollama.embed.call_args
    assert call_args.kwargs["input"] == "hello world"

def test_embed_batch_with_task_prefix(mocker):
    """Batch embedding should apply prefix to all texts."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768, [0.2] * 768]}
    
    from kvault.lib.embedding import embed_batch
    embed_batch(["text1", "text2"], task="search_document:")
    
    call_args = mock_ollama.embed.call_args
    texts_sent = call_args.kwargs["input"]
    assert all(t.startswith("search_document: ") for t in texts_sent)

def test_prefix_applied_after_truncation(mocker):
    """Prefix should be applied AFTER truncation, not before."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    from kvault.lib.embedding import embed_text
    long_text = "a" * 15000  # Exceeds 12000 limit
    embed_text(long_text, task="search_document:")
    
    call_args = mock_ollama.embed.call_args
    sent_text = call_args.kwargs["input"]
    # Text should be: "search_document: " + 12000 chars
    assert len(sent_text) == len("search_document: ") + 12000
```

---

## REQ-31: Heading Context Injection

### What
Inject the heading hierarchy (e.g., "Process Steps > Step 1 > Validation Rules") into the chunk text **before embedding**, so the vector captures the document structure context.

### Files to Modify

#### 1. `src/kvault/lib/embedding.py` — Line 145 (`run_full_embed`)

**Current** (line 145):
```python
            texts = [c.text for c in chunks]
```

**New**:
```python
            # Inject heading context for better embedding (REQ-31)
            texts = []
            for c in chunks:
                if c.heading_hierarchy and c.heading_hierarchy != "(Preamble)":
                    embed_text = f"[Context: {c.heading_hierarchy}]\n{c.text}"
                else:
                    embed_text = c.text
                texts.append(embed_text)
```

**IMPORTANT**: The `c.text` field stored in LanceDB remains UNCHANGED. The `[Context: ...]` prefix is only used for generating the embedding vector. The original text is still stored in the DB for display.

This means `records` (line 151-166) still uses `chunk.text` (not the prefixed version):
```python
            records.append({
                "vector": vector,
                "text": chunk.text,  # Original text, NOT the prefixed version
                ...
            })
```

#### 2. No changes to `chunker.py`
The `heading_hierarchy` field already exists in the `Chunk` dataclass (line 27) and is already populated by `_split_by_headings()` (lines 115-126). No changes needed.

#### 3. No changes to `vectordb.py`
The `text` field in LanceDB still stores the original text. Search results display `text` as-is.

#### 4. No changes to `mcp_server/__init__.py`
The MCP server reads `r["text"]` from search results, which is the original text without context prefix.

### Test Cases

```python
# tests/test_heading_injection.py

def test_heading_context_injected_in_embed_text():
    """Heading hierarchy should be injected into text sent for embedding."""
    from kvault.lib.chunker import Chunk
    
    chunk = Chunk(
        text="Each loan must pass 3 rules before approval.",
        heading="Validation Rules",
        heading_hierarchy="Loan Origination > Step 3 > Validation Rules",
        chunk_index=0,
    )
    
    # Simulate what run_full_embed does
    if chunk.heading_hierarchy and chunk.heading_hierarchy != "(Preamble)":
        embed_text = f"[Context: {chunk.heading_hierarchy}]\n{chunk.text}"
    else:
        embed_text = chunk.text
    
    assert embed_text == "[Context: Loan Origination > Step 3 > Validation Rules]\nEach loan must pass 3 rules before approval."

def test_preamble_not_injected():
    """Preamble chunks should NOT get context injection."""
    from kvault.lib.chunker import Chunk
    
    chunk = Chunk(
        text="Introduction text here.",
        heading="(Preamble)",
        heading_hierarchy="(Preamble)",
        chunk_index=0,
    )
    
    if chunk.heading_hierarchy and chunk.heading_hierarchy != "(Preamble)":
        embed_text = f"[Context: {chunk.heading_hierarchy}]\n{chunk.text}"
    else:
        embed_text = chunk.text
    
    assert embed_text == "Introduction text here."

def test_stored_text_unchanged():
    """LanceDB text field should contain original text, not prefixed text."""
    # This test verifies that records[i]["text"] == chunk.text
    # (not the context-injected version used for embedding)
    from kvault.lib.chunker import Chunk
    
    chunk = Chunk(
        text="Original content here.",
        heading="Section",
        heading_hierarchy="Doc > Section",
        chunk_index=0,
    )
    
    record = {"text": chunk.text}  # This is what goes to LanceDB
    assert record["text"] == "Original content here."
    assert "[Context:" not in record["text"]
```

---

## REQ-32: Truncation Limit

### What
Raise the hard truncation from 4000 chars to 12000 chars (config-driven).

### Files to Modify

#### 1. `.kvault/config.yaml` — Add new field

**Current** (lines 50-56):
```yaml
embedding:
  model: "nomic-embed-text"
  dimensions: 768
  batch_size: 32
  chunk_max_tokens: 1000
  chunk_min_tokens: 50
  ollama_host: "http://localhost:11434"
```

**New** (add after line 55):
```yaml
embedding:
  model: "nomic-embed-text"
  dimensions: 768
  batch_size: 32
  chunk_max_tokens: 1000
  chunk_min_tokens: 50
  max_chars: 12000              # Truncation limit for embedding (was 4000 hardcoded)
  task_prefix: true             # Enable search_document/search_query prefix (REQ-30)
  ollama_host: "http://localhost:11434"
```

#### 2. `src/kvault/lib/embedding.py` — Make truncation config-driven

**In `embed_text()`** — replace the hardcoded 12000 with config lookup:

```python
def embed_text(
    text: str,
    model: str = "nomic-embed-text",
    task: str = "",
    max_chars: int | None = None,
) -> list[float]:
    """Generate embedding vector for a single text using Ollama.

    Args:
        text: Text to embed.
        model: Ollama model name.
        task: Task prefix ("search_document:" or "search_query:").
        max_chars: Truncation limit. If None, defaults to 12000.
    """
    import ollama

    if max_chars is None:
        max_chars = 12000

    if len(text) > max_chars:
        logger.warning(f"Truncated {len(text)} → {max_chars} chars for embedding")
        text = text[:max_chars]
    
    # Apply task prefix (REQ-30)
    if task:
        text = f"{task} {text}"

    # ... rest of function unchanged
```

**In `run_full_embed()`** — read max_chars from config:

```python
    model = config.get("embedding", {}).get("model", "nomic-embed-text")
    max_tokens = config.get("embedding", {}).get("chunk_max_tokens", 1000)
    min_tokens = config.get("embedding", {}).get("chunk_min_tokens", 50)
    max_chars = config.get("embedding", {}).get("max_chars", 12000)        # NEW
    use_prefix = config.get("embedding", {}).get("task_prefix", True)      # NEW
    task = "search_document:" if use_prefix else ""                        # NEW
```

Then pass to embed_batch:
```python
            vectors = embed_batch(texts, model=model, task=task)
```

#### 3. `src/kvault/lib/embedding.py` — Remove the fallback truncation in error handler

**Current** (lines 66-76):
```python
        if "context length" in str(e).lower() or "input length" in str(e).lower():
            logger.warning(f"Context length exceeded ({len(text)} chars), truncating to 2000")
            try:
                response = ollama.embed(model=model, input=text[:2000])
```

**Keep this** as a safety net but update the fallback value:
```python
        if "context length" in str(e).lower() or "input length" in str(e).lower():
            logger.warning(f"Context length exceeded ({len(text)} chars), truncating to 6000")
            try:
                response = ollama.embed(model=model, input=text[:6000])
```

### Test Cases

```python
# tests/test_truncation.py

def test_truncation_at_12000_default(mocker):
    """Default truncation should be 12000 chars, not 4000."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    from kvault.lib.embedding import embed_text
    text_8000 = "a" * 8000  # Was truncated to 4000 before, should NOT be truncated now
    embed_text(text_8000)
    
    call_args = mock_ollama.embed.call_args
    # Text should be full 8000 chars (not truncated)
    assert len(call_args.kwargs["input"]) == 8000

def test_truncation_at_custom_limit(mocker):
    """Custom max_chars should override default."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    from kvault.lib.embedding import embed_text
    embed_text("a" * 5000, max_chars=3000)
    
    call_args = mock_ollama.embed.call_args
    # Should be truncated to 3000
    assert len(call_args.kwargs["input"]) == 3000

def test_truncation_warning_logged(mocker, caplog):
    """Truncation should log a warning."""
    mock_ollama = mocker.patch("kvault.lib.embedding.ollama")
    mock_ollama.embed.return_value = {"embeddings": [[0.1] * 768]}
    
    import logging
    with caplog.at_level(logging.WARNING):
        from kvault.lib.embedding import embed_text
        embed_text("a" * 15000)
    
    assert "Truncated 15000" in caplog.text
```

---

## Combined Integration: How They Work Together

The embedding flow after all 3 REQs:

```
chunk.text = "Each loan must pass 3 rules before approval."
chunk.heading_hierarchy = "Loan Origination > Step 3 > Validation Rules"

Step 1 (REQ-31): Inject heading context
  → embed_input = "[Context: Loan Origination > Step 3 > Validation Rules]\nEach loan must pass 3 rules before approval."

Step 2 (REQ-32): Check truncation (12000 char limit)
  → len(embed_input) = 95 chars → no truncation needed

Step 3 (REQ-30): Add task prefix
  → final_input = "search_document: [Context: Loan Origination > Step 3 > Validation Rules]\nEach loan must pass 3 rules before approval."

Step 4: Send to Ollama
  → ollama.embed(model="nomic-embed-text", input=final_input)

Stored in LanceDB:
  text = "Each loan must pass 3 rules before approval."  ← ORIGINAL (no prefix, no context)
  vector = [0.123, -0.456, ...]  ← computed from final_input
```

For search queries:
```
query = "loan validation rules"

Step 1: No heading context (queries don't have headings)
Step 2: No truncation needed (queries are short)
Step 3 (REQ-30): Add query prefix
  → final_query = "search_query: loan validation rules"

Step 4: embed → search LanceDB → return results with original text
```

---

## Post-Implementation Checklist

```
□ All tests pass: python -m pytest tests/test_embedding_prefix.py tests/test_heading_injection.py tests/test_truncation.py -v
□ Config updated: .kvault/config.yaml has max_chars and task_prefix fields
□ Owner runs: kvault embed --full (REQUIRED — one-time full re-embed)
□ Owner exports: kvault artifact export
□ BAs import: kvault artifact import --latest
□ Verify: kvault doctor shows no warnings
□ Spot-check: Search a known query and verify improved results
```

---

## Edge Cases & Pitfalls

| Scenario | Expected behavior |
|---|---|
| Empty heading_hierarchy | Skip context injection, use raw text |
| heading_hierarchy = "(Preamble)" | Skip context injection |
| Text exactly 12000 chars | No truncation, no warning |
| Text = 12001 chars | Truncate to 12000, log warning |
| Empty text after truncation | Return zero vector [0.0]*768 |
| embed_text called without task param | No prefix added (backward compatible) |
| task_prefix=false in config | embed with task="" → no prefix |
| Existing tests calling embed_text() | Should still pass (task defaults to "") |
