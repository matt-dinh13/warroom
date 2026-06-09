# Requirements Document

## Introduction

The Knowledge Vault is a structured knowledge management system for Business Analyst teams working on a core banking/lending platform across 4 countries. It provides a three-layer architecture (Raw, Clean, Index) backed by a self-hosted GitLab instance (VPN-required) as the source of truth, enabling BAs to convert heterogeneous documents into searchable markdown, curate knowledge through peer review, and query it via a bilingual RAG interface through their IDE. The system runs 100% locally after git sync — embedding uses Ollama locally, vector search uses an embedded ChromaDB/LanceDB database, and the query interface is an MCP server integrated into IDE tools (Cursor/Kiro/Windsurf). A designated builder (the Owner) periodically performs full re-embedding and publishes artifacts to GitLab for new BA onboarding. Phase 1 (MVP) covers the conversion tooling, GitLab repository structure, branch protection with MR workflow, local embedding pipeline, MCP-based query interface, drafts workflow, duplicate detection, content types system, and training/onboarding guides.

## Glossary

- **Knowledge_Vault**: The overall system comprising the Raw Layer, Clean Layer, Index Layer, Conversion Tool, Embedding Pipeline, MCP Server, Drafts Workflow, and supporting tooling
- **Raw_Layer**: The staging area in the GitLab repository where converted markdown files are stored before review, organized by team and module; accepts content that is not yet template-compliant or mature
- **Clean_Layer**: The curated knowledge layer containing reviewed, template-compliant markdown files with metadata frontmatter, serving as the source of truth for embedding
- **Index_Layer**: The search layer containing vector embeddings of Clean Layer content stored in an embedded vector database, used by the MCP Server to answer BA queries
- **Conversion_Tool**: A local CLI tool (`kvault convert`) that BAs use to convert source documents (VTT, PowerPoint, PDF, Word, Git repos) into markdown format
- **Embedding_Pipeline**: A local process run by the Owner (designated builder) that chunks markdown files by heading/section and generates bilingual vector embeddings using Ollama
- **MCP_Server**: A local Python MCP (Model Context Protocol) server that bridges IDE tools (Cursor/Kiro/Windsurf) to the Knowledge Vault, providing search, drafting, and management tools
- **Vector_DB**: An embedded vector database (ChromaDB or LanceDB, installed via pip) used to store and query document embeddings locally on each BA workstation
- **Ollama**: A local LLM runtime used for generating embeddings and LLM-assisted digest operations, requiring zero token cost
- **Frontmatter**: YAML metadata block at the top of Clean Layer markdown files containing tags, ownership, source references, content type, and other structured metadata
- **Merge_Request**: A GitLab merge request used for peer review and approval before content moves between branches
- **Team_Lead**: A designated BA responsible for reviewing and approving merge requests for their team's content
- **Owner**: The system administrator and designated builder who has final approval authority on merges to the main branch, performs periodic re-embedding, and publishes artifacts
- **BA**: Business Analyst, the primary user of the Knowledge Vault system (most have no GitLab experience)
- **Bilingual_Model**: An embedding model (run via Ollama) capable of processing both Vietnamese and English text
- **Drafts_Folder**: A local directory OUTSIDE the vault repository where MCP write operations stage content for BA review before submission
- **Content_Type**: A configurable document classification (e.g., process-doc, decision-log, meeting-notes) defined in `.kvault/content-types.yaml` with associated templates and validation rules
- **SimHash**: A locality-sensitive hashing algorithm used for detecting exact and near-exact duplicate content
- **Designated_Builder**: The Owner role responsible for periodic full re-embedding and artifact publishing to GitLab
- **VPN**: Virtual Private Network required for all git operations (pull, push, MR) against the self-hosted GitLab instance
- **Agent_Skills**: Markdown instruction files stored in `.kvault/skills/` that define consistent AI agent behavior across all BA workstations, covering search patterns, content creation rules, review standards, and domain context. Distributed via GitLab and loaded by IDE agents through MCP/steering configuration.
- **Agent_Skills**: Markdown instruction files stored in `.kvault/skills/` that define consistent AI agent behavior across all BA workstations, covering search patterns, content creation rules, review standards, and domain context. Distributed via GitLab and loaded by IDE agents through MCP/steering configuration.

## Requirements

### Requirement 1: Document Conversion

**User Story:** As a BA, I want to convert various document formats into markdown, so that I can contribute knowledge to the vault regardless of the original file format.

#### Acceptance Criteria

1. WHEN a BA provides a VTT transcript file, THE Conversion_Tool SHALL produce a valid markdown file preserving the textual content and speaker attribution
2. WHEN a BA provides a PowerPoint file, THE Conversion_Tool SHALL produce a markdown file containing slide titles, text content, and speaker notes
3. WHEN a BA provides a PDF file, THE Conversion_Tool SHALL produce a markdown file preserving headings, paragraphs, and list structures
4. WHEN a BA provides a Word document, THE Conversion_Tool SHALL produce a markdown file preserving headings, paragraphs, tables, and list structures
5. WHEN a source document contains diagrams, THE Conversion_Tool SHALL convert diagrams to Mermaid or PlantUML code blocks where feasible, or embed them as image references
6. WHEN conversion completes successfully, THE Conversion_Tool SHALL place the output markdown file in the Drafts_Folder for BA review before submission to the repository
7. IF a source document cannot be converted, THEN THE Conversion_Tool SHALL display a descriptive error message indicating the failure reason and the unsupported element

### Requirement 2: GitLab Repository Structure

**User Story:** As a BA team lead, I want a well-organized repository structure, so that knowledge is easy to find and team boundaries are clear.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL organize the repository with a top-level separation between Raw_Layer and Clean_Layer directories
2. THE Knowledge_Vault SHALL organize content within each layer by team name and module name (e.g., `raw/{team-name}/{module-name}/`, `clean/{team-name}/{module-name}/`)
3. THE Knowledge_Vault SHALL maintain a branch hierarchy of: `main` → `team/{team-name}/main` → `feature/{team-name}/{function-name}`
4. WHEN a new team is onboarded, THE Knowledge_Vault SHALL provide a directory template containing the required folder structure and a README describing the module ownership
5. THE Knowledge_Vault SHALL store configuration files in a `.kvault/` directory at the repository root, including `config.yaml` and `content-types.yaml`

