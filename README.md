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
│   │   ├── core/               # Configuración (variables de entorno)
│   │   ├── routers/            # extraccion, importacion, ordenes
│   │   ├── services/           # Gemini, matching, generación de documentos
│   │   └── main.py
│   ├── requirements.txt
│   └── .env.example
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
| `NEXT_PUBLIC_API_URL` | app | URL del backend FastAPI |
| `NEXT_PUBLIC_SUPABASE_URL` | app | URL del proyecto Supabase (pública) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | Anon key pública, protegida por RLS |

⚠️ **Los archivos `.env` y `.env.local` nunca se suben al repositorio** — están excluidos en `.gitignore`. Solo se versionan los `.env.example`.

## Estado del proyecto

Estructura base únicamente — la lógica de negocio (extracción, matching de productos, generación de documentos, importación de proveedores) está pendiente de implementación.
