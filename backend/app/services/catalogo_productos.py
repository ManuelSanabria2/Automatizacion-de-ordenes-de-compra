"""CRUD del catálogo interno de productos (`productos_empresa`).

Reglas:
- El nombre oficial es obligatorio y único (comparación insensible a
  mayúsculas): el catálogo alimenta el fuzzy matching y los duplicados
  lo degradan.
- La tasa de IVA por defecto va de 0 a 100 (default 19).
- No hay borrado: los productos pueden estar referenciados por alias y
  por órdenes ya emitidas.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.supabase import obtener_cliente

TABLA = "productos_empresa"
COLUMNAS = "id, nombre_oficial, unidad_default, tasa_iva_default, created_at"


class ErrorProductoDuplicado(ValueError):
    """Ya existe un producto con ese nombre oficial (el router responde 409)."""


class ErrorProductoNoEncontrado(ValueError):
    """No existe un producto con ese id (el router responde 404)."""


class Producto(BaseModel):
    id: str
    nombre_oficial: str
    unidad_default: str | None
    tasa_iva_default: float
    created_at: datetime


class ProductoCrear(BaseModel):
    nombre_oficial: str
    unidad_default: str | None = None
    tasa_iva_default: float = Field(default=19, ge=0, le=100)

    @field_validator("nombre_oficial")
    @classmethod
    def nombre_no_vacio(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El nombre oficial no puede estar vacío")
        return limpio

    @field_validator("unidad_default")
    @classmethod
    def unidad_limpia(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        return valor.strip() or None


class ProductoActualizar(ProductoCrear):
    pass


def _escapar_comodines(texto: str) -> str:
    """Escapa los comodines de LIKE (%, _) y el propio carácter de escape."""
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _existe_nombre(nombre: str, excluir_id: str | None = None) -> bool:
    """True si otro producto ya usa ese nombre (insensible a mayúsculas)."""
    consulta = (
        obtener_cliente()
        .table(TABLA)
        .select("id")
        .ilike("nombre_oficial", _escapar_comodines(nombre))
    )
    if excluir_id is not None:
        consulta = consulta.neq("id", excluir_id)
    return bool(consulta.limit(1).execute().data)


def listar_productos(buscar: str | None = None) -> list[Producto]:
    """Lista el catálogo ordenado por nombre; `buscar` filtra por subcadena."""
    consulta = obtener_cliente().table(TABLA).select(COLUMNAS).order("nombre_oficial")
    if buscar and buscar.strip():
        consulta = consulta.ilike("nombre_oficial", f"%{_escapar_comodines(buscar.strip())}%")
    respuesta = consulta.execute()
    return [Producto(**fila) for fila in respuesta.data]


def crear_producto(datos: ProductoCrear) -> Producto:
    if _existe_nombre(datos.nombre_oficial):
        raise ErrorProductoDuplicado(
            f"Ya existe un producto con el nombre «{datos.nombre_oficial}»"
        )
    respuesta = (
        obtener_cliente().table(TABLA).insert(datos.model_dump()).execute()
    )
    return Producto(**respuesta.data[0])


def actualizar_producto(producto_id: str, datos: ProductoActualizar) -> Producto:
    if _existe_nombre(datos.nombre_oficial, excluir_id=producto_id):
        raise ErrorProductoDuplicado(
            f"Ya existe otro producto con el nombre «{datos.nombre_oficial}»"
        )
    respuesta = (
        obtener_cliente()
        .table(TABLA)
        .update(datos.model_dump())
        .eq("id", producto_id)
        .execute()
    )
    if not respuesta.data:
        raise ErrorProductoNoEncontrado(f"No existe un producto con id {producto_id}")
    return Producto(**respuesta.data[0])