### Requirement 3: Branch Protection and Merge Request Workflow

**User Story:** As a team lead, I want strict branch protection rules, so that only reviewed and approved content reaches the main branch.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL enforce branch protection on the `main` branch requiring approval from both the Owner and the relevant Team_Lead before merge
2. THE Knowledge_Vault SHALL enforce branch protection on `team/{team-name}/main` branches requiring approval from the relevant Team_Lead
3. WHEN a BA creates a Merge_Request from a `feature/{team-name}/{function-name}` branch to a team branch, THE Knowledge_Vault SHALL require at least one peer review from another BA on the same team
4. THE Knowledge_Vault SHALL prevent direct pushes to the `main` branch and to `team/{team-name}/main` branches
5. IF a Merge_Request fails CI validation checks, THEN THE Knowledge_Vault SHALL block the merge until all checks pass
6. WHEN a BA needs to perform git operations (pull, push, create MR), THE Knowledge_Vault SHALL require an active VPN connection to the self-hosted GitLab instance

### Requirement 4: Content Promotion from Raw to Clean

**User Story:** As a BA, I want a clear process to promote reviewed content from the Raw Layer to the Clean Layer, so that curated knowledge is distinguished from unreviewed drafts.

#### Acceptance Criteria

1. WHEN a BA submits content for promotion from Raw_Layer to Clean_Layer, THE Knowledge_Vault SHALL require the markdown file to pass template compliance validation
2. WHEN a markdown file passes template compliance validation, THE Knowledge_Vault SHALL verify that the file contains valid Frontmatter with required metadata fields (title, team, module, language, source_reference, date_created, content_type)
3. IF a markdown file fails template compliance or Frontmatter validation, THEN THE Knowledge_Vault SHALL report specific validation errors to the BA in the Merge_Request comments
4. WHEN content is promoted to the Clean_Layer, THE Knowledge_Vault SHALL preserve a reference to the original Raw_Layer source file in the Frontmatter

### Requirement 5: Template Compliance and Metadata

**User Story:** As a BA, I want standardized templates for Clean Layer documents, so that knowledge is consistent and machine-readable.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL define a markdown template for Clean_Layer documents that includes: Frontmatter block, summary section, main content with heading hierarchy, and references section
2. THE Knowledge_Vault SHALL require Frontmatter to contain the following fields: title, team, module, language (vi or en), tags (list), content_type, source_reference, date_created, and last_updated
3. WHEN a CI validation job runs on a Clean_Layer file, THE Knowledge_Vault SHALL validate the markdown structure against the defined template
4. WHEN a CI validation job runs on a Clean_Layer file, THE Knowledge_Vault SHALL validate that the Frontmatter conforms to the required schema
5. THE Knowledge_Vault SHALL support bilingual content by accepting language field values of "vi" (Vietnamese) or "en" (English) in the Frontmatter

### Requirement 6: Local Embedding Pipeline

**User Story:** As the Owner (designated builder), I want to run embedding locally using Ollama, so that the vault index stays current without requiring Docker or cloud services.

#### Acceptance Criteria

1. WHEN the Owner triggers a full re-embed, THE Embedding_Pipeline SHALL process all Clean_Layer markdown files using Ollama running locally
2. WHEN the Embedding_Pipeline processes a markdown file, THE Embedding_Pipeline SHALL chunk the document by heading and section boundaries
3. WHEN the Embedding_Pipeline chunks a document, THE Embedding_Pipeline SHALL preserve the Frontmatter metadata as attributes on each chunk
4. THE Embedding_Pipeline SHALL generate vector embeddings using a Bilingual_Model served by Ollama that supports both Vietnamese and English text
5. WHEN embeddings are generated, THE Embedding_Pipeline SHALL store the vectors in the local Vector_DB with metadata including source file path, chunk heading, team, module, language, and content_type
6. IF the Embedding_Pipeline fails to process a file, THEN THE Embedding_Pipeline SHALL log the error, skip the failed file, and continue processing remaining files
7. WHEN the Embedding_Pipeline completes, THE Embedding_Pipeline SHALL report a summary of files processed, chunks created, and any failures
8. THE Embedding_Pipeline SHALL operate entirely offline after the initial Ollama model download, requiring no network connectivity for embedding operations
9. WHEN a document is removed from the Clean_Layer, THE Embedding_Pipeline SHALL remove the corresponding vectors from the Vector_DB during the next re-embed cycle

### Requirement 7: Embedded Vector Database

**User Story:** As a BA, I want a local embedded vector database that requires only pip install, so that I can query knowledge offline without Docker or external services.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL use an embedded vector database (ChromaDB or LanceDB) installable via `pip install` with no Docker dependency
2. WHEN a BA installs the Knowledge Vault tooling, THE Vector_DB SHALL be available after running `pip install` without additional infrastructure setup
3. THE Knowledge_Vault SHALL provide a mechanism for BAs to import a pre-built embedding artifact into their local Vector_DB instance
4. WHEN the Owner publishes a new embedding artifact to GitLab, THE Knowledge_Vault SHALL provide a command for BAs to download and import the artifact into their local Vector_DB
5. THE Vector_DB SHALL support semantic similarity search across all indexed documents with metadata filtering by team, module, language, and content_type
6. WHEN a BA queries the Vector_DB after importing an artifact, THE Vector_DB SHALL return results without requiring network connectivity or VPN

### Requirement 8: MCP Server (Query Interface via IDE)

