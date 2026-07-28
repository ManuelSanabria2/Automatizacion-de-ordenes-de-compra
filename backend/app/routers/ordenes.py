"""Router de órdenes — generación del documento final e historial.

Endpoints:
- POST /ordenes/generar          : borrador confirmado (+PDF original opcional)
                                   → consecutivo atómico, cálculo de totales,
                                   documento oficial en Storage y registro en BD.
- GET  /ordenes                  : historial de órdenes generadas.
- GET  /ordenes/{id}/documento   : URL firmada (1 h) del documento generado.
"""

from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from pydantic import ValidationError
from storage3.exceptions import StorageApiError

from app.services.generacion_ordenes import (
    MIME_XLSX,
    ErrorOrdenNoEncontrada,
    ErrorProductoInexistente,
    ErrorVarianteInvalida,
    OrdenBorrador,
    OrdenGenerada,
    OrdenResumen,
    UrlDocumento,
    generar_orden,
    listar_ordenes,
    regenerar_documento_orden,
    url_documento,
)

router = APIRouter(prefix="/ordenes", tags=["ordenes"])

# Mismo límite que el endpoint de extracción (tamaño del PDF original)
TAMANO_MAXIMO_PDF = 20 * 1024 * 1024


def _a_http(exc: Exception) -> HTTPException:
    """Traduce los errores del servicio a respuestas HTTP."""
    if isinstance(exc, ErrorProductoInexistente):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, ErrorVarianteInvalida):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, ErrorOrdenNoEncontrada):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, APIError):
        return HTTPException(
            status_code=502, detail=f"Error al consultar Supabase: {exc.message}"
        )
    if isinstance(exc, StorageApiError):
        return HTTPException(
            status_code=502, detail=f"Error de Storage: {exc.message}"
        )
    # RuntimeError: configuración faltante (obtener_cliente)
    return HTTPException(status_code=500, detail=str(exc))


@router.post("/generar", response_model=OrdenGenerada, status_code=201)
async def generar_orden_endpoint(
    borrador: str = Form(...),
    pdf_cotizacion: UploadFile | None = File(None),
) -> OrdenGenerada:
    """Genera la Orden de Compra oficial a partir del borrador confirmado.

    `borrador` viaja como campo JSON dentro del multipart para poder adjuntar
    el PDF original de la cotización en la misma petición.
    """
    try:
        datos = OrdenBorrador.model_validate_json(borrador)
    except ValidationError as exc:
        primer_error = exc.errors()[0]
        campo = ".".join(str(p) for p in primer_error["loc"])
        raise HTTPException(
            status_code=422, detail=f"Borrador inválido — {campo}: {primer_error['msg']}"
        ) from exc

    contenido_pdf = None
    if pdf_cotizacion is not None:
        contenido_pdf = await pdf_cotizacion.read()
        if len(contenido_pdf) > TAMANO_MAXIMO_PDF:
            raise HTTPException(status_code=400, detail="El PDF supera el límite de 20 MB")
        if not contenido_pdf:
            contenido_pdf = None

    try:
        # Los clientes de Supabase/Storage son síncronos: fuera del event loop.
        return await run_in_threadpool(generar_orden, datos, contenido_pdf)
    except (ErrorProductoInexistente, APIError, StorageApiError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.get("", response_model=list[OrdenResumen])
async def listar_ordenes_endpoint() -> list[OrdenResumen]:
    """Historial de órdenes generadas, la más reciente primero."""
    try:
        return await run_in_threadpool(listar_ordenes)
    except (APIError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.get("/{orden_id}/documento", response_model=UrlDocumento)
async def url_documento_endpoint(orden_id: str) -> UrlDocumento:
    """URL firmada (1 hora) para descargar el documento oficial de la orden."""
    try:
        return await run_in_threadpool(url_documento, orden_id)
    except (ErrorOrdenNoEncontrada, APIError, StorageApiError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.get("/{orden_id}/descargar")
async def descargar_documento_endpoint(
    orden_id: str, variante: str = "empresa"
) -> StreamingResponse:
    """Regenera y descarga el documento .xlsx de una orden en la variante pedida:
    `empresa` (nombres del catálogo) o `proveedor` (nombres de la cotización).
    Se reconstruye al vuelo desde los datos congelados; no se guarda en Storage.
    """
    try:
        contenido, nombre = await run_in_threadpool(
            regenerar_documento_orden, orden_id, variante
        )
    except (
        ErrorVarianteInvalida,
        ErrorOrdenNoEncontrada,
        APIError,
        StorageApiError,
        RuntimeError,
    ) as exc:
        raise _a_http(exc) from exc

    return StreamingResponse(
        BytesIO(contenido),
        media_type=MIME_XLSX,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(nombre)}"
        },
    )
