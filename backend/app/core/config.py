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