**User Story:** As a BA, I want to query the knowledge vault directly from my IDE using natural language, so that I can find information without leaving my development environment or learning special commands.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a local Python MCP server that bridges IDE tools (Cursor, Kiro, Windsurf) to the Knowledge Vault
2. THE MCP_Server SHALL expose the following tools: search_knowledge, create_draft, digest_document, suggest_tags, check_duplicates, validate_draft, and list_modules
3. WHEN an IDE reads the MCP configuration, THE MCP_Server SHALL auto-start and be available for the LLM to invoke tools based on BA natural language prompts
4. WHEN a BA submits a natural language query via the IDE, THE MCP_Server SHALL invoke search_knowledge to retrieve relevant document chunks from the Vector_DB using semantic similarity search
5. WHEN the MCP_Server returns search results, THE MCP_Server SHALL include citations referencing the Clean_Layer source file path and section heading
6. THE MCP_Server SHALL accept queries in both Vietnamese and English regardless of the language of the stored documents
7. WHEN a BA asks the IDE to create new content, THE MCP_Server SHALL invoke create_draft to generate content in the Drafts_Folder, not directly in the vault repository
8. THE MCP_Server SHALL operate entirely locally, requiring no network connectivity for search and draft operations after initial git sync

### Requirement 9: Drafts Workflow (Anti-Garbage Mechanism)

**User Story:** As a BA, I want MCP write operations to go to a staging area first, so that I can review content before it enters the vault repository.

#### Acceptance Criteria

1. WHEN the MCP_Server performs a write operation (create_draft, digest_document), THE MCP_Server SHALL place output files in the local Drafts_Folder which is located OUTSIDE the vault repository
2. WHEN a BA reviews a draft and approves it for submission, THE Knowledge_Vault SHALL provide a `kvault submit` command that moves the file from Drafts_Folder to the appropriate location in the vault repository
3. WHEN `kvault submit` is executed, THE Knowledge_Vault SHALL create a feature branch (`feature/{team-name}/{function-name}`) and commit the file to either the Raw_Layer or Clean_Layer based on content maturity
4. THE Knowledge_Vault SHALL enforce three layers of protection: drafts staging for BA self-review, validation gate on submit, and Merge_Request peer review
5. WHEN `kvault submit` targets the Clean_Layer, THE Knowledge_Vault SHALL run full template compliance and Frontmatter schema validation before committing
6. WHEN `kvault submit` targets the Raw_Layer, THE Knowledge_Vault SHALL run basic markdown validity and minimum metadata checks before committing
7. IF validation fails during `kvault submit`, THEN THE Knowledge_Vault SHALL report specific errors and keep the file in the Drafts_Folder for correction

### Requirement 10: Duplicate Detection

**User Story:** As a BA, I want the system to detect duplicate or overlapping content before submission, so that the vault remains clean and non-redundant.

#### Acceptance Criteria

1. WHEN a BA runs `kvault submit` or invokes the check_duplicates MCP tool, THE Knowledge_Vault SHALL check for duplicates using two methods: SimHash for exact/near-exact matches and vector similarity for semantic overlap
2. THE Knowledge_Vault SHALL allow configurable duplicate detection thresholds in `.kvault/config.yaml` for both SimHash distance and vector similarity score
3. WHEN duplicate detection runs, THE Knowledge_Vault SHALL execute entirely locally with zero token cost using pre-computed hashes and the local Vector_DB
4. IF duplicate content is detected, THEN THE Knowledge_Vault SHALL warn the BA with the overlap percentage and the source file path of the existing similar content
5. WHEN the overlap percentage exceeds the configured threshold, THE Knowledge_Vault SHALL block submission and require the BA to acknowledge or resolve the duplication before proceeding

### Requirement 11: Content Types System

**User Story:** As a team lead, I want configurable content types with associated templates, so that teams can standardize their documentation while maintaining flexibility.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL support content types configurable via `.kvault/content-types.yaml` including: process-doc, decision-log, meeting-notes, api-spec, glossary-entry, flow-diagram, and research-note
2. THE Knowledge_Vault SHALL define for each content type: a markdown template, required sections, and a default target layer (Raw_Layer or Clean_Layer)
3. WHEN a BA runs `kvault create --type <content-type>`, THE Knowledge_Vault SHALL generate a new markdown file from the corresponding template in the Drafts_Folder
4. THE Knowledge_Vault SHALL allow teams to add, modify, or remove content types by editing the `.kvault/content-types.yaml` configuration file
5. WHEN a file targets the Clean_Layer, THE Knowledge_Vault SHALL validate that the file contains all required sections defined by its content type
6. THE MCP_Server SHALL expose content type information through the list_modules tool so that BAs can discover available types from the IDE

### Requirement 12: LLM-Assisted Digest (Ollama Local)

**User Story:** As a BA, I want to use a local LLM to summarize and rewrite content, so that I can efficiently process large documents without incurring token costs.

#### Acceptance Criteria

1. WHEN a BA invokes the digest_document MCP tool with a file and mode parameter, THE MCP_Server SHALL use Ollama locally to process the document
2. THE MCP_Server SHALL support digest modes including: summarize, extract-decisions, rewrite-clean, and extract-action-items
3. WHEN digest processing completes, THE MCP_Server SHALL place the output in the Drafts_Folder for BA review before any further action
4. THE MCP_Server SHALL execute all LLM-assisted digest operations using Ollama locally with zero token cost
5. THE MCP_Server SHALL trigger digest operations only on explicit BA request, not automatically

### Requirement 13: Submit Rules (Raw vs Clean Target)

**User Story:** As a BA, I want clear guidance on whether content should go to Raw or Clean, so that I submit to the correct layer without confusion.

#### Acceptance Criteria

1. WHEN content is not template-compliant, is reference material, or is not yet mature, THE Knowledge_Vault SHALL target the Raw_Layer as the submission destination
2. WHEN content is template-compliant, has complete Frontmatter, the BA has confirmed accuracy, and the file passes validation, THE Knowledge_Vault SHALL target the Clean_Layer as the submission destination
3. WHEN a BA invokes `kvault submit`, THE MCP_Server SHALL analyze the content and suggest the appropriate target layer (Raw_Layer or Clean_Layer) based on compliance assessment
4. WHEN submitting to the Raw_Layer, THE Knowledge_Vault SHALL require: valid markdown syntax and minimum metadata (title, team, module)
5. WHEN submitting to the Clean_Layer, THE Knowledge_Vault SHALL require: full template compliance, complete Frontmatter schema, and content type validation

