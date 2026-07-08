"""Cliente Gemini compartido del backend.

La creación es perezosa (lru_cache) para que importar el módulo no falle
cuando el entorno aún no está configurado.
"""

import time
from functools import lru_cache

from google import genai
from google.genai import errors, types

from app.core import config

# Errores transitorios de la API (sobrecarga del modelo, rate limit): se
# reintenta con espera exponencial antes de propagar el error.
CODIGOS_TRANSITORIOS = {429, 500, 503, 504}
INTENTOS_MAXIMOS = 3
ESPERA_BASE_SEGUNDOS = 2.0


@lru_cache(maxsize=1)
def obtener_cliente() -> genai.Client:
    if not config.GEMINI_API_KEY:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno (.env)")
    return genai.Client(api_key=config.GEMINI_API_KEY)


def generar_contenido(
    contents, config_generacion: types.GenerateContentConfig
) -> types.GenerateContentResponse:
    """generate_content contra GEMINI_MODEL con reintentos automáticos.

    Ante un error transitorio (429/500/503/504, p. ej. "high demand") espera
    2 s y luego 4 s antes de rendirse; cualquier otro error se propaga de
    inmediato.
    """
    for intento in range(INTENTOS_MAXIMOS):
        try:
            return obtener_cliente().models.generate_content(
                model=config.GEMINI_MODEL,
                contents=contents,
                config=config_generacion,
            )
        except errors.APIError as exc:
            if exc.code not in CODIGOS_TRANSITORIOS or intento == INTENTOS_MAXIMOS - 1:
                raise
            time.sleep(ESPERA_BASE_SEGUNDOS * 2**intento)
    raise AssertionError("inalcanzable: el bucle siempre devuelve o propaga")
