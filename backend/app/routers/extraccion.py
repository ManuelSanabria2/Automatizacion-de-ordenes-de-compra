"""Router de extracción — procesa cotizaciones vía Gemini y resuelve nombres.

Endpoints:
- POST /extraccion/extraer-cotizacion : PDF → JSON estructurado (proveedor,
  número de cotización, ítems). No persiste nada en base de datos.
- POST /extraccion/resolver-productos : textos de ítems del proveedor →
  candidatos del catálogo (alias exacto → fuzzy → Gemini → sin match).
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from google.genai import errors as errores_gemini
from postgrest.exceptions import APIError

from app.services.extraccion_cotizaciones import (
    CotizacionExtraida,
    ErrorRespuestaNoJSON,
    extraer_cotizacion,
)
from app.services.resolucion_productos import (
    RespuestaResolucion,
    SolicitudResolucion,
    resolver_productos,
)

router = APIRouter(prefix="/extraccion", tags=["extraccion"])

# Límite de la API de Gemini para contenido enviado en línea (20 MB por request)
TAMANO_MAXIMO_PDF = 20 * 1024 * 1024


@router.post("/extraer-cotizacion", response_model=CotizacionExtraida)
async def extraer_cotizacion_endpoint(
    archivo: UploadFile = File(...),
) -> CotizacionExtraida:
    """Recibe un PDF de cotización y devuelve el JSON extraído por Gemini."""
    es_pdf = (archivo.filename or "").lower().endswith(".pdf") or (
        archivo.content_type == "application/pdf"
    )
    if not es_pdf:
        raise HTTPException(status_code=400, detail="El archivo debe ser un PDF")

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    if len(contenido) > TAMANO_MAXIMO_PDF:
        raise HTTPException(status_code=400, detail="El PDF supera el límite de 20 MB")

    try:
        # El cliente de Gemini es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(extraer_cotizacion, contenido)
    except ErrorRespuestaNoJSON as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except errores_gemini.APIError as exc:
        raise HTTPException(
            status_code=502, detail=f"Error de la API de Gemini: {exc.message}"
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/resolver-productos", response_model=RespuestaResolucion)
async def resolver_productos_endpoint(
    solicitud: SolicitudResolucion,
) -> RespuestaResolucion:
    """Resuelve los textos de ítems del proveedor contra el catálogo oficial.

    Los fallos de Gemini no tumban la petición: esos ítems vuelven como
    "sin_match" con una advertencia.
    """
    try:
        # El cliente de Supabase es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(
            resolver_productos, solicitud.proveedor_nit, solicitud.items
        )
    except APIError as exc:
        raise HTTPException(
            status_code=502, detail=f"Error al consultar Supabase: {exc.message}"
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