### Requirement 14: Designated Builder and Artifact Sharing

**User Story:** As the Owner, I want to periodically rebuild the full embedding index and share it with the team, so that new BAs can immediately query the vault without running embedding themselves.

#### Acceptance Criteria

1. WHEN the Owner triggers a full re-embed, THE Embedding_Pipeline SHALL process all Clean_Layer files and produce a complete Vector_DB artifact file
2. WHEN the re-embed completes, THE Knowledge_Vault SHALL provide a command to export the Vector_DB as a portable artifact file
3. WHEN the Owner uploads the artifact to GitLab (via artifacts directory or LFS), THE Knowledge_Vault SHALL make the artifact accessible to all team members with repository access
4. WHEN a new BA onboards, THE Knowledge_Vault SHALL provide a command to download the latest artifact from GitLab and import it into the local Vector_DB
5. WHEN a BA imports an artifact, THE Vector_DB SHALL be immediately queryable without requiring the BA to run any embedding operations locally
6. THE Knowledge_Vault SHALL require VPN connectivity only for the artifact download from GitLab; all subsequent query operations SHALL work offline

### Requirement 15: CI/CD Pipeline Validation

**User Story:** As a team lead, I want automated validation in the CI pipeline, so that non-compliant content is caught before review.

#### Acceptance Criteria

1. WHEN a Merge_Request is opened targeting a team branch or main branch, THE Knowledge_Vault SHALL run a CI validation job automatically
2. WHEN the CI validation job runs on Clean_Layer files, THE Knowledge_Vault SHALL check markdown syntax validity, template compliance, Frontmatter schema conformance, and content type validation
3. WHEN the CI validation job runs on Raw_Layer files, THE Knowledge_Vault SHALL check basic markdown syntax validity and minimum metadata presence
4. IF the CI validation job detects errors, THEN THE Knowledge_Vault SHALL report errors as inline comments on the Merge_Request
5. THE Knowledge_Vault SHALL complete CI validation within 5 minutes for repositories containing up to 1000 markdown files

### Requirement 16: Conversion Tool Usability

**User Story:** As a non-technical BA, I want the conversion tool to be simple to use, so that I can contribute knowledge without deep technical expertise.

#### Acceptance Criteria

1. THE Conversion_Tool SHALL provide a single-command interface for converting a file (e.g., `kvault convert <input-file> --team <team> --module <module>`)
2. THE Conversion_Tool SHALL auto-detect the input file format based on file extension
3. WHEN conversion is successful, THE Conversion_Tool SHALL display the output file path in the Drafts_Folder and a summary of converted elements (headings, tables, diagrams detected)
4. THE Conversion_Tool SHALL provide an installation method that requires no more than 3 steps on macOS and Linux (pip install based)
5. IF a BA runs the Conversion_Tool without required arguments, THEN THE Conversion_Tool SHALL display a help message listing available commands, required arguments, and usage examples

### Requirement 17: Training and Onboarding

**User Story:** As a BA with no GitLab experience, I want comprehensive training guides, so that I can use the Knowledge Vault effectively from day one.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL provide a full training guide for the BA team covering: GitLab basics, vault workflow, MCP usage, and content creation
2. THE Knowledge_Vault SHALL provide a step-by-step onboarding process for new BAs: clone repository → install kvault CLI → install Ollama → download embedding artifact → configure MCP in IDE → verify setup
3. THE Knowledge_Vault SHALL provide step-by-step guides for: creating a Merge_Request, reviewing a Merge_Request, and resolving merge conflicts
4. THE Knowledge_Vault SHALL provide a CI/CD setup guide for the Owner covering GitLab runner configuration and pipeline setup
5. WHEN a new BA completes the onboarding process, THE Knowledge_Vault SHALL provide a verification command (`kvault doctor`) that checks all components are correctly installed and configured

### Requirement 18: VPN and Offline Operations

**User Story:** As a BA, I want to clearly understand which operations require VPN, so that I can work efficiently both online and offline.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL require VPN connectivity only for git operations: pull, push, clone, and Merge_Request interactions with the self-hosted GitLab instance
2. THE Knowledge_Vault SHALL support fully offline operation for: embedding generation (via Ollama), vector search queries, draft creation, duplicate detection, content validation, and digest operations
3. WHEN a BA attempts a git operation without VPN connectivity, THE Knowledge_Vault SHALL display a clear error message indicating that VPN is required for this operation
4. THE Knowledge_Vault SHALL document the VPN requirement in all relevant training materials and onboarding guides

### Requirement 19: Vault Maintenance and Operations

**User Story:** As the Owner, I want maintenance tools and processes, so that the vault remains healthy and content stays fresh over time.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL track content freshness by recording last_updated dates in Frontmatter and flagging documents that have not been updated within a configurable period
2. WHEN a document exceeds the configured freshness threshold, THE Knowledge_Vault SHALL include the document in a stale content report accessible via `kvault report --stale`
3. THE Knowledge_Vault SHALL provide periodic review cycle tooling that assigns documents to BAs for freshness review based on team and module ownership
4. THE Knowledge_Vault SHALL provide a cleanup command (`kvault cleanup`) that identifies orphaned files, broken references, and documents missing required metadata
5. THE Knowledge_Vault SHALL provide effort estimation guidelines documenting expected time commitments for vault maintenance activities (weekly review, monthly cleanup, quarterly re-embed)

### Requirement 20: Vault Growth and Evolution

**User Story:** As the Owner, I want a clear growth roadmap, so that the vault can scale from 7 BAs to 30 BAs and evolve with additional capabilities.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL document a phased roadmap: Phase 1 (MVP with current scope) → Phase 2 (Knowledge Graph relationships, RBAC, advanced analytics)
2. THE Knowledge_Vault SHALL document scaling considerations for growing from 7 BAs to 30 BAs including: repository size limits, embedding artifact size, Vector_DB performance, and branch management complexity
3. THE Knowledge_Vault SHALL document content volume projections and thresholds at which the embedding approach should be upgraded (e.g., switching from full re-embed to incremental embedding)
4. THE Knowledge_Vault SHALL design the `.kvault/config.yaml` schema to be extensible for future features without breaking existing configurations

