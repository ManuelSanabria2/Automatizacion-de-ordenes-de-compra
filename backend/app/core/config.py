"""Configuración central del backend — carga de variables de entorno."""

import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

# Matching de nombres de producto: score mínimo (0-100) del fuzzy matching
# para aceptar candidatos sin recurrir a Gemini.
UMBRAL_FUZZY: float = float(os.getenv("UMBRAL_FUZZY", "70"))

# Score a partir del cual el match se considera de alta confianza y la pantalla
# de revisión lo pinta como "listo". NO auto-confirma ni guarda alias: el
# usuario siempre confirma.
UMBRAL_ALTA_CONFIANZA: float = float(os.getenv("UMBRAL_ALTA_CONFIANZA", "92"))

# Cuántos candidatos se devuelven por ítem a la pantalla de revisión.
MAX_CANDIDATOS: int = int(os.getenv("MAX_CANDIDATOS", "5"))

# Cuántos candidatos por ítem se le muestran a Gemini cuando el fuzzy no
# alcanza el umbral. Antes se le enviaba el catálogo completo (>2000 nombres).
TAMANO_SHORTLIST_GEMINI: int = int(os.getenv("TAMANO_SHORTLIST_GEMINI", "20"))

# Tope de opciones en TODO el prompt. Con pocos ítems dudosos cada uno recibe la
# shortlist completa; con muchos, se reparte para que el prompt no crezca sin
# control (una cotización de 72 ítems difíciles superaría al catálogo entero).
PRESUPUESTO_OPCIONES_GEMINI: int = int(os.getenv("PRESUPUESTO_OPCIONES_GEMINI", "400"))

# Mínimo de opciones por ítem aunque el presupuesto apriete: por debajo de esto
# la sugerencia deja de tener valor.
MIN_SHORTLIST_GEMINI: int = int(os.getenv("MIN_SHORTLIST_GEMINI", "5"))

# Segundos que el catálogo normalizado vive en memoria antes de releerse.
TTL_CACHE_CATALOGO: float = float(os.getenv("TTL_CACHE_CATALOGO", "300"))

# Clave compartida que el frontend envía en el header X-API-Key. Vacía = los
# endpoints quedan abiertos (solo aceptable en desarrollo local).
CLAVE_API_BACKEND: str = os.getenv("CLAVE_API_BACKEND", "")

# Orígenes permitidos por CORS, separados por comas (en producción, el
# dominio del frontend en Vercel).
ORIGENES_CORS: list[str] = [
    origen.strip()
    for origen in os.getenv("ORIGENES_CORS", "http://localhost:3000").split(",")
    if origen.strip()
]

# Plantilla oficial de la Orden de Compra (Excel). Ruta absoluta calculada
# desde este archivo para no depender del directorio de trabajo.
_RAIZ_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLA_ORDEN: str = os.getenv(
    "PLANTILLA_ORDEN",
    os.path.join(_RAIZ_APP, "plantillas", "plantilla_orden_compra.xlsx"),
)
