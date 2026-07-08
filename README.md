# Sistema de Generación Automática de Órdenes de Compra

Aplicación web interna que recibe cotizaciones en PDF de distintos proveedores, extrae los ítems mediante IA (Gemini), los reconcilia contra el catálogo interno de la empresa y genera la Orden de Compra en el formato oficial, con consecutivo automático e historial completo.

> La especificación funcional completa está en [INSTRUCCIONS.MD](INSTRUCCIONS.MD).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js (App Router, TypeScript, Tailwind) |
| Backend / IA | FastAPI (Python 3.11+) |
| Base de datos y Storage | Supabase (PostgreSQL + RLS) |
| Extracción IA | Gemini API (Flash-Lite por defecto, configurable) |

## Estructura del repositorio

```
├── app/                        # Frontend Next.js (App Router)
│   ├── src/
│   │   ├── app/
│   │   │   ├── proveedores/    # Catálogo de proveedores + importación Excel
│   │   │   ├── catalogo/       # Productos de la empresa y alias por proveedor
│   │   │   ├── cotizaciones/   # Subida de PDF y pantalla de revisión
│   │   │   └── ordenes/        # Generación e historial de órdenes de compra
│   │   ├── components/         # Componentes compartidos
│   │   └── lib/                # Clientes (Supabase, API), utilidades
│   └── .env.example
├── backend/                    # Microservicio FastAPI
│   ├── app/
│   │   ├── core/               # Configuración, clientes Supabase y Gemini
│   │   ├── routers/            # catalogo, extraccion, importacion, ordenes, proveedores
│   │   ├── services/           # Gemini, matching, generación de documentos
│   │   ├── plantillas/         # Plantilla oficial de la Orden de Compra (.xlsx)
│   │   └── main.py
│   ├── tests/                  # Test de concurrencia del consecutivo
│   ├── requirements.txt
│   └── .env.example
├── supabase/
│   └── migrations/             # SQL: esquema + RPC siguiente_numero_orden
└── README.md
```

## Setup local

Frontend y backend corren en paralelo: Next.js en `http://localhost:3000` y FastAPI en `http://localhost:8000` (CORS ya configurado para ese origen).

### Requisitos

- Node.js 20+
- Python 3.11+
- Un proyecto en [Supabase](https://supabase.com)
- Una API key de [Gemini](https://aistudio.google.com/apikey)

### 1. Backend (FastAPI) — terminal 1

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env        # y completar los valores reales
uvicorn app.main:app --reload
```

La API queda en `http://localhost:8000` (documentación interactiva en `/docs`).

### 2. Frontend (Next.js) — terminal 2

```bash
cd app
npm install
copy .env.example .env.local  # y completar los valores reales
npm run dev
```

La app queda en `http://localhost:3000`.

### 3. Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `SUPABASE_URL` | backend | URL del proyecto Supabase |
| `SUPABASE_KEY` | backend | Anon key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Service role key (salta RLS — solo backend, nunca en el navegador) |
| `GEMINI_API_KEY` | backend | API key de Gemini (nunca en el cliente) |
| `GEMINI_MODEL` | backend | Modelo de extracción (default `gemini-2.5-flash-lite`) |
| `UMBRAL_FUZZY` | backend | Score mínimo (0-100) del fuzzy matching antes de recurrir a Gemini (opcional, default 70) |
| `CLAVE_API_BACKEND` | backend | Clave compartida que exige el header `X-API-Key` (vacía = sin auth, solo dev local) |
| `ORIGENES_CORS` | backend | Orígenes permitidos por CORS, separados por comas (default `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | app | URL del backend FastAPI |
| `NEXT_PUBLIC_CLAVE_API` | app | Misma clave que `CLAVE_API_BACKEND` (vacía en dev local) |

⚠️ **Los archivos `.env` y `.env.local` nunca se suben al repositorio** — están excluidos en `.gitignore`. Solo se versionan los `.env.example`.

## Deploy

Frontend en Vercel (Root Directory `app/`) y backend en Render (Blueprint
`render.yaml` en la raíz). Pasos completos, generación de la clave API y
smoke test en [DEPLOY.md](DEPLOY.md).

## Estado del proyecto

Implementado de extremo a extremo: importación de proveedores desde Excel (upsert por NIT), carga del catálogo oficial desde el Excel «Requisición Abastecimientos» (sincronización incremental por nombre + código), extracción de cotizaciones PDF con Gemini, resolución de nombres contra el catálogo (alias → fuzzy → Gemini → manual), pantalla de revisión y generación de la Orden de Compra oficial con consecutivo anual atómico, historial y descarga vía URLs firmadas.

**Pendiente:** la página de listado de proveedores (hoy solo existe la importación).