### Requirement 21: Vault Metrics and KPIs

**User Story:** As the Owner, I want measurable indicators for vault health and usage, so that I can track adoption, identify problems, and demonstrate value.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL track content metrics: total documents, documents per team, raw-to-clean ratio, and content freshness score
2. THE Knowledge_Vault SHALL track usage metrics: queries per BA per week, search hit rate (queries returning relevant results), and citation accuracy
3. THE Knowledge_Vault SHALL track quality metrics: Merge_Request approval rate, validation pass rate, and duplicate detection rate
4. THE Knowledge_Vault SHALL track growth metrics: new documents per sprint, active contributors, and coverage percentage per module
5. THE Knowledge_Vault SHALL track maintenance metrics: stale document count, average time-to-review, and sync frequency per BA
6. THE Knowledge_Vault SHALL provide a `kvault metrics` command that generates a dashboard report of all tracked KPIs
7. THE Knowledge_Vault SHALL store metrics data locally and aggregate team-level metrics when the Owner runs a collection cycle

### Requirement 22: Inter-Layer Data Pipeline Rules

**User Story:** As a BA, I want clear rules governing how data moves between the three layers (Raw, Clean, Index), so that I understand what actions and validations are required at each transition.

#### Acceptance Criteria

1. WHEN a BA converts a source document to the Drafts_Folder, THE Knowledge_Vault SHALL auto-detect the file format and produce markdown output without requiring the BA to specify format-specific conversion options
2. WHEN a BA submits content from Drafts_Folder targeting the Raw_Layer, THE Knowledge_Vault SHALL enforce the following validation rules: valid markdown syntax AND minimum frontmatter metadata (title, team, module)
3. WHEN a BA submits content from Drafts_Folder targeting the Clean_Layer, THE Knowledge_Vault SHALL enforce the following validation rules: full template compliance AND complete frontmatter schema (all 9 required fields) AND required sections present for the declared content_type AND language field is valid (vi or en)
4. WHEN a BA promotes content from Raw_Layer to Clean_Layer via Merge_Request, THE Knowledge_Vault SHALL enforce the same validation rules as direct Clean_Layer submission AND SHALL require the frontmatter to include a raw_source_path field referencing the original Raw_Layer file
5. WHEN the Owner triggers embedding from Clean_Layer to Index_Layer, THE Embedding_Pipeline SHALL process ONLY files in the Clean_Layer directory, ignoring all Raw_Layer content
6. THE Knowledge_Vault SHALL enforce the following gates at each transition: Drafts→Raw requires duplicate detection pass; Drafts→Clean requires duplicate detection AND CI validation AND peer review AND Team_Lead approval; Raw→Clean requires CI validation AND peer review AND Team_Lead approval; Clean→Index requires Owner authorization
7. WHEN a file fails any validation rule during a layer transition, THE Knowledge_Vault SHALL block the transition and return specific error messages identifying which rules failed and how to fix them
8. THE Knowledge_Vault SHALL NOT allow any content to bypass a layer transition — content cannot move directly from Source to Raw without passing through Drafts, and cannot move from Raw to Index without passing through Clean

### Requirement 23: Data Standardization Rules and Enforcement

**User Story:** As a team lead, I want all BAs to produce consistently structured documents regardless of who writes them, so that knowledge is uniform, searchable, and maintainable across all teams.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL enforce document structure standardization through content type definitions in `.kvault/content-types.yaml`, where each content type specifies required sections that ALL documents of that type must contain regardless of which BA or team creates them
2. THE Knowledge_Vault SHALL enforce metadata standardization through the frontmatter schema in `.kvault/schemas/frontmatter.schema.yaml`, requiring all Clean_Layer documents to use identical field names, value formats (kebab-case for team/module, ISO 8601 for dates, enum for language), and validation rules
3. THE Knowledge_Vault SHALL enforce naming convention standardization: team names and module names in kebab-case, file names in kebab-case, branch names following the pattern `feature/{team-name}/{function-name}`
4. WHEN a BA creates a new document using `kvault create --type <content-type>`, THE Knowledge_Vault SHALL generate the document from the corresponding template in `.kvault/templates/`, pre-filling frontmatter fields (team, module, content_type, date_created) and providing placeholder text in each required section explaining what content belongs there
5. THE Knowledge_Vault SHALL enforce standardization rules automatically through CI pipeline validation on every Merge_Request, ensuring no non-compliant document can be merged into team branches or main branch
6. WHEN the Owner or Team_Lead updates standardization rules (content-types.yaml, templates, or schemas), THE Knowledge_Vault SHALL validate the configuration change via CI before allowing the merge, and SHALL NOT retroactively invalidate existing documents already in the Clean_Layer
7. THE Knowledge_Vault SHALL provide a `kvault lint` command that checks a local file against all standardization rules (template compliance, frontmatter schema, naming conventions) and reports violations with specific fix suggestions, allowing BAs to self-check before submitting
8. THE Knowledge_Vault SHALL store all standardization rules in the `.kvault/` directory of the repository so that rules are version-controlled, reviewable via MR, and automatically distributed to all BAs on `kvault sync`

### Requirement 24: Agent Skills System (Shared AI Behavior)

