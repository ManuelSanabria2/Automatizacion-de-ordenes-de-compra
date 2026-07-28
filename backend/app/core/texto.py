"""Normalización de texto compartida (nombres de producto, NIT, encabezados).

Punto único de verdad para comparar textos en todo el backend. Lo usan el
matching de productos (`resolucion_productos`), el aprendizaje de alias
(`alias_productos`) y la lectura de Excel (`importacion_*`).

Regla de oro: **normalizar solo para comparar, nunca para almacenar.** El
`nombre_oficial` del catálogo y el texto del proveedor se guardan literales; lo
normalizado es un derivado que se calcula al vuelo.
"""

import re
import unicodedata

# Abreviaturas y variantes del dominio (ferretería, gasodomésticos, eléctrico).
# Se aplican por palabra completa sobre el texto ya sin acentos y en minúsculas.
# Es DATO, no lógica: ampliarlo no requiere tocar el algoritmo. Cada entrada
# debe justificarse con una cotización real — ver tests/evaluar_resolucion.py.
SINONIMOS: dict[str, str] = {
    # Unidades de medida
    "und": "unidad",
    "un": "unidad",
    "unid": "unidad",
    "uds": "unidad",
    "mts": "metro",
    "mt": "metro",
    "mtr": "metro",
    "ml": "metro",  # metro lineal
    "cms": "centimetro",
    "cm": "centimetro",
    "mm": "milimetro",
    "kg": "kilogramo",
    "kgs": "kilogramo",
    "gl": "galon",
    "glb": "global",
    "pulg": "pulgada",
    "plg": "pulgada",
    "pza": "pieza",
    "pzas": "pieza",
    # Género de la rosca: en las cotizaciones "M"/"H" son macho/hembra
    # ("TAPON M GALV", "NPTm", "NPTH"), nunca metro ni hora.
    "m": "macho",
    "h": "hembra",
    "mm2": "mm2",
    # Materiales y acabados: proveedor y catálogo nombran distinto lo mismo
    # (HG = hierro galvanizado).
    "galv": "galvanizado",
    "galvanizada": "galvanizado",
    "hg": "galvanizado",
    "cu": "cobre",
    "pex": "pe al pe",
    "pealpex": "pe al pe",
    "pealpe": "pe al pe",
    "inox": "inoxidable",
    # Códigos de calibre del tubo multicapa PE-AL-PE: "1216" es 16 mm exterior
    # y 12 mm interior, que el catálogo nombra por su equivalencia en pulgadas.
    "1216": '1/2"',
    "1620": '3/4"',
    "2025": '1"',
    # Accesorios abreviados
    "val": "valvula",
    "valv": "valvula",
    "tub": "tuberia",
    "conect": "conector",
    "adapt": "adaptador",
    "abraz": "abrazadera",
    "flex": "flexible",
    "ced": "cedula",
}

# Palabras sin valor discriminante: aparecen en casi todas las descripciones de
# un proveedor y solo añaden ruido al score.
VACIAS: frozenset[str] = frozenset({"de", "del", "la", "el", "los", "las", "y", "con", "para", "en", "por", "a"})

_NO_ALFANUMERICO = re.compile(r"[^0-9a-z/\"'.#\s-]+")
_ESPACIOS = re.compile(r"\s+")
_SOLO_DIGITOS = re.compile(r"\D")


def quitar_acentos(texto: str) -> str:
    """"Válvula" → "Valvula". Descompone en NFD y descarta los diacríticos."""
    return "".join(
        c for c in unicodedata.normalize("NFD", str(texto)) if not unicodedata.combining(c)
    )


def normalizar_encabezado(texto: str) -> str:
    """"Dirección", "DIRECCION" y " direccion " se vuelven "direccion".

    Vive aquí (y no en `importacion_proveedores`, de donde viene) para que
    lectura de Excel y matching compartan el mismo criterio de acentos.
    """
    return quitar_acentos(texto).strip().lower()


def normalizar(texto: str) -> str:
    """Texto listo para comparar: sin acentos, en minúsculas, sin puntuación
    ornamental, con abreviaturas expandidas y sin palabras vacías.

    Se conservan `/`, `"`, `'`, `.` y `-` porque son significativos en este
    dominio: `1/2"`, `3/8`, `G2.5`, `PE-AL-PE`.

    >>> normalizar('CODO 90° GALV 1/2"')
    'codo 90 galvanizado 1/2"'
    """
    base = _NO_ALFANUMERICO.sub(" ", quitar_acentos(texto).lower())
    # Los guiones separan palabras ("PE-AL-PE"), pero no dentro de un número.
    base = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", base)
    # "#" marca calibre y debe quedar como token propio: "THHN# 8" y "THHN # 8"
    # tienen que producir los mismos tokens.
    base = base.replace("#", " # ")
    palabras = []
    for palabra in _ESPACIOS.sub(" ", base).strip().split(" "):
        limpia = palabra.strip(".-")
        if not limpia or limpia in VACIAS:
            continue
        palabras.append(SINONIMOS.get(limpia, limpia))
    return " ".join(palabras)


_MEDIDA = re.compile(
    r'\d+/\d+'  # fracción de pulgada: 3/8, 1/2
    r'|\d+(?:\.\d+)?\s*(?:"|pulgada|mm2|mm|milimetro|cm|centimetro)'  # con unidad
    r'|#\s*\d+(?:/\d+)?'  # calibre: "# 8", "#2/0"
    r'|\d+\s*awg'  # calibre escrito como "8AWG"
)


def extraer_medidas(texto_normalizado: str) -> frozenset[str]:
    """Medidas presentes en un texto YA normalizado (`3/8"`, `1/2`, `20 mm`).

    En ferretería la medida *es* la identidad del producto: un codo de 3/8" y
    uno de 3/4" son artículos distintos aunque sus nombres se parezcan en un
    97 %. El matching las compara aparte para que la similitud textual no las
    pise.

    Solo se recogen los números que llevan marca de medida (fracción, comillas
    o unidad); los sueltos se ignoran a propósito, porque suelen ser ángulos
    ("codo 90") o cantidades.

    >>> sorted(extraer_medidas('codo 90 galvanizado 3/8"'))
    ['3/8']
    """
    medidas = set()
    for bruto in _MEDIDA.findall(texto_normalizado):
        limpio = bruto.replace('"', "").replace(" ", "").replace("#", "")
        for sufijo in ("pulgada", "milimetro", "centimetro", "mm2", "mm", "cm", "awg"):
            limpio = limpio.replace(sufijo, "")
        if limpio:
            medidas.add(limpio)
    return frozenset(medidas)


def normalizar_nit(nit: str) -> str:
    """NIT en forma canónica: solo dígitos, sin el dígito de verificación.

    Los PDF traen el mismo NIT de todas las formas ("830.113.629",
    "900.385.084-5", "800081030-1"). Sin esto el aprendizaje de alias se
    fragmenta: cada formato crea su propia familia de alias para el mismo
    proveedor.

    >>> normalizar_nit("900.385.084-5")
    '900385084'
    >>> normalizar_nit("830.113.629")
    '830113629'
    """
    limpio = str(nit).strip()
    if not limpio:
        return ""
    # El dígito de verificación va tras el último guion y es un solo dígito.
    cuerpo, guion, verificacion = limpio.rpartition("-")
    if guion and len(_SOLO_DIGITOS.sub("", verificacion)) == 1:
        limpio = cuerpo
    return _SOLO_DIGITOS.sub("", limpio)
