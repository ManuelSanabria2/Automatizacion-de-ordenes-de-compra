"""Alias de nomenclatura por proveedor (aprendizaje incremental, INSTRUCCIONS.MD §6.3).

Cuando el usuario confirma en la pantalla de revisión un ítem cuyo nombre no
venía de un alias exacto, se guarda (upsert) el alias para que la próxima
cotización de ese proveedor se resuelva de inmediato.

Convención: `nombre_proveedor_texto` se almacena recortado (strip), igual que
lo compara resolucion_productos.
"""

from pydantic import BaseModel, field_validator

from app.core.supabase import obtener_cliente


class AliasGuardar(BaseModel):
    proveedor_nit: str
    nombre_proveedor_texto: str
    producto_empresa_id: str

    @field_validator("proveedor_nit", "nombre_proveedor_texto", "producto_empresa_id")
    @classmethod
    def no_vacio(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El campo no puede estar vacío")
        return limpio


class Alias(BaseModel):
    id: str
    proveedor_nit: str
    nombre_proveedor_texto: str
    producto_empresa_id: str


def guardar_alias(datos: AliasGuardar) -> Alias:
    """Crea o actualiza el alias del proveedor para ese texto exacto."""
    respuesta = (
        obtener_cliente()
        .table("alias_productos")
        .upsert(datos.model_dump(), on_conflict="proveedor_nit,nombre_proveedor_texto")
        .execute()
    )
    return Alias(**respuesta.data[0])