**User Story:** As the Owner, I want to define shared AI agent skills that synchronize across all BAs via GitLab, so that every BA's IDE agent behaves consistently when interacting with the Knowledge Vault — following the same search patterns, content creation rules, review standards, and domain context.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL store agent skill definitions as markdown files in the `.kvault/skills/` directory of the GitLab repository, version-controlled and distributable via `kvault sync`
2. THE Knowledge_Vault SHALL provide the following default agent skills: vault-search (how to search and cite from vault), content-creation (how to create documents following templates and rules), review-assist (how to help review MRs for compliance), submit-workflow (how to guide BA through the submit process), digest-rules (how to summarize and extract content consistently), and team-context (domain knowledge about core banking/lending, team structure, module ownership)
3. WHEN a BA runs `kvault sync`, THE Knowledge_Vault SHALL update the local agent skills from the repository, ensuring the IDE agent uses the latest skill definitions
4. THE Knowledge_Vault SHALL format agent skills as IDE-compatible steering files (markdown with front-matter specifying inclusion rules: always-on, file-match patterns, or manual activation)
5. WHEN the Owner or Team_Lead updates an agent skill file via Merge_Request, THE Knowledge_Vault SHALL validate the skill file format via CI before allowing the merge
6. THE Knowledge_Vault SHALL support team-specific skill overrides by allowing files in `.kvault/skills/teams/{team-name}/` that extend or override default skills for specific team contexts
7. WHEN an agent skill references vault content (e.g., glossary terms, process names, module lists), THE Knowledge_Vault SHALL support dynamic references that resolve to current vault state rather than hardcoded values
8. THE Knowledge_Vault SHALL provide a `kvault skills list` command that displays all available agent skills with their descriptions and activation rules
9. THE Knowledge_Vault SHALL ensure agent skills are loaded by the MCP_Server configuration so that IDE agents automatically have access to skill-defined behaviors when interacting with the Knowledge Vault tools
10. WHEN a new BA completes onboarding, THE Knowledge_Vault SHALL include agent skills setup as part of the MCP configuration, requiring no additional manual configuration for skills to take effect

### Requirement 25: Clean Data Definition and Versioning

**User Story:** As a BA, I want a clear definition of what constitutes Clean Data and how versions are tracked, so that I understand what qualifies for the Clean Layer and my contributions are never lost during refactoring.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL define Clean Data as any markdown document that meets ALL three conditions: follows the template structure for its content type, has complete frontmatter metadata (all 9 required fields), and has been confirmed as accurate by the authoring BA — regardless of whether it originated from conversion or was written directly
2. THE Knowledge_Vault SHALL track document versions using a `version` field in frontmatter (format: "X.Y") and a `changelog` array recording version history (version, date, author, summary) within the same file
3. WHEN a BA updates an existing Clean Layer document, THE Knowledge_Vault SHALL require the BA to increment the version number and add a changelog entry describing the change
4. THE Knowledge_Vault SHALL preserve all previous versions in git history, ensuring no BA contribution is ever lost even when documents are refactored or restructured
5. WHEN a document is refactored (split, merged, or restructured), THE Knowledge_Vault SHALL require the new document(s) to reference the original document path in a `supersedes` frontmatter field
6. THE Knowledge_Vault SHALL NOT allow deletion of Clean Layer documents without Owner approval; deprecated documents SHALL have their status changed to "superseded" with a reference to the replacement document

### Requirement 26: Cross-Team Impact Detection and Notification

**User Story:** As a BA on team B, I want to be automatically notified when team A updates a document that impacts my module, so that I can review and update my own documentation without needing direct communication.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL support an `impacts` field in frontmatter containing an array of objects with team, module, and reason fields identifying which other teams are affected by this document
2. WHEN a Merge_Request modifies a document containing an `impacts` field, THE Knowledge_Vault CI pipeline SHALL automatically tag the leads of impacted teams as reviewers on the MR with a comment explaining the impact
3. THE Knowledge_Vault SHALL require impacted team leads to acknowledge the MR (comment "acknowledged") but SHALL NOT require their approval to merge
4. WHEN a BA creates or updates a document, THE MCP_Server suggest_tags tool SHALL also suggest potential impact relationships based on cross-references and module dependencies found in the vault
5. THE Knowledge_Vault SHALL provide a `kvault report --impacts` command that shows all pending impact notifications that a team has not yet acknowledged

### Requirement 27: Agent Auto-Setup and Session Management

**User Story:** As a BA, I want the agent to automatically detect and set up the Knowledge Vault environment when I first open the project, and proactively manage my session (including push prompts), so that I can focus on content work without worrying about technical setup or git operations.

#### Acceptance Criteria

1. WHEN a BA opens a project containing `.kvault/config.yaml` for the first time, THE MCP_Server SHALL detect the Knowledge Vault project and check if all required tools are installed (kvault CLI, Ollama, embedding model, Vector DB, drafts folder)
2. IF any required tool is missing, THE MCP_Server SHALL offer step-by-step guided installation, requesting BA approval before each step that requires system changes or significant downloads
3. WHEN all setup steps complete, THE MCP_Server SHALL run a verification check equivalent to `kvault doctor` and report the result to the BA
4. WHEN a BA has unpushed changes at natural conversation breaks (session end, idle, or explicit "done"), THE MCP_Server SHALL proactively ask the BA if they want to push changes to GitLab
5. THE MCP_Server SHALL NEVER auto-push without explicit BA confirmation
6. WHEN a push fails due to VPN unavailability, THE MCP_Server SHALL inform the BA that changes are saved locally and suggest pushing when VPN is available
7. WHEN an operation fails, THE MCP_Server SHALL first attempt to suggest a fix from the troubleshooting guide; if unresolvable, SHALL advise the BA to contact the Owner for support

### Requirement 28: Template Evolution Framework

**User Story:** As the Owner, I want a framework for evolving templates over time without breaking existing documents, so that the vault can improve its standards while respecting historical content.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL maintain a `template-changelog.md` file in `.kvault/` that records all template changes with date, description, and migration guidance
2. WHEN a template is updated (new required sections added, sections renamed, or structure changed), THE Knowledge_Vault SHALL NOT retroactively invalidate existing Clean Layer documents that were compliant under the previous template version
3. THE Knowledge_Vault SHALL support a `template_version` field in frontmatter that records which template version the document was created with
4. WHEN the Owner wants existing documents to adopt a new template version, THE Knowledge_Vault SHALL provide migration guidance in the template-changelog.md describing what changes are needed
5. THE Knowledge_Vault SHALL provide a `kvault migrate --template <content-type>` command that identifies documents using outdated template versions and optionally applies automated migrations where possible
6. WHEN CI validates a document, THE Knowledge_Vault SHALL validate against the template version recorded in the document's frontmatter, not the latest template version, unless the document has been explicitly migrated

