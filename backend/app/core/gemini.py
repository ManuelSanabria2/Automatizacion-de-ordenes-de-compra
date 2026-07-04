"""Cliente Gemini compartido del backend.

La creación es perezosa (lru_cache) para que importar el módulo no falle
cuando el entorno aún no está configurado.
"""

from functools import lru_cache

from google import genai

from app.core import config


@lru_cache(maxsize=1)
def obtener_cliente() -> genai.Client:
    if not config.GEMINI_API_KEY:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno (.env)")
    return genai.Client(api_key=config.GEMINI_API_KEY)
