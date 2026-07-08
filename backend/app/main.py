"""Punto de entrada del backend FastAPI.

Ejecutar en local:
    uvicorn app.main:app --reload
"""

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config
from app.core.seguridad import verificar_clave_api
from app.routers import catalogo, extraccion, importacion, ordenes, proveedores

app = FastAPI(
    title="API Órdenes de Compra",
    description="Extracción de cotizaciones (Gemini), importación de proveedores y generación de órdenes de compra.",
    version="0.1.0",
)

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