---

## v2 Requirements (2026-05-25)

> **Source**: Arkon comparative analysis + embedding pipeline audit + stock market stack review
> **Principles**: All v2 requirements must comply with design principles P1-P7 defined in v1.
> **Status**: Planned — chưa implement
> **Horizon**: Hết tháng 7/2026 (corpus dự kiến ~1770 chunks, x3 baseline)

### Requirement 29: Embedding Determinism

**User Story:** As the Owner, I want all BAs to have identical search results regardless of who ran the embedding, so that knowledge retrieval is consistent across the team.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL store a `model_digest` field in `.kvault/config.yaml` containing the pinned SHA256 hash of the embedding model (e.g., `nomic-embed-text@sha256:...`)
2. WHEN a BA runs `kvault doctor`, THE Knowledge_Vault SHALL compare the local Ollama model digest against the pinned `model_digest` in config and display a warning if they do not match
3. WHEN a BA runs `kvault embed` with a mismatched model digest, THE Knowledge_Vault SHALL display a warning advising the BA to contact the Owner for an updated artifact, but SHALL NOT block the operation
4. THE Knowledge_Vault SHALL track embedding artifacts via Git LFS by including `artifacts/*.tar.gz filter=lfs` in `.gitattributes`
5. WHEN the Owner exports an artifact, THE Knowledge_Vault SHALL record the model digest used for embedding in the artifact metadata

### Requirement 30: Search Quality — Task Prefix

**User Story:** As a BA, I want search results to be more accurate, so that I spend less time filtering irrelevant results.

#### Acceptance Criteria

1. WHEN the Embedding_Pipeline embeds a document chunk, THE Embedding_Pipeline SHALL prepend the text `search_document: ` before the chunk content prior to calling the Ollama embedding API
2. WHEN the MCP_Server or Vector_DB processes a search query, THE Knowledge_Vault SHALL prepend the text `search_query: ` before the query text prior to calling the Ollama embedding API
3. THE Knowledge_Vault SHALL support a `embedding.task_prefix` boolean field in `.kvault/config.yaml` to enable or disable task prefix behavior (default: true)
4. WHEN task prefix is enabled or disabled, THE Knowledge_Vault SHALL require a full re-embed to ensure consistency between document and query vectors
5. THE Knowledge_Vault SHALL document the re-embed requirement in release notes when upgrading from v1 to v2

### Requirement 31: Search Quality — Heading Context Injection

**User Story:** As a BA, I want search to find documents even when my query terms only appear in parent headings, so that I don't miss relevant content nested under broader topics.

#### Acceptance Criteria

1. WHEN the Embedding_Pipeline prepares a chunk for embedding, THE Embedding_Pipeline SHALL inject the heading hierarchy as a context prefix in the format `[Context: {heading_hierarchy}]\n` before the chunk text
2. THE Knowledge_Vault SHALL use the existing `heading_hierarchy` field from the Chunk dataclass as the source for the context prefix
3. WHEN search results are returned, THE Knowledge_Vault SHALL display the original chunk text WITHOUT the injected context prefix — the prefix is used only for embedding quality
4. THE Knowledge_Vault SHALL NOT modify the LanceDB schema — the `text` field SHALL continue to store the original unmodified chunk text
5. WHEN heading context injection is applied, THE Knowledge_Vault SHALL require a full re-embed, batched together with REQ-30 (task prefix)

### Requirement 32: Embedding Truncation Limit

**User Story:** As the Owner, I want the embedding truncation limit to match the model's actual capability, so that long chunks are not silently cut short.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL read the truncation limit from `embedding.max_chars` in `.kvault/config.yaml` (default: 12000)
2. WHEN the Embedding_Pipeline encounters text exceeding `max_chars`, THE Embedding_Pipeline SHALL truncate the text and log a warning message including the original length and the truncated length
3. THE Knowledge_Vault SHALL increase the default truncation limit from 4000 characters to 12000 characters, which is safe for nomic-embed-text's 8192 token context window accounting for Vietnamese character density
4. WHEN the embedding model is changed in the future, THE Owner SHALL be able to adjust `max_chars` in config without code changes

### Requirement 33: Preflight Quality Gate

**User Story:** As a BA, I want a single command that checks my document for all issues before submission, so that I don't waste time on MRs that will be rejected.

#### Acceptance Criteria

1. THE Knowledge_Vault SHALL provide a `kvault preflight <file>` command that runs three checks sequentially: (1) Schema validation, (2) Link integrity, (3) Duplicate detection
2. WHEN preflight completes, THE Knowledge_Vault SHALL display a unified report summarizing results per check (e.g., `✅ Schema OK`, `⚠️ 2 broken links`, `✅ No duplicates`)
3. THE Knowledge_Vault SHALL return exit code 0 if all checks pass and exit code 1 if any check fails, enabling CI pipeline integration
4. WHEN a BA runs `kvault submit`, THE Knowledge_Vault SHALL automatically run preflight before proceeding; if preflight fails, submission SHALL be blocked unless the BA passes `--force`
5. Link integrity checking SHALL verify that `[[wikilinks]]` and `[text](path.md)` references point to files that exist in the repository
6. THE Knowledge_Vault SHALL NOT include LLM-based quality checks (L4) in preflight at this stage — scope is limited to deterministic checks only

### Requirement 34: Source Provenance

**User Story:** As a BA, I want to trace any clean document back to its raw source files, so that I can verify the original context when questions arise.

#### Acceptance Criteria

1. WHEN `kvault mine` processes raw files into clean documents, THE Knowledge_Vault SHALL automatically populate a `sources:` list in the clean document's frontmatter containing the relative paths of all raw source files used
2. WHEN a BA runs `kvault doctor`, THE Knowledge_Vault SHALL flag clean documents that do not have a `sources` field with a warning (not an error)
3. WHEN the MCP_Server returns search results, THE MCP_Server SHALL include the `sources` field from frontmatter in the result metadata, enabling the agent to cite original source files
4. THE Knowledge_Vault SHALL NOT require retroactive addition of `sources` to existing clean documents — only newly mined documents SHALL have this field

