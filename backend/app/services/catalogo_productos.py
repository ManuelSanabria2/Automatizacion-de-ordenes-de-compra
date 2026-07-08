"""CRUD del catálogo interno de productos (`productos_empresa`).

Reglas:
- El catálogo es espejo del Excel "Requisición Abastecimientos": cada producto
  lleva el mismo nombre (Item), código y grupo de ese archivo.
- La combinación nombre + código es única (comparación insensible a
  mayúsculas). El nombre solo NO es único (hay nombres repetidos en grupos
  distintos) y el código tampoco (la empresa reutiliza códigos genéricos,
  p. ej. 511114 para papelería).
- La tasa de IVA por defecto va de 0 a 100 (default 19).
- No hay borrado: los productos pueden estar referenciados por alias y
  por órdenes ya emitidas.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.supabase import obtener_cliente

TABLA = "productos_empresa"
COLUMNAS = "id, nombre_oficial, codigo, grupo, unidad_default, tasa_iva_default, created_at"

# PostgREST limita cada select a 1000 filas; los listados se leen por páginas.
TAMANO_PAGINA = 1000


class ErrorProductoDuplicado(ValueError):
    """Ya existe un producto con ese nombre oficial (el router responde 409)."""


class ErrorProductoNoEncontrado(ValueError):
    """No existe un producto con ese id (el router responde 404)."""


class Producto(BaseModel):
    id: str
    nombre_oficial: str
    codigo: str | None
    grupo: str | None
    unidad_default: str | None
    tasa_iva_default: float
    created_at: datetime


class ProductoCrear(BaseModel):
    nombre_oficial: str
    codigo: str | None = None
    grupo: str | None = None
    unidad_default: str | None = None
    tasa_iva_default: float = Field(default=19, ge=0, le=100)

    @field_validator("nombre_oficial")
    @classmethod
    def nombre_no_vacio(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El nombre oficial no puede estar vacío")
        return limpio

    @field_validator("codigo", "grupo", "unidad_default")
    @classmethod
    def texto_limpio(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        return valor.strip() or None


class ProductoActualizar(ProductoCrear):
    pass


def _escapar_comodines(texto: str) -> str:
    """Escapa los comodines de LIKE (%, _) y el propio carácter de escape."""
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _existe_nombre(nombre: str, codigo: str | None, excluir_id: str | None = None) -> bool:
    """True si otro producto ya usa esa combinación nombre + código
    (insensible a mayúsculas)."""
    consulta = (
        obtener_cliente()
        .table(TABLA)
        .select("id")
        .ilike("nombre_oficial", _escapar_comodines(nombre))
    )
    if codigo is None:
        consulta = consulta.is_("codigo", "null")
    else:
        consulta = consulta.ilike("codigo", _escapar_comodines(codigo))
    if excluir_id is not None:
        consulta = consulta.neq("id", excluir_id)
    return bool(consulta.limit(1).execute().data)


def listar_productos(buscar: str | None = None) -> list[Producto]:
    """Lista el catálogo ordenado por nombre; `buscar` filtra por subcadena
    del nombre oficial o del código. Paginado: PostgREST corta cada select
    en 1000 filas y el catálogo oficial supera las 3000."""
    filas: list[dict] = []
    while True:
        consulta = obtener_cliente().table(TABLA).select(COLUMNAS).order("nombre_oficial")
        if buscar and buscar.strip():
            patron = f"%{_escapar_comodines(buscar.strip())}%"
            consulta = consulta.or_(f"nombre_oficial.ilike.{patron},codigo.ilike.{patron}")
        respuesta = consulta.range(len(filas), len(filas) + TAMANO_PAGINA - 1).execute()
        filas.extend(respuesta.data)
        if len(respuesta.data) < TAMANO_PAGINA:
            return [Producto(**fila) for fila in filas]


def crear_producto(datos: ProductoCrear) -> Producto:
    if _existe_nombre(datos.nombre_oficial, datos.codigo):
        raise ErrorProductoDuplicado(
            f"Ya existe un producto con el nombre «{datos.nombre_oficial}» "
            f"y código «{datos.codigo or 'sin código'}»"
        )
    respuesta = (
        obtener_cliente().table(TABLA).insert(datos.model_dump()).execute()
    )
    return Producto(**respuesta.data[0])


def actualizar_producto(producto_id: str, datos: ProductoActualizar) -> Producto:
    if _existe_nombre(datos.nombre_oficial, datos.codigo, excluir_id=producto_id):
        raise ErrorProductoDuplicado(
            f"Ya existe otro producto con el nombre «{datos.nombre_oficial}» "
            f"y código «{datos.codigo or 'sin código'}»"
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
