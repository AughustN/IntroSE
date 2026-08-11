# Plan: Bring the assistant onto a full RAG architecture

**Feature**: `008-ai-chatbot` (evolution) | **Date**: 2026-08-11 | **Status**: Draft, needs three decisions

**Input**: "Hướng dẫn xây dựng RAG chatbot từ A-Z" — Việt Nguyễn AI ([youtube.com/watch?v=_F7Gnmk5Ta4](https://www.youtube.com/watch?v=_F7Gnmk5Ta4)), which builds a basic RAG chatbot with LangChain; plus the shipped assistant in `server/src/modules/ai/`.

## What this plan is based on, and what it is not

The video could not be watched. Title, channel and description were read from the page; the transcript is not reachable — YouTube's caption endpoint now answers signed requests only, and the transcript panel would not open under automation. No companion repository for this video was found.

So this plan is written against the **canonical LangChain RAG pipeline**, which the description names explicitly and which is what "RAG từ A-Z" tutorials teach:

```
load documents → split into chunks → embed → vector store
                                                 ↓
question → embed → similarity search (top-k) → prompt template → LLM → answer
```

Where the video's specific choices matter — chunk size, which vector store, `RetrievalQA` versus LCEL, whether it keeps chat memory — this plan states an assumption rather than pretending to quote it. **If you can tell me the stack it uses (FAISS? Chroma? which embedding model? LCEL?), the affected sections change and nothing else does.**

## The honest assessment first

The tutorial architecture is built for **unstructured documents** — PDFs, articles, a knowledge base. TixHub's knowledge is **structured rows in Postgres with live business rules**. Copying the pipeline wholesale would lose three properties the shipped system has and the constitution requires:

1. **Eligibility would stop being a hard gate.** Today `status='on_sale' AND moderation_status='approved' AND organizer approved AND upcoming AND has availability` is a `WHERE` clause; SC-003 tests it with zero tolerance. A vector store holds text as it was at index time and does not know an event sold out five minutes ago. Retrieve-then-answer would offer sold-out and cancelled events.
2. **Facts would come from chunks instead of rows.** Today the model returns *ids only* and the server attaches the database record, so a displayed price is the live price. Read out of an embedded chunk, it is the price at index time. This is Principle III's "grounded" requirement, and it is structural today rather than a promise in a prompt.
3. **Freshness becomes a pipeline to run.** Every event edit, every sale, every showtime change would need re-indexing, and a missed run is a wrong answer nobody notices.

So: **adopt what the tutorial teaches that we lack; keep what would break.** That is what "giữ được gì thì giữ" means here, and the split below is deliberate rather than lazy.

## What the tutorial has that we genuinely lack

| Tutorial stage | Do we have it? | Gap |
|---|---|---|
| Document loading | Yes — SQL projection | — |
| **Chunking** | **No** | A long description becomes one diluted tsvector. A 2000-word blurb about a festival ranks worse on its own subject than a 6-word title. |
| **Embeddings** | **No** | The real gap. "nhạc buồn nhẹ nhàng cuối tuần" shares **no token** with "Đêm nhạc Trịnh Công Sơn". Lexical search cannot bridge meaning; this is exactly what dense retrieval is for. |
| **Vector store** | **No** | `pgvector 0.8.1` is installed and unused. |
| Retriever | Partly | `candidates()` ranks, but strategy is welded into one SQL string — a second strategy cannot be added or A/B'd. |
| **Prompt template** | Weak | A `.join(' ')` of string literals inside the provider. Not versioned, not testable on its own, not swappable. |
| Chain / stages | Implicit | The stages exist in `chat()` as inline code rather than as named, individually testable steps. |
| **Memory** | Yes | Bounded 8-turn window, client-held. Already better than most tutorials, which keep unbounded history server-side. |
| Grounding / citations | Yes, stronger | Id-only + DB lookup. Most tutorials cite chunk text and inherit its staleness. |

## The blocker you need to know about

**The configured gateway serves no embedding model.** Tested `text-embedding-3-small`, `text-embedding-ada-002`, `bge-m3`, `embedding-2` against `api.vilao.ai`: all four return

```
403 FORBIDDEN — Please subscribe to model in the API Key: <model>
```

Dense retrieval is the heart of the tutorial and it cannot run on the current key. Three ways out, and this is **decision 1**:

- **A — Local embedding model in Node.** `@xenova/transformers` running a multilingual sentence encoder (`paraphrase-multilingual-MiniLM-L12-v2`, 384 dims, ~120 MB) on CPU. No API, no per-call cost, no rate limit, works offline, and Vietnamese is covered. Indexing ~500 events is a one-off of a few minutes; a question embeds in tens of milliseconds. Costs one npm dependency and ~200 MB of RSS — against `PERF-07`'s < 450 MB backend budget, which needs measuring before committing.
- **B — Subscribe to an embedding model** on `vilao.ai` (or use a real OpenAI key). One config line, no new dependency, but every question then makes **two** external calls — and the chat call is already blowing the 8-second budget.
- **C — Ship the hybrid without the dense half.** Keep the lexical retrieval already built, take the chunking, retriever, prompt and chain restructuring below, and add vectors when a model exists. Nothing is wasted: the retriever interface is designed for exactly this.

**Recommendation: A.** It removes the external dependency instead of adding one, it is free, and it is the only option that does not make the latency problem worse.

## Decision 2 — LangChain itself, or only its architecture

The video uses LangChain. Using it here means `@langchain/core` + `@langchain/community` + an embeddings package + a vector store package, in an Express server whose entire AI surface is currently one interface, one class and ~200 lines of service.

What LangChain would actually give us, against what we would write by hand:

| | LangChain | By hand |
|---|---|---|
| Text splitter | `RecursiveCharacterTextSplitter` | ~30 lines |
| Vector store | `PGVectorStore` | one SQL query with `<=>` |
| Prompt template | `ChatPromptTemplate` | a typed function |
| Chain | LCEL | the `chat()` function we have |
| Retriever interface | `BaseRetriever` | the interface in this plan |

The constitution's Principle V is explicit that complexity is spent only where a requirement demands it, and its integration list is capped. **Recommendation: adopt the architecture, not the framework.** Every box above is a few dozen lines against a framework whose value is portability across vendors we do not use. If you want LangChain because the coursework or the video expects to see it, say so — that is a legitimate reason and it changes only how the same stages are written.

## Decision 3 — what the retrieved unit is

The tutorial retrieves **chunks**. We must ultimately answer with **events**. Proposal: chunk for retrieval, aggregate to events for answering — a chunk hit scores its parent event, an event's score is its best chunk. Retrieval stays fine-grained, the answer stays an event, and grounding is untouched.

## Target architecture

```
                        ┌─ lexical retriever  (tsvector + trigram)   ← built, keep
question + recent turns ─┤                                            → fuse (RRF) → top-K events
                        └─ dense retriever    (pgvector cosine)      ← new
                                                    ↓
                          eligibility gate: visible ∧ upcoming ∧ available   ← WHERE, never scoring
                                                    ↓
                          prompt template (versioned) → LLM → ids + prose
                                                    ↓
                          grounding: ids → live DB rows                       ← keep, untouched
```

Two properties survive intact and they are the ones that matter: the eligibility gate stays a `WHERE` clause that relevance can never outrank, and the model still returns ids rather than facts.

### Stage 1 — Chunking and the index

New table `event_chunks`:

| Field | Type | Rules |
|---|---|---|
| `id` | `BIGSERIAL` | Primary key. |
| `event_id` | `BIGINT` | FK to `events`, `ON DELETE CASCADE`. |
| `ordinal` | `INT` | Position within the event. |
| `kind` | `TEXT` | `title` \| `lineup` \| `description` \| `venue` — lets a title chunk be weighted above a blurb chunk. |
| `content` | `TEXT` | The chunk text. |
| `embedding` | `vector(384)` | Null until embedded; nullable on purpose so option C ships. |
| `indexed_at` | `TIMESTAMPTZ` | Feeds the staleness sweep. |

- Splitter: recursive, ~400 characters with ~80 overlap, split on paragraph → sentence → word. Vietnamese sentences are short; 400 keeps a chunk to a few sentences.
- HNSW index on `embedding` (`vector_cosine_ops`), added only once embeddings exist — an empty vector index costs writes and retrieves nothing.
- Re-index trigger: `updated_at` on the event moves → chunks marked stale → a small worker re-embeds. Reuses the notification-worker pattern already in the codebase, including the `.catch()` discipline added this week.

### Stage 2 — Retriever interface

```ts
export interface Retriever {
  readonly name: string;
  retrieve(query: RetrievalQuery, limit: number): Promise<ScoredEvent[]>;
}
```

`LexicalRetriever` wraps the SQL already written. `DenseRetriever` embeds the question and runs a cosine query over `event_chunks`. `HybridRetriever` fuses both with **Reciprocal Rank Fusion** — `score = Σ 1/(k + rank)`, k=60 — which needs no score normalisation between two scales that are not comparable, and is what the current hand-tuned `0.4`/`0.3` weights are a poor substitute for.

The eligibility predicate stays in every retriever's `WHERE`, not in the fusion. That is the invariant.

### Stage 3 — Prompt as a versioned artifact

Move the system prompt out of the provider into `server/src/modules/ai/prompts/chat.ts`: a typed builder with an exported `PROMPT_VERSION`. The version goes into the cache key, so changing the prompt invalidates cached answers instead of serving answers produced under the old rules — a bug the current cache has today and nobody has hit yet.

### Stage 4 — Named stages

Split `chat()` into `retrieve → build → generate → ground`, each exported and separately testable. Behaviour identical; what changes is that a retrieval regression can be caught without standing up a provider double.

## What is explicitly kept

- The eligibility gate, unchanged and still tested by SC-003.
- Id-only grounding and the live-row lookup.
- The bounded, unpersisted 8-turn conversation window.
- Per-user allowance, platform ceiling, cache-before-allowance ordering.
- Every degradation path and its test.
- The lexical retriever — it becomes one input to fusion rather than the only one, and it is what keeps the assistant working on exact names, which is where dense retrieval is weakest.

## Sequencing

| Stage | Depends on | Ships without embeddings? |
|---|---|---|
| 1 Chunking + table | — | Yes — chunks improve lexical ranking on their own |
| 2 Retriever interface + RRF | 1 | Yes |
| 3 Prompt versioning | — | Yes |
| 4 Named stages | 2 | Yes |
| 5 Dense retriever | Decision 1 | No |
| 6 Re-index worker | 5 | No |

Stages 1–4 are worth doing whichever way decision 1 goes.

## Risks

- **PERF-07 memory budget.** Option A loads a model into the API process. Measure RSS before committing; if it breaches, run embedding as a separate one-off script rather than in the request process.
- **Latency.** Dense retrieval adds an embed step per question (~20–50 ms locally). Negligible beside a model that currently takes 14–23 s — which remains the unresolved problem from the previous discussion and is not fixed by anything in this plan.
- **Index staleness.** A stale chunk is a wrong retrieval, not a wrong fact, because grounding still reads live rows. That containment is the reason the id-only design is worth keeping.
- **Coursework fit.** If the assignment expects to see LangChain, decision 2 should go the other way regardless of engineering merit. Say so and I will write it with LangChain.

## Open questions for you

1. Which embedding source — local model (A), subscribe (B), or defer (C)?
2. LangChain the framework, or the architecture written by hand?
3. Do you know the video's stack? Vector store, embedding model, chunk size, LCEL or `RetrievalQA` — any of it narrows the guesswork above.
