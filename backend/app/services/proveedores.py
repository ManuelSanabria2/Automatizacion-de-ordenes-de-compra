"""Consulta de proveedores por NIT (la carga masiva vive en importacion_proveedores).

La pantalla de revisión usa esta consulta para autocompletar los datos del
proveedor extraído: si el NIT ya existe se muestran los datos registrados;
si no, el proveedor se marca como nuevo (se creará al generar la orden).
"""

from pydantic import BaseModel

from app.core.supabase import obtener_cliente

COLUMNAS = "nit, nombre, direccion, ciudad, contacto, telefono, email"


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
