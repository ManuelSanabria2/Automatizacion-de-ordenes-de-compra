"""Punto de entrada del backend FastAPI.

Ejecutar en local:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import catalogo, extraccion, importacion, ordenes, proveedores

app = FastAPI(
    title="API Órdenes de Compra",
    description="Extracción de cotizaciones (Gemini), importación de proveedores y generación de órdenes de compra.",
    version="0.1.0",
)

# Frontend Next.js en desarrollo local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalogo.router)
app.include_router(extraccion.router)
app.include_router(importacion.router)
app.include_router(ordenes.router)
app.include_router(proveedores.router)


@app.get("/health", tags=["salud"])
def health() -> dict:
    return {"status": "ok"}