### Requirement 35: GitLab CI Enhancement

**User Story:** As the Owner, I want the CI pipeline to automatically validate documents and regenerate the dashboard, so that quality is enforced and metrics are always current.

#### Acceptance Criteria

1. WHEN a Merge_Request is opened, THE Knowledge_Vault CI pipeline SHALL run `kvault-ci preflight` on all changed markdown files in `raw/` and `clean/` directories
2. IF any file fails preflight in CI, THE Knowledge_Vault SHALL block the Merge_Request merge until all issues are resolved
3. WHEN a merge to main branch completes, THE Knowledge_Vault CI pipeline SHALL auto-generate `dashboard.html` and `metrics.json` as pipeline artifacts
4. THE Knowledge_Vault CI pipeline SHALL NOT run embedding operations — embedding remains a manual Owner-only operation (P4 compliance)
5. THE Knowledge_Vault CI pipeline SHALL use `image: python:3.11-slim` on the existing GitLab shared runner with Docker executor
6. THE Knowledge_Vault CI pipeline SHALL install only CI-tier dependencies (`pip install ".[ci]"`) to minimize pipeline execution time

### Requirement 36: MCP Read Document Tool

**User Story:** As a BA using the IDE agent, I want to read the full content of a document found via search, so that I don't have to manually navigate to the file after finding a relevant snippet.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a `read_document` tool that accepts a `source_path` parameter and returns the full markdown content and frontmatter metadata of the specified file
2. THE MCP_Server SHALL increase the search result `content` field from 500 characters to 800 characters to provide better context before full document retrieval
3. THE `read_document` tool SHALL read files from the local filesystem only (P1 compliance), using the `source_path` returned in search results
4. IF the specified file does not exist, THE `read_document` tool SHALL return a clear error message

### Requirement 37: Search Diversity — MMR Reranking

**User Story:** As a BA, I want search results to come from diverse documents rather than multiple chunks of the same file, so that I get a broader view of relevant knowledge.

#### Acceptance Criteria

1. WHEN the Vector_DB performs a search, THE Vector_DB SHALL apply Maximal Marginal Relevance (MMR) reranking after initial cosine similarity retrieval
2. THE Knowledge_Vault SHALL support a `search.mmr_lambda` configuration field in `.kvault/config.yaml` (default: 0.5) controlling the diversity-relevance trade-off (1.0 = pure cosine, 0.0 = maximum diversity)
3. WHEN MMR is applied, THE Vector_DB SHALL return no more than 2 chunks from the same `source_path` in the top-5 results
4. THE MMR reranking SHALL be implemented within `vectordb.search()` transparently — callers (MCP_Server, CLI) SHALL NOT need modification
5. THE MMR implementation SHALL use only built-in Python or numpy operations, requiring no additional dependencies

### Requirement 38: Dashboard BOD Upgrade

**User Story:** As the Owner, I want a dashboard that is professional enough to present to the Board of Directors, so that I can demonstrate the vault's value and adoption metrics to leadership.

#### Acceptance Criteria

1. THE Knowledge_Vault dashboard SHALL include an Executive Summary section at the top displaying 4 BOD-level KPIs: (1) Total knowledge articles, (2) Module coverage percentage, (3) Active contributors this month, (4) Average docs per BA
2. THE Knowledge_Vault dashboard SHALL include a Knowledge Conversion Funnel visualization showing the progression from Raw files → Clean documents → Indexed chunks
3. THE Knowledge_Vault dashboard SHALL include a Team Contribution Heatmap displaying a grid of Team × Month with document counts, highlighting teams with zero contributions
4. THE Knowledge_Vault dashboard SHALL include a Document Freshness Health donut chart categorizing documents as Fresh (<90 days), Aging (60-90 days), or Stale (>90 days) using `freshness.py` data
5. THE Knowledge_Vault dashboard SHALL include MR Pipeline Velocity metrics showing average time from MR open to merge, sourced from GitLab API via `$CI_JOB_TOKEN` in CI or estimated from git log locally
6. THE Knowledge_Vault dashboard SHALL support a print mode activated via `?print=1` URL parameter with CSS `@media print` rules that apply white background, hide navigation elements, and insert page breaks between sections
7. THE Knowledge_Vault dashboard SHALL export all metrics data as `artifacts/metrics.json` including the new BOD sections data
8. THE Knowledge_Vault dashboard SHALL remain a static HTML file using Chart.js (CDN), requiring no server infrastructure (P1 compliance)
9. THE BOD sections SHALL be additive — existing Owner view sections SHALL remain unchanged

---

## Backlog (Post v2, tháng 7+)

### Obsidian Reader UI

**Problem**: Managers, stakeholders, and BAs who haven't set up IDE+Ollama cannot browse vault content. GitLab web UI is functional but poor UX for non-technical readers.

**Solution**: Use Obsidian (free desktop app) to open `clean/` as a vault. Provides:
- Graph view (= Knowledge Graph visualization for free)
- Full-text search
- Wikilink navigation between documents
- Frontmatter rendering
- Mermaid diagram support

**Setup** (5 steps, no coding needed):
1. Clone repo: `git clone ...`
2. Install Obsidian: https://obsidian.md
3. Open as vault: File → Open vault → select `clean/` folder
4. Browse, search, navigate
5. `kvault sync` to update content

**Status**: Backlog — no code changes needed. Write onboarding guide after v2 implementation.

---

## Implementation Specs Index

| Batch | File | REQs | Priority |
|---|---|---|---|
| 1 | `_blueprint/impl-batch-1-search-quality.md` | REQ-30, 31, 32 | P0 |
| 2 | `_blueprint/impl-batch-2-governance.md` | REQ-29, 33, 37 | P1 |
| 3 | `_blueprint/impl-batch-3-traceability.md` | REQ-34, 36 | P2 |
| 4 | `_blueprint/impl-batch-4-dashboard.md` | REQ-38 | P2 |
| 5 | `_blueprint/impl-batch-5-ci.md` | REQ-35 | P3 |

