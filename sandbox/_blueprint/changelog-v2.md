# 📋 Changelog — Knowledge Vault v2.0

> **Commit**: `e438fa5`
> **Ngày**: 2026-05-25
> **Nhánh**: feature branch (chưa merge main)
> **Tác giả**: Agent (theo spec từ SA/PO)
> **Audit**: 10/10 PASS, 103 tests passed

---

## ⚠️ Breaking Changes

### Bắt buộc re-embed toàn bộ
Sau khi cập nhật code, **PHẢI** chạy `kvault embed --full` vì:
1. Vector mới có task prefix (`search_document:` / `search_query:`)
2. Vector mới encode heading hierarchy (`[Context: ...]`)
3. Truncation limit thay đổi từ 4,000 → 12,000 ký tự

Nếu không re-embed, search sẽ trả kết quả kém do vector cũ không tương thích.

```bash
ollama serve
kvault embed --full        # ~5-10 phút
kvault artifact export     # Xuất cho team
```

---

## ✨ Tính năng mới

### Batch 1 — Cải thiện chất lượng tìm kiếm

**REQ-30: Task Prefix cho Nomic model**
- Thêm prefix `search_document:` khi embed tài liệu
- Thêm prefix `search_query:` khi search
- Giúp model phân biệt rõ giữa "đây là tài liệu" vs "đây là câu hỏi"
- Files: `embedding.py`, `mcp_server/__init__.py`

**REQ-31: Heading Context Injection**
- Khi embed chunk, inject thêm heading hierarchy vào vector
- Ví dụ: `[Context: CLM > Contract Signing > Disbursement Flows]\n<nội dung chunk>`
- Giúp search hiểu ngữ cảnh chunk nằm ở đâu trong tài liệu
- Files: `embedding.py` (cả `run_full_embed` và `run_incremental_embed`)

**REQ-32: Tăng giới hạn truncation**
- Trước: hardcode 4,000 ký tự → mất nội dung dài
- Sau: config-driven `max_chars: 12000` trong `config.yaml`
- Retry fallback cũng tăng từ 2,000 → 6,000
- Files: `embedding.py`, `config.yaml`

### Batch 2 — Quản trị & Đa dạng kết quả

**REQ-29: Pinning Model Digest**
- Config mới: `embedding.model_digest: "0a109f422b47"`
- CLI mới: `kvault doctor --pin-digest` — tự động đọc digest từ Ollama và ghi vào config
- `kvault doctor` kiểm tra digest local vs config, cảnh báo nếu khác nhau
- Đảm bảo toàn team dùng cùng 1 phiên bản model
- Files: `cli/main.py`, `config.yaml`

**REQ-33: Preflight Quality Gate**
- Module mới: `lib/preflight.py` (208 dòng)
- 3 checks tuần tự: Schema validation → Link integrity → Duplicate detection
- CLI mới: `kvault preflight <file>` — chạy standalone
- Tích hợp vào `kvault submit`: preflight chạy tự động trước khi submit, fail = block
- Flag `--force` để bypass khi cần
- Flag `--skip-dedup` cho CI (không cần VectorDB)
- Files: `lib/preflight.py`, `cli/main.py`

**REQ-37: MMR Reranking**
- Thuật toán Maximal Marginal Relevance — cân bằng giữa relevance và diversity
- Config: `search.mmr_lambda: 0.5` (0.0 = max đa dạng, 1.0 = pure cosine)
- Config: `search.mmr_max_per_source: 2` — tối đa 2 chunks từ cùng 1 file
- Fetch 2x candidates rồi rerank để chọn top-k đa dạng nhất
- Files: `lib/vectordb.py`, `mcp_server/__init__.py`, `config.yaml`

### Batch 3 — Truy vết & Đọc tài liệu

**REQ-34: Source Provenance**
- `kvault mine` tự động thêm `sources: [raw/team/module/file.ext]` vào frontmatter
- Search results được enrich thêm `sources` metadata
- Giúp truy vết clean doc → raw file gốc
- Files: `lib/miner.py`, `mcp_server/__init__.py`

**REQ-36: MCP Tool `read_document`**
- Tool mới cho AI agents: đọc toàn bộ nội dung tài liệu qua MCP
- Input: `source_path` từ search results
- Output: metadata + full body + char count
- Bảo mật: chặn path traversal (`../../etc/passwd`)
- Files: `mcp_server/__init__.py`

