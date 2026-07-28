"""Router de proveedores — consulta del catálogo de proveedores.

Endpoints:
- GET /proveedores       : listado, con búsqueda opcional por nombre o NIT.
- GET /proveedores/{nit} : datos del proveedor registrado (404 si no existe).

La carga masiva desde Excel vive en el router de importación.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError

from app.services.proveedores import (
    ErrorProveedorNoEncontrado,
    Proveedor,
    consultar_proveedor,
    listar_proveedores,
)

router = APIRouter(prefix="/proveedores", tags=["proveedores"])


@router.get("", response_model=list[Proveedor])
async def listar_proveedores_endpoint(
    buscar: str = Query("", description="Filtra por nombre o NIT"),
) -> list[Proveedor]:
    """Lista los proveedores registrados, ordenados por nombre."""
    try:
        # El cliente de Supabase es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(listar_proveedores, buscar)
    except APIError as exc:
        raise HTTPException(
            status_code=502, detail=f"Error al consultar Supabase: {exc.message}"
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
