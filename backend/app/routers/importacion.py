"""Router de importación — carga masiva de proveedores desde Excel.

Endpoints:
- POST /importacion/importar-proveedores : Excel → validación → upsert por NIT → resumen.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError

from app.services.importacion_proveedores import (
    ErrorArchivoInvalido,
    ErrorColumnasFaltantes,
    ResumenImportacion,
    importar_proveedores,
)

router = APIRouter(prefix="/importacion", tags=["importacion"])


@router.post("/importar-proveedores", response_model=ResumenImportacion)
async def importar_proveedores_endpoint(
    archivo: UploadFile = File(...),
) -> ResumenImportacion:
    """Recibe un .xlsx de proveedores y devuelve el resumen de la importación."""
    if not (archivo.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="El archivo debe ser un Excel (.xlsx)")

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío")

    try:
        # El cliente de Supabase es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(importar_proveedores, contenido)
    except (ErrorColumnasFaltantes, ErrorArchivoInvalido) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except APIError as exc:
        raise HTTPException(
            status_code=502, detail=f"Error al guardar en Supabase: {exc.message}"
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
