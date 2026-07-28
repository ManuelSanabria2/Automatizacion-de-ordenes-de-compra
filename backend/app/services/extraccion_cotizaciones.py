"""Extracción de cotizaciones PDF vía Gemini (INSTRUCCIONS.MD §8).

Reglas:
- El PDF se envía directamente a Gemini (sin OCR previo).
- Salida JSON estricta contra un schema fijo (`CotizacionExtraida`), forzada
  con response_mime_type + response_schema y validada localmente.
- Si la respuesta no es JSON válido según el schema, se reintenta UNA vez
  con un prompt más estricto antes de fallar.
- Este paso no persiste nada en base de datos: solo devuelve lo extraído.
"""

import json

from google.genai import types
from pydantic import BaseModel, ValidationError

from app.core.gemini import generar_contenido


class ErrorRespuestaNoJSON(ValueError):
    """Gemini no devolvió JSON válido según el schema, incluso tras el reintento
    (el router responde 502)."""


# --- Schema fijo de salida (espejo exacto del contrato con el frontend) ----


class ProveedorExtraido(BaseModel):
    nombre: str = ""
    nit: str = ""
    direccion: str = ""
    ciudad: str = ""


class ItemExtraido(BaseModel):
    descripcion: str = ""
    referencia: str = ""  # código/SKU del proveedor, si su cotización lo trae
    unidad: str = ""
    cantidad: float = 0
    valor_unitario: float = 0


class TotalesExtraidos(BaseModel):
    """Totales tal como están IMPRESOS en el PDF (no recalculados).

    Sirven de cifra de control: si la suma de los ítems extraídos no cuadra con
    el total del proveedor, es que Gemini se saltó filas. La prueba E2E detectó
    justo eso (3 conduletas repetidas omitidas en silencio) comparando a mano.
    """

    subtotal: float = 0
    iva: float = 0
    total: float = 0


class CotizacionExtraida(BaseModel):
    proveedor: ProveedorExtraido = ProveedorExtraido()
    numero_cotizacion: str = ""
    items: list[ItemExtraido] = []
    totales_pdf: TotalesExtraidos = TotalesExtraidos()


# --- Prompts ----------------------------------------------------------------

PROMPT_EXTRACCION = """\
Eres un asistente que extrae datos de cotizaciones de proveedores en Colombia.
Analiza el PDF adjunto (una cotización) y devuelve ÚNICAMENTE un JSON con esta
estructura exacta:

{
  "proveedor": {"nombre": "", "nit": "", "direccion": "", "ciudad": ""},
  "numero_cotizacion": "",
  "items": [
    {"descripcion": "", "referencia": "", "unidad": "", "cantidad": 0, "valor_unitario": 0}
  ],
  "totales_pdf": {"subtotal": 0, "iva": 0, "total": 0}
}

Reglas:
- "items": una entrada por línea de producto/servicio cotizado. NO incluyas
  filas de subtotal, descuento, IVA, total, ni notas o condiciones.
- "descripcion": el texto del producto tal como lo escribe el proveedor.
- "referencia": el código, referencia o SKU con que el PROVEEDOR identifica ese
  producto en su propia cotización (columna "Código", "Ref.", "Item", o el
  número que antecede a la descripción). Es el código del proveedor, NO el de
  la empresa compradora. Si no aparece, "".
- "unidad": la unidad de medida tal como aparece (UND, ML, M2, KG, GLB, etc.);
  si no aparece, "".
- "cantidad" y "valor_unitario": números JSON sin separadores de miles ni
  símbolo de moneda, con punto como separador decimal. "valor_unitario" es el
  precio unitario ANTES de IVA si la cotización lo discrimina.
- "nit": solo dígitos y el dígito de verificación si aparece (ej. "900123456-7").
- "numero_cotizacion": el número o código de la cotización tal como aparece.
- "totales_pdf": los totales IMPRESOS al pie de la cotización, copiados tal
  cual, sin recalcularlos ni corregirlos. Si el PDF no discrimina el IVA o no
  muestra subtotal, deja ese campo en 0. Sirven para verificar que no se
  omitió ninguna fila, así que deben reflejar el papel, no tu suma.
- Cualquier dato que no esté en el PDF va como "" (textos) o 0 (números).
"""

PROMPT_REINTENTO = (
    PROMPT_EXTRACCION
    + """
IMPORTANTE: tu respuesta anterior no fue JSON válido. Responde SOLO con el
objeto JSON, en una sola pieza, sin ```json, sin comentarios, sin texto antes
ni después, y con exactamente las claves del schema indicado.
"""
)


# --- Llamadas a Gemini -------------------------------------------------------


def _llamar_gemini(pdf: bytes, prompt: str) -> str | None:
    respuesta = generar_contenido(
        contents=[types.Part.from_bytes(data=pdf, mime_type="application/pdf"), prompt],
        config_generacion=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=CotizacionExtraida,
        ),
    )
    return respuesta.text


def _parsear(texto: str | None) -> CotizacionExtraida | None:
    """Texto de Gemini → CotizacionExtraida, o None si no es JSON válido."""
    if not texto:
        return None
    limpio = texto.strip()
    # Defensa contra cercas de markdown pese al response_mime_type
    if limpio.startswith("```"):
        limpio = limpio.split("\n", 1)[-1] if "\n" in limpio else ""
        limpio = limpio.rsplit("```", 1)[0].strip()
    try:
        return CotizacionExtraida.model_validate(json.loads(limpio))
    except (json.JSONDecodeError, ValidationError):
        return None


def extraer_cotizacion(pdf: bytes) -> CotizacionExtraida:
    """Extrae proveedor, número de cotización e ítems del PDF.

    Reintenta una única vez con un prompt más estricto si la primera
    respuesta no es JSON válido según el schema.
    """
    resultado = _parsear(_llamar_gemini(pdf, PROMPT_EXTRACCION))
    if resultado is not None:
        return resultado

    resultado = _parsear(_llamar_gemini(pdf, PROMPT_REINTENTO))
    if resultado is not None:
        return resultado

    raise ErrorRespuestaNoJSON(
        "Gemini no devolvió un JSON válido para la cotización, incluso tras reintentar"
    )
