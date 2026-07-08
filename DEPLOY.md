# Deploy: Vercel (frontend) + Render (backend)

Arquitectura desplegada:

```
Navegador ──► Vercel (Next.js, app/) ──X-API-Key──► Render (FastAPI, backend/) ──► Supabase + Gemini
```

Supabase ya es cloud: no requiere despliegue, solo tener las migraciones de
`supabase/migrations/` aplicadas al proyecto.

## Requisitos

- Repositorio en GitHub (Render y Vercel despliegan desde ahí).
- Cuenta en [Render](https://render.com) y en [Vercel](https://vercel.com).
- Los valores reales de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y
  `GEMINI_API_KEY` (los mismos del `.env` local del backend).

## Paso 0 — Generar la clave API compartida

Los endpoints del backend exigen el header `X-API-Key` cuando
`CLAVE_API_BACKEND` está definida. Genera un valor aleatorio (una sola vez):

```bash
openssl rand -hex 32
```

Guárdalo: se usa en Render (`CLAVE_API_BACKEND`) y en Vercel
(`NEXT_PUBLIC_CLAVE_API`), con el mismo valor.

> ⚠️ Limitación conocida (fase 1): al viajar en una variable `NEXT_PUBLIC_*`,
> la clave queda visible en el bundle JS del navegador. Protege contra bots y
> escaneo oportunista, no sustituye un login. La fase 2 (Supabase Auth con
> JWT) lo corrige; las políticas RLS para `authenticated` ya están listas en
> las migraciones.

## Paso 1 — Backend en Render

1. En el dashboard de Render: **New → Blueprint** y conecta el repositorio.
   Render detecta `render.yaml` en la raíz y propone el servicio
   `ordenes-compra-api` (Python, `rootDir: backend`).
2. Antes de crear, completa las variables marcadas `sync: false`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`
   - `CLAVE_API_BACKEND` = la clave del paso 0
   - `ORIGENES_CORS` = déjala con un valor provisional (p. ej.
     `http://localhost:3000`); se corrige en el paso 3 cuando exista el
     dominio de Vercel.
3. Crea el servicio y espera el primer deploy. Verifica:

```bash
curl https://<tu-servicio>.onrender.com/health
# → {"status":"ok"}

curl https://<tu-servicio>.onrender.com/catalogo/productos
# → {"detail":"Clave API inválida o ausente"}   (401: la protección funciona)

curl -H "X-API-Key: <clave>" https://<tu-servicio>.onrender.com/catalogo/productos
# → JSON del catálogo
```

Anota la URL del servicio (`https://<tu-servicio>.onrender.com`).

> Nota del plan free: el servicio se duerme tras ~15 min sin tráfico y el
> primer request posterior tarda ~50 s (cold start). Para uso interno suele
> ser tolerable; el plan Starter lo elimina.

## Paso 2 — Frontend en Vercel

1. **Add New → Project**, importa el repositorio.
2. **Root Directory: `app`** (imprescindible — es un monorepo). Framework:
   Next.js (autodetectado).
3. Variables de entorno (Production):
   - `NEXT_PUBLIC_API_URL` = URL de Render del paso 1 (sin barra final)
   - `NEXT_PUBLIC_CLAVE_API` = la clave del paso 0
4. Deploy. Anota el dominio final (`https://<tu-app>.vercel.app`).

## Paso 3 — Cerrar el círculo (CORS)

En Render → tu servicio → Environment: fija

```
ORIGENES_CORS=https://<tu-app>.vercel.app
```

(varios orígenes se separan con comas). Render redespliega solo.

## Paso 4 — Smoke test de producción

1. Abre `https://<tu-app>.vercel.app/catalogo` → debe listar el catálogo.
2. Flujo completo: sube un PDF de cotización en `/cotizaciones`, revisa los
   ítems, genera la orden y descárgala desde `/ordenes`.
3. Si algo falla con "No se pudo conectar con el servidor": revisa
   `NEXT_PUBLIC_API_URL`; si el navegador muestra errores CORS en consola:
   revisa `ORIGENES_CORS`; si todo responde 401: las dos claves no coinciden.

## Resumen de variables

| Variable | Dónde | Valor |
|---|---|---|
| `SUPABASE_URL` | Render | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Render | Service role key (nunca en Vercel) |
| `GEMINI_API_KEY` | Render | API key de Gemini (nunca en Vercel) |
| `GEMINI_MODEL` | Render | Opcional (el blueprint fija `gemini-2.5-flash`) |
| `UMBRAL_FUZZY` | Render | Opcional (default 70) |
| `CLAVE_API_BACKEND` | Render | Clave del paso 0 |
| `ORIGENES_CORS` | Render | Dominio de Vercel |
| `NEXT_PUBLIC_API_URL` | Vercel | URL del servicio de Render |
| `NEXT_PUBLIC_CLAVE_API` | Vercel | Misma clave del paso 0 |

## Pendiente (fase 2)

Autenticación real con Supabase Auth: pantalla de login, validación del JWT
en el backend (reemplaza la clave API) y uso efectivo de las políticas RLS
`authenticated` que ya existen en las migraciones.
