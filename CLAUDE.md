# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal web app that receives supplier quotations as PDFs, extracts line items via Gemini, reconciles supplier product names against the company's internal catalog, and generates the official Purchase Order document with an atomic yearly consecutive number. Full functional spec (data model, business rules, flow) lives in [INSTRUCCIONS.MD](INSTRUCCIONS.MD) — read it before implementing any business logic.

**Current state:** implemented end to end — supplier Excel import (`services/importacion_proveedores.py` → `POST /importacion/importar-proveedores`), official catalog Excel import (`services/importacion_catalogo.py` → `POST /importacion/importar-catalogo` → `catalogo/importar/page.tsx`), PDF extraction + name resolution (`services/extraccion_cotizaciones.py`, `services/resolucion_productos.py` → `extraccion` router → upload page `cotizaciones/page.tsx` and review screen `cotizaciones/revisar/page.tsx`), catalog CRUD + alias upsert (`catalogo` router), supplier lookup by NIT (`proveedores` router), and order generation + history (`services/generacion_ordenes.py` → `ordenes` router → `ordenes/page.tsx`). The official PO template lives at `backend/app/plantillas/plantilla_orden_compra.xlsx` (a copy of `GUIA DE ORDEN COMPRA.xlsx`); the generator fills only variable cells and shifts merged ranges/row heights manually because openpyxl 3.1.5 `insert_rows` does not move them. The original quotation PDF travels in memory between upload and generation via `app/src/lib/pdf-cotizacion.ts` (lost on page refresh — the order still generates, just without attaching the PDF to Storage). Generated docs go to the private `ordenes` Storage bucket, original PDFs to `cotizaciones`; downloads use backend-signed URLs (`GET /ordenes/{id}/documento`). **Still pending:** the suppliers list page.

All code, comments, docs, and DB identifiers are in **Spanish** — keep it that way.

Real supplier quotation PDFs for manually exercising the extraction flow live in `Cotizaciones de prueba/` at the repo root, and the source Excel for the official catalog is `Requisición Abastecimientos excel.xlsx` next to it (both untracked, local-only — may not exist on a fresh clone).

## Commands

### Backend (FastAPI, Python 3.11+) — from `backend/`

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt          # + requirements-dev.txt for tests
copy .env.example .env
uvicorn app.main:app --reload            # http://localhost:8000, docs at /docs
```

There is no pytest suite. The only test is a standalone concurrency script that needs a real Postgres with migrations applied:

```
TEST_DATABASE_URL=postgresql://... python backend/tests/test_siguiente_numero_orden.py
```

### Frontend (Next.js 16 App Router, TypeScript, Tailwind 4) — from `app/`

```
npm install
copy .env.example .env.local
npm run dev        # http://localhost:3000
npm run build
npm run lint       # eslint
```

Note `app/CLAUDE.md`: this Next.js version may differ from training data — check `app/node_modules/next/dist/docs/` before writing Next.js code.

### Database

Migrations are plain SQL in `supabase/migrations/` (timestamp-prefixed), applied to a Supabase project. There is no local supabase CLI config in the repo.

## Architecture

Two apps running in parallel; the frontend never talks to Gemini and never holds privileged keys:

```
Next.js (:3000) ──REST──► FastAPI (:8000) ──► Gemini (extraction + fallback name matching)
      │                        │
      └────── Supabase ◄───────┘   (Postgres + RLS, Storage for PDFs/generated docs)
