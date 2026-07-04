"""Router de catálogo — productos oficiales de la empresa y alias por proveedor.

Endpoints:
- GET  /catalogo/productos          : lista el catálogo (filtro opcional ?buscar=).
- POST /catalogo/productos          : crea un producto.
- PUT  /catalogo/productos/{id}     : edita nombre, unidad o tasa de IVA.
- POST /catalogo/alias              : crea/actualiza el alias de un proveedor.
"""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError

from app.services.alias_productos import Alias, AliasGuardar, guardar_alias
from app.services.catalogo_productos import (
    ErrorProductoDuplicado,
    ErrorProductoNoEncontrado,
    Producto,
    ProductoActualizar,
    ProductoCrear,
    actualizar_producto,
    crear_producto,
    listar_productos,
)

router = APIRouter(prefix="/catalogo", tags=["catalogo"])

# Postgres: "invalid text representation" (p. ej. un id que no es UUID)
_CODIGO_UUID_INVALIDO = "22P02"
# Postgres: violación de llave foránea (p. ej. producto_empresa_id inexistente)
_CODIGO_FK_VIOLADA = "23503"


def _a_http(exc: Exception) -> HTTPException:
    """Traduce los errores del servicio/Supabase a respuestas HTTP."""
    if isinstance(exc, ErrorProductoDuplicado):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ErrorProductoNoEncontrado):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, APIError):
        if exc.code == _CODIGO_UUID_INVALIDO:
            return HTTPException(status_code=400, detail="El id del producto no es válido")
        if exc.code == _CODIGO_FK_VIOLADA:
            return HTTPException(
                status_code=400, detail="El producto indicado no existe en el catálogo"
            )
        return HTTPException(status_code=502, detail=f"Error al consultar Supabase: {exc.message}")
    # RuntimeError: configuración faltante (obtener_cliente)
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/productos", response_model=list[Producto])
async def listar_productos_endpoint(buscar: str | None = None) -> list[Producto]:
    """Lista el catálogo ordenado por nombre; `buscar` filtra por subcadena."""
    try:
        # El cliente de Supabase es síncrono: se ejecuta fuera del event loop.
        return await run_in_threadpool(listar_productos, buscar)
    except (APIError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.post("/productos", response_model=Producto, status_code=201)
async def crear_producto_endpoint(datos: ProductoCrear) -> Producto:
    """Crea un producto del catálogo; rechaza nombres duplicados (409)."""
    try:
        return await run_in_threadpool(crear_producto, datos)
    except (ErrorProductoDuplicado, APIError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.post("/alias", response_model=Alias)
async def guardar_alias_endpoint(datos: AliasGuardar) -> Alias:
    """Crea o actualiza el alias (proveedor_nit, texto) → producto oficial."""
    try:
        return await run_in_threadpool(guardar_alias, datos)
    except (APIError, RuntimeError) as exc:
        raise _a_http(exc) from exc


@router.put("/productos/{producto_id}", response_model=Producto)
async def actualizar_producto_endpoint(producto_id: str, datos: ProductoActualizar) -> Producto:
    """Edita un producto existente; rechaza duplicados (409) e ids inexistentes (404)."""
    try:
        return await run_in_threadpool(actualizar_producto, producto_id, datos)
    except (ErrorProductoDuplicado, ErrorProductoNoEncontrado, APIError, RuntimeError) as exc:
        raise _a_http(exc) from exc
