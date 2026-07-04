"""Router de proveedores — consulta del catálogo de proveedores.

Endpoints:
- GET /proveedores/{nit} : datos del proveedor registrado (404 si no existe).

La carga masiva desde Excel vive en el router de importación.
"""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError

from app.services.proveedores import (
    ErrorProveedorNoEncontrado,
    Proveedor,
    consultar_proveedor,
)

router = APIRouter(prefix="/proveedores", tags=["proveedores"])


@router.get("/{nit}", response_model=Proveedor)
async def consultar_proveedor_endpoint(nit: str) -> Proveedor:
    """Devuelve el proveedor registrado con ese NIT, o 404 si no existe."""
    try:
        # El cliente de Supabase es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(consultar_proveedor, nit)
    except ErrorProveedorNoEncontrado as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except APIError as exc:
        raise HTTPException(
            status_code=502, detail=f"Error al consultar Supabase: {exc.message}"
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
