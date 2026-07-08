"""Protección de los endpoints con clave API compartida (fase 1).

El frontend envía la clave en el header X-API-Key y aquí se compara contra
CLAVE_API_BACKEND. Si la variable está vacía, no se exige nada (desarrollo
local). Fase 2 pendiente: Supabase Auth con JWT por usuario.
"""

import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from app.core import config

# auto_error=False para responder 401 con mensaje propio (y en español)
# en vez del 403 genérico de FastAPI cuando falta el header.
_esquema_clave = APIKeyHeader(name="X-API-Key", auto_error=False)


def verificar_clave_api(clave: str | None = Security(_esquema_clave)) -> None:
    if not config.CLAVE_API_BACKEND:
        return
    if clave is None or not secrets.compare_digest(clave, config.CLAVE_API_BACKEND):
        raise HTTPException(status_code=401, detail="Clave API inválida o ausente")
