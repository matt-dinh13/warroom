# Implementation Spec — Batch 5: CI Automation

> **REQs**: REQ-35 (GitLab CI Enhancement)
> **Priority**: P3
> **Effort**: ~2h
> **Pre-requisite**: Batch 2 (REQ-33 Preflight must be implemented first)

---

## REQ-35: GitLab CI Enhancement

### What
Replace the placeholder CI pipeline with real validation (preflight on changed files) and auto-dashboard generation on merge to main.

### File to Modify

#### 1. `.gitlab-ci.yml` — Replace entire file

**Current** (placeholder):
```yaml
stages:
  - validate

placeholder:
  stage: validate
  image: alpine:latest
  script:
    - echo "Knowledge Vault v0.1.0 — CI will be enabled after initial setup"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

**New** (full pipeline):
```yaml
# GitLab CI/CD Pipeline for Knowledge Vault v2
#
# Shared runner with Docker executor.
# Uses python:3.11-slim image for kvault-ci tools.
#
# Pipeline:
#   - validate: Run preflight on all changed .md files in MRs
#   - report: Generate dashboard after merge to main

stages:
  - validate
  - report

# ── Stage 1: Validate changed documents on MR ────────────────────────────────

validate-documents:
  stage: validate
  image: python:3.11-slim
  before_script:
    - pip install --quiet ".[ci]"
  script:
    - |
      echo "🔍 Running preflight on changed markdown files..."
      CHANGED_FILES=$(git diff --name-only $CI_MERGE_REQUEST_DIFF_BASE_SHA HEAD -- 'raw/**/*.md' 'clean/**/*.md')
      
      if [ -z "$CHANGED_FILES" ]; then
        echo "✅ No markdown files changed."
        exit 0
      fi
      
      FAILED=0
      for FILE in $CHANGED_FILES; do
        # Skip README files
        BASENAME=$(basename "$FILE")
        [ "$BASENAME" = "README.md" ] && continue
        
        # Skip deleted files
        [ ! -f "$FILE" ] && continue
        
        echo ""
        echo "Checking: $FILE"
        if ! kvault-ci preflight "$FILE"; then
          FAILED=$((FAILED + 1))
        fi
      done
      
      echo ""
      if [ $FAILED -gt 0 ]; then
        echo "❌ $FAILED file(s) failed preflight."
        exit 1
      else
        echo "✅ All files passed preflight."
      fi
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  allow_failure: false

# ── Stage 2: Generate dashboard after merge to main ──────────────────────────

generate-dashboard:
  stage: report
  image: python:3.11-slim
  before_script:
    - pip install --quiet ".[ci]"
  script:
    - |
      echo "📊 Generating dashboard..."
      kvault-ci report --summary
      
      # Generate dashboard HTML (if dashboard command exists)
      # Note: Full dashboard generation requires additional deps.
      # For CI, generate a JSON metrics summary.
      python -c "
      import json
      from pathlib import Path
      from datetime import datetime
      
      root = Path('.')
      raw_count = sum(1 for f in (root / 'raw').rglob('*.md') if f.name != 'README.md') if (root / 'raw').exists() else 0
      clean_count = sum(1 for f in (root / 'clean').rglob('*.md') if f.name != 'README.md') if (root / 'clean').exists() else 0
      
      metrics = {
          'generated': datetime.now().isoformat(),
          'pipeline_id': '$CI_PIPELINE_ID',
          'commit_sha': '$CI_COMMIT_SHA',
          'summary': {
              'raw_documents': raw_count,
              'clean_documents': clean_count,
              'total': raw_count + clean_count,
          }
      }
      
      out = root / 'artifacts'
      out.mkdir(exist_ok=True)
      (out / 'ci-metrics.json').write_text(json.dumps(metrics, indent=2))
      print(f'✅ Metrics: {raw_count} raw, {clean_count} clean')
      "
  artifacts:
    paths:
      - artifacts/ci-metrics.json
    expire_in: 30 days
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

#### 2. `src/kvault/cli/ci.py` — Ensure `preflight` command exists

This was created in Batch 2 (REQ-33). Verify it exists:

```python
@ci_cli.command()
@click.argument("file", type=click.Path(exists=True))
def preflight(file):
    """Run preflight checks in CI (schema + links, no dedup)."""
    from kvault.lib.preflight import run_preflight
    # ... (see Batch 2 spec)
```

**If not yet implemented from Batch 2**, add a minimal version:

