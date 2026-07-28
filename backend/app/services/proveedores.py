"""Consulta de proveedores por NIT (la carga masiva vive en importacion_proveedores).

La pantalla de revisión usa esta consulta para autocompletar los datos del
proveedor extraído: si el NIT ya existe se muestran los datos registrados;
si no, el proveedor se marca como nuevo (se creará al generar la orden).
"""

from pydantic import BaseModel

from app.core.supabase import obtener_cliente

COLUMNAS = "nit, nombre, direccion, ciudad, contacto, telefono, email"

# PostgREST limita cada select a 1000 filas; los listados se leen por páginas.
TAMANO_PAGINA = 1000


class ErrorProveedorNoEncontrado(ValueError):
    """No existe un proveedor con ese NIT (el router responde 404)."""


class Proveedor(BaseModel):
    nit: str
    nombre: str
    direccion: str | None
    ciudad: str | None
    contacto: str | None
    telefono: str | None
    email: str | None


def _escapar_comodines(texto: str) -> str:
    """Escapa los comodines de LIKE para que se busquen literalmente."""
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def listar_proveedores(buscar: str = "") -> list[Proveedor]:
    """Proveedores ordenados por nombre, filtrando por NIT o nombre.

    Se pagina porque PostgREST corta cada select en 1000 filas (mismo criterio
    que `catalogo_productos.listar_productos`).
    """
    cliente = obtener_cliente()
    filas: list[dict] = []
    while True:
        consulta = cliente.table("proveedores").select(COLUMNAS).order("nombre")
        if buscar.strip():
            patron = f"%{_escapar_comodines(buscar.strip())}%"
            consulta = consulta.or_(f"nombre.ilike.{patron},nit.ilike.{patron}")
        respuesta = consulta.range(len(filas), len(filas) + TAMANO_PAGINA - 1).execute()
        filas.extend(respuesta.data)
        if len(respuesta.data) < TAMANO_PAGINA:
            return [Proveedor(**fila) for fila in filas]


def consultar_proveedor(nit: str) -> Proveedor:
    respuesta = (
        obtener_cliente()
        .table("proveedores")
        .select(COLUMNAS)
        .eq("nit", nit.strip())
        .limit(1)
        .execute()
    )
    if not respuesta.data:
        raise ErrorProveedorNoEncontrado(f"No existe un proveedor con NIT {nit}")
    return Proveedor(**respuesta.data[0])