```

- **Frontend** (`app/src/app/`): route-per-module — `proveedores/` (catalog + Excel import), `catalogo/` (company products + per-supplier aliases), `cotizaciones/` (PDF upload + review screen), `ordenes/` (generation + history). Uses the Supabase anon key (RLS-protected) and calls the backend via `NEXT_PUBLIC_API_URL`. `src/lib/api.ts` mirrors the backend Pydantic models as TypeScript interfaces — keep the two in sync. Page-to-page handoff (upload → review → order) goes through `sessionStorage`, not URL params.
- **Backend** (`backend/app/`): `core/config.py` loads all env vars (module-level constants via dotenv, including `UMBRAL_FUZZY`, the minimum fuzzy-match score, default 70); `routers/` maps 1:1 to the modules (`catalogo`, `extraccion`, `importacion`, `ordenes`, `proveedores`); `services/` holds Gemini, matching, and document-generation logic. Uses the service-role key (bypasses RLS) — that key and `GEMINI_API_KEY` must never reach the frontend.
- **Backend layering pattern** (follow it in new modules): services hold all logic and never import FastAPI; they raise typed domain exceptions (`ValueError` subclasses) that the router maps to HTTP status codes, and define their Pydantic response models. The Supabase client (`core/supabase.py`) and Gemini client (`core/gemini.py`) come from lazily-cached `obtener_cliente()` factories and are synchronous — async routers must call services via `run_in_threadpool`. Gemini/Supabase failures inside batch operations degrade gracefully (warnings in the response) instead of failing the whole request.
- **Security model:** RLS on every table, policies only for `authenticated` (single-tenant); `anon` has no access and cannot execute the numbering RPC. The frontend never talks to Supabase directly — all data flows through the backend (service role), so endpoint protection *is* the security boundary. Phase 1 (current): shared API key — `core/seguridad.py` validates the `X-API-Key` header against `CLAVE_API_BACKEND` (empty = no auth, local dev only) via a dependency on every router except `/health`; the frontend attaches it through the `fetchApi` wrapper in `src/lib/api.ts` (**always use `fetchApi`, never raw `fetch`, for backend calls**). Phase 2 (pending): Supabase Auth with per-user JWT. CORS origins come from `ORIGENES_CORS` (comma-separated).
- **Deploy:** frontend on Vercel (Root Directory `app/`), backend on Render (`render.yaml` blueprint at repo root, pinned `requirements.txt`, Python 3.11.8) — full steps in [DEPLOY.md](DEPLOY.md).

## Business rules that shape the code

These come from INSTRUCCIONS.MD sections 6–8 and are invariants, not suggestions:

- **Order number:** `GCS-OC-COR-{year}-{NNN}`, resets to 001 each year, assigned only via the `siguiente_numero_orden(p_anio)` RPC (INSERT ON CONFLICT upsert takes the row lock — never compute consecutives in app code).
- **Discount/total calculation order:** per-item discount → subtotal → order-level discount → IVA base → IVA (rate is per-order, default 19%, editable) → total. Never let users type computed fields.
- **Historical integrity:** `ordenes_compra_items.descripcion_final` stores the official product name frozen at generation time — never resolve it dynamically from the catalog.
- **Catalog mirrors the company Excel:** `productos_empresa` must stay identical to the "Requisición Abastecimientos" Excel (sheet Catalogo: Grupo | Codigo | Item | Unidad) — same `nombre_oficial` (Item), `codigo`, and `grupo`. Neither name nor code is unique on its own (generic codes are reused across whole categories, e.g. 511114 for ~55 stationery items; the same name appears in different groups), so the uniqueness check is on the name+code pair, case-insensitive. The bulk import (`importacion_catalogo.py`) matches by that pair in app code (there is no DB unique constraint on it), updates only grupo/unidad on existing rows, and never deletes. Products are never deleted (aliases and emitted orders reference them). Resolution candidates carry `codigo` so the review screen can disambiguate homonyms. The catalog exceeds 1,000 rows, PostgREST's per-select cap — any full catalog read must paginate with `.range()` (see `listar_productos` / `_cargar_catalogo`).
- **Name matching cascade** (`resolucion_productos.py`): everything already confirmed (supplier alias by exact text → by normalized text → by supplier reference; then `ordenes_compra_items` history and other suppliers' aliases, origin `historico`) → multi-signal fuzzy against `productos_empresa` → Gemini suggestion as last resort → manual. User corrections in the review screen create/update aliases; **nothing is ever auto-confirmed or auto-aliased** — `nivel` (alta/media/baja) only colours the badge.
- **All text comparison goes through `app/core/texto.py`** — `normalizar` (accents, case, domain abbreviations via the `SINONIMOS` dict), `extraer_medidas` (3/8", 20 mm, AWG gauge) and `normalizar_nit` (digits only, no check digit). Normalize to *compare*, never to store. In this domain the measurement **is** the product identity, so it is scored apart from text similarity; a plain `WRatio` over the 2000+ catalog returns the same score for dozens of unrelated products.
- **Aliases are keyed by canonical NIT.** `normalizar_nit` is applied on write and on read: the PDFs bring `830.113.629`, `800081030-1` and `860030640` for the same kind of identifier, and without this the learning fragments. `proveedores.nit` is deliberately left raw — it is the primary key and `ordenes_compra` references it.
- **The catalog is read through `catalogo_cache.py`** (normalized, in-memory, TTL). Any write to `productos_empresa` must call `catalogo_cache.invalidar()`.
- **Gemini gets a per-item shortlist, never the whole catalog**, and may only pick a name from the shortlist offered for *that* item. The shortlist is the union of several rapidfuzz scorers (built for recall: what is not in it, Gemini cannot find) and shrinks when many items are pending, bounded by `PRESUPUESTO_OPCIONES_GEMINI`.
- **Measuring matching quality:** `backend/tests/evaluar_resolucion.py` against `tests/datos/golden_resolucion.json`. Run it with `--sin-alias` before and after touching the cascade — with aliases on, the golden cases resolve at confidence 100 and the number says nothing.
- **Supplier Excel import:** upsert by NIT, incremental (never deletes suppliers absent from the file), returns a summary of created/updated/errored rows.
- **Gemini extraction:** send the PDF directly (no OCR step), force structured JSON output against a fixed schema (retry once with a stricter prompt on invalid JSON). Model configurable via `GEMINI_MODEL` (default `gemini-2.5-flash-lite`). Extraction and resolution persist nothing — data lives in the review screen until the order is generated. Each item also carries the supplier's own `referencia` (a matching signal and a stable alias key), and `totales_pdf` holds the totals **as printed** on the PDF, as a checksum against silently dropped rows.
- **PO template:** fixed sections (company header, "OBLIGACIONES DEL CONTRATISTA", payment-block wording, item-table headers, signature block) are never modified by the system.
