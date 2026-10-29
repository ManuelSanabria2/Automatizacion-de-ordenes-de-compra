"""Punto de entrada del backend FastAPI.

Ejecutar en local:
    uvicorn app.main:app --reload
"""

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core import config
from app.core.errores import MENSAJE_SIN_BASE_DE_DATOS, CapturaErrores
from app.core.seguridad import verificar_clave_api
from app.core.supabase import obtener_cliente
from app.routers import catalogo, extraccion, importacion, ordenes, proveedores

app = FastAPI(
    title="API Órdenes de Compra",
    description="Extracción de cotizaciones (Gemini), importación de proveedores y generación de órdenes de compra.",
    version="0.1.0",
)

# OJO con el orden: el último middleware añadido es el más externo. La captura
# de errores tiene que quedar POR DEBAJO del CORS para que sus respuestas 500
# lleven cabeceras y el navegador muestre el error real, no un fallo de CORS.
app.add_middleware(CapturaErrores)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ORIGENES_CORS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not config.CLAVE_API_BACKEND:
    logging.getLogger("uvicorn.error").warning(
        "CLAVE_API_BACKEND no está definida: los endpoints quedan SIN autenticación "
        "(solo aceptable en desarrollo local)."
    )

# Todos los routers exigen la clave API; /health queda abierto para el
# health check del host.
_seguridad = [Depends(verificar_clave_api)]
app.include_router(catalogo.router, dependencies=_seguridad)
app.include_router(extraccion.router, dependencies=_seguridad)
app.include_router(importacion.router, dependencies=_seguridad)
app.include_router(ordenes.router, dependencies=_seguridad)
app.include_router(proveedores.router, dependencies=_seguridad)


@app.get("/health", tags=["salud"])
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/db", tags=["salud"])
def health_db() -> JSONResponse:
    """Consulta mínima a Supabase. La llama a diario el workflow
    `.github/workflows/mantener-activo.yml`: el plan free de Supabase pausa el
    proyecto tras 7 días sin actividad, y esta consulta cuenta como actividad.
    Abierto como /health (no devuelve datos) para que el cron no necesite la
    clave API. `def` síncrono: FastAPI lo corre en el threadpool."""
    try:
        obtener_cliente().table("proveedores").select("nit").limit(1).execute()
    except Exception:
        logging.getLogger("uvicorn.error").exception("Health check de la base falló")
        return JSONResponse(
            status_code=503,
            content={"status": "error", "detail": MENSAJE_SIN_BASE_DE_DATOS},
        )
    return JSONResponse(content={"status": "ok"})