### Batch 4 — Dashboard BOD

**REQ-38: Dashboard nâng cấp cho Ban lãnh đạo**
- **Executive Summary**: 4 KPI cards (tổng articles, module coverage, active contributors, avg docs/BA)
- **Conversion Funnel**: biểu đồ ngang Raw → Clean → Indexed Chunks
- **Document Freshness**: donut chart (Fresh < 60d, Aging 60-90d, Stale > 90d)
- **Contribution Heatmap**: bảng contributor × tháng với ô màu theo intensity
- **Print Mode**: thêm `?print=1` vào URL → tự động mở hộp thoại in
- Các section Owner cũ giữ nguyên 100%
- Files: `dashboard.py`

### Batch 5 — CI/CD Pipeline

**REQ-35: GitLab CI Enhancement**
- Thay toàn bộ `.gitlab-ci.yml` placeholder bằng pipeline thật
- **Stage `validate-documents`**: chạy khi có MR, preflight trên tất cả file `.md` thay đổi
- **Stage `generate-dashboard`**: chạy khi merge vào main, xuất `ci-metrics.json`
- CLI mới: `kvault-ci preflight <file>` (lightweight, không cần Ollama)
- CLI mới: `kvault-ci report --summary`
- Files: `.gitlab-ci.yml`, `cli/ci.py`

---

## 📁 Danh sách files thay đổi

| File | Thay đổi | Dòng |
|---|---|---|
| `lib/embedding.py` | Task prefix, truncation config, heading context | +92 |
| `lib/vectordb.py` | MMR reranking, cosine sim helper | +116 |
| `lib/preflight.py` | **MỚI** — Quality gate module | +207 |
| `lib/miner.py` | Thêm `sources` field + heading context khi mine | +7 |
| `lib/dedup.py` | Minor fix | +2 |
| `mcp_server/__init__.py` | `read_document` tool, search enrich, MMR config | +102 |
| `cli/main.py` | `preflight` command, `--pin-digest`, submit integration | +203 |
| `cli/ci.py` | `preflight` + `report` CI commands | +22 |
| `dashboard.py` | BOD metrics, funnel, freshness, heatmap, print mode | +188 |
| `.gitlab-ci.yml` | Full pipeline replacement | +122 |
| `.kvault/config.yaml` | `max_chars`, `task_prefix`, `model_digest`, `search.*` | +9 |
| `pyproject.toml` | CI dependency | +1 |
| `tests/unit/` (10 files) | **MỚI** — Unit tests cho tất cả features | +486 |
| **Tổng** | **22 files** | **+1,476 / -81** |

---

## ⚙️ Config mới trong `config.yaml`

```yaml
# Embedding (thêm mới)
embedding:
  max_chars: 12000           # Giới hạn truncation (trước: hardcode 4000)
  task_prefix: true          # Bật search_document/search_query prefix
  model_digest: "0a109f422b47"  # Digest phiên bản model đang dùng

# Search (section mới hoàn toàn)
search:
  mmr_lambda: 0.5            # Cân bằng relevance/diversity
  mmr_max_per_source: 2      # Max chunks từ 1 file trong kết quả
  result_content_chars: 800  # Số ký tự trả về trong search snippet
```

---

## 🧪 Tests

- **10 test files mới** trong `tests/unit/`
- **103 tests tổng cộng**, tất cả pass
- Coverage: embedding prefix, heading injection, truncation, MMR, model pinning, preflight (valid + invalid + path traversal), dashboard BOD, CI pipeline, source provenance, read_document

---

## 📊 Kết quả sau re-embed

| Metric | Trước v2 | Sau v2 |
|---|---|---|
| Total chunks | ~590 | **1,114** |
| Truncation limit | 4,000 chars | **12,000 chars** |
| Task prefix | ❌ | ✅ `search_document:` / `search_query:` |
| Heading context | ❌ | ✅ `[Context: hierarchy]` |
| MMR diversity | ❌ | ✅ lambda=0.5, max 2/source |
| Search snippet | 500 chars | **800 chars** |

---

## 🔜 Backlog (chưa implement)

- **Obsidian Reader UI**: Dùng Obsidian mở `clean/` folder cho stakeholders không có IDE
- **REQ-38 MR Velocity**: Cần GitLab API, placeholder hiện tại
- **Doctor sources check**: Cảnh báo clean docs thiếu `sources:` field
