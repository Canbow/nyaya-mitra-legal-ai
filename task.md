# RAG Pipeline Implementation Checklist

- `[x]` 1. Install Dependencies
  - `[x]` Add `pgvector` to `requirements.txt`
  - `[x]` (User handles pip install)
- `[x]` 2. Setup Vector Database Schema (`models.py`)
  - `[x]` Define `KnowledgeBaseLaw` model with `VectorField`
  - `[x]` Create Django datamigration for vector extension
- `[x]` 3. Implement RAG Logic (`views.py`)
  - `[x]` Add embedding extraction with `text-embedding-004` (switched to gemini-embedding-001)
  - `[x]` Fetch most similar `KnowledgeBaseLaw` using `CosineDistance`
  - `[x]` Update Gemini Augmented Generation prompt with Retrieved Law Context
- `[x]` 4. Setup Law Data Ingestion
  - `[x]` Write Django management command `load_laws` to chunk standard law text and generate embeddings for them