```python
@ci_cli.command()
@click.argument("file", type=click.Path(exists=True))
def preflight(file):
    """Validate a markdown file for CI pipeline (schema + links).

    Exits with code 1 if validation fails (blocks merge).
    """
    from kvault.lib.validator import validate_raw, validate_clean, Severity
    from pathlib import Path

    file_path = Path(file)
    content = file_path.read_text(encoding="utf-8")

    try:
        from kvault.lib.config import find_vault_root
        root = find_vault_root()
    except FileNotFoundError:
        root = None

    # Determine target layer
    rel = str(file_path)
    is_clean = "clean/" in rel or "clean\\" in rel

    result = validate_clean(content, root) if is_clean else validate_raw(content)

    if result.valid:
        click.echo(f"✅ {file} — passed")
        if result.compliance_score > 0:
            click.echo(f"   Compliance: {result.compliance_score:.0%}")
    else:
        click.echo(f"❌ {file} — {result.error_count} error(s)")
        for err in result.errors:
            if err.severity == Severity.ERROR:
                click.echo(f"   ❌ [{err.field}] {err.message}")
        sys.exit(1)
```

#### 3. `pyproject.toml` — Verify CI deps include necessary packages

**Check** the `[project.optional-dependencies]` section:

```toml
[project.optional-dependencies]
ci = [
    "pyyaml",
    "python-frontmatter",
    "jsonschema",
    "click",
]
```

**Ensure** `click` is included (needed for kvault-ci CLI).

---

### Testing the CI Pipeline

#### Local test before pushing:

```bash
# Test preflight command
kvault-ci preflight clean/origination-a/CLM/service-overview.md

# Test report command
kvault-ci report --summary

# Simulate changed files detection
git diff --name-only HEAD~1 HEAD -- 'raw/**/*.md' 'clean/**/*.md'
```

#### GitLab test:

1. Create a branch with a .md change
2. Open MR → validate-documents job should run
3. If file has issues → pipeline fails → MR blocked
4. Fix issues → re-push → pipeline passes
5. Merge to main → generate-dashboard job runs → artifacts available

---

### Test Cases

```python
# tests/test_ci_pipeline.py

def test_ci_preflight_valid_file(tmp_path):
    """CI preflight should pass for valid file."""
    from click.testing import CliRunner
    from kvault.cli.ci import ci_cli
    
    md = tmp_path / "test.md"
    md.write_text("""---
title: Test
team: origination-a
module: CLM
---

# Test Document

Some content.
""")
    
    runner = CliRunner()
    result = runner.invoke(ci_cli, ["preflight", str(md)])
    assert result.exit_code == 0

def test_ci_preflight_invalid_file(tmp_path):
    """CI preflight should fail for invalid file."""
    from click.testing import CliRunner
    from kvault.cli.ci import ci_cli
    
    md = tmp_path / "test.md"
    md.write_text("No frontmatter, no structure, just text.")
    
    runner = CliRunner()
    result = runner.invoke(ci_cli, ["preflight", str(md)])
    # Should fail validation
    assert result.exit_code == 1

def test_ci_report_summary(tmp_path):
    """CI report --summary should show vault stats."""
    from click.testing import CliRunner
    from kvault.cli.ci import ci_cli
    
    # Setup minimal vault structure
    config_dir = tmp_path / ".kvault"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text("vault:\n  name: test\nteams: []\n")
    (tmp_path / "raw").mkdir()
    (tmp_path / "clean").mkdir()
    
    runner = CliRunner()
    result = runner.invoke(ci_cli, ["report", "--summary"], catch_exceptions=False)
    # May fail if not in vault root, but should not crash
```

---

## Post-Implementation Checklist

```
□ .gitlab-ci.yml replaced with v2 pipeline
□ validate-documents job runs on MR events
□ validate-documents correctly detects changed .md files
□ validate-documents fails pipeline when preflight fails
□ generate-dashboard job runs on main merge
□ ci-metrics.json artifact is produced
□ kvault-ci preflight works standalone
□ pip install ".[ci]" installs all needed deps
□ Pipeline passes end-to-end test (create MR → merge → check artifacts)
```

---

## Backlog Note: Obsidian Reader UI

> **Not a REQ** — backlog item for post-July 2026.
> 
> Obsidian local can serve as a free, zero-infra reader UI for vault content.
> Setup: Clone repo → Install Obsidian → Open `clean/` as vault.
> Built-in: Graph view, search, wikilinks, frontmatter, mermaid.
> Action: Write a 5-line reader setup guide in onboarding docs after v2 implementation.
> No code changes needed — Obsidian reads existing markdown natively.
