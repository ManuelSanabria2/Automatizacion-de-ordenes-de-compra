// Por qué el sistema propone este producto.
//
// El motor devuelve una confianza numérica, pero «73 %» no le sirve a nadie
// para decidir: no dice en qué se parecen ni en qué no. Aquí se traduce a lo
// que el operador sí puede juzgar — «coinciden: tapón, macho, galvanizado y la
// medida 1/2"» — y, sobre todo, se avisa cuando la medida NO coincide, que es
// donde se cuelan los errores caros: un codo de 3/8" y uno de 3/4" tienen
// nombres casi idénticos y son artículos distintos.
//
// Reutiliza la normalización de `lib/fuzzy.ts`, que ya expande las abreviaturas
// del dominio (GALV→galvanizado, M→macho, 1216→1/2").

import { normalizar } from "./fuzzy";

// Palabras sin valor para comparar: aparecen en casi cualquier descripción.
const VACIAS = new Set([
  "de","del","la","el","los","las","y","con","para","en","por","a","x","al","un","una",
]);

const MEDIDA = /^(?:\d+\/\d+|\d+(?:\.\d+)?)(?:"|mm|cm|mm2|awg)?$/;

/** ¿Este token expresa una medida (3/8, 1/2", 20mm, 8awg)? */
function esMedida(token: string): boolean {
  return MEDIDA.test(token) && /\d/.test(token);
}

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/[\s,()]+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((t) => t.length > 0 && !VACIAS.has(t));
}

export interface Comparacion {
  /** Palabras que aparecen en los dos textos, en el orden del proveedor. */
  comunes: string[];
  /** Medidas presentes en ambos (1/2", 3/8). */
  medidasComunes: string[];
  /** Medidas del proveedor que el producto no tiene. */
  medidasSoloProveedor: string[];
  /** Medidas del producto que el proveedor no menciona. */
  medidasSoloProducto: string[];
  /** Las medidas se contradicen: los dos declaran medida y ninguna coincide. */
  medidaEnConflicto: boolean;
}

/**
 * Compara el texto del proveedor con el nombre oficial del catálogo.
 *
 * Devuelve qué comparten y qué no, ya normalizado y listo para mostrar.
 */
export function comparar(textoProveedor: string, nombreOficial: string): Comparacion {
  const izquierda = tokens(textoProveedor);
  const derecha = new Set(tokens(nombreOficial));

  const comunes: string[] = [];
  const medidasComunes: string[] = [];
  const vistos = new Set<string>();

  for (const token of izquierda) {
    if (vistos.has(token) || !derecha.has(token)) continue;
    vistos.add(token);
    if (esMedida(token)) medidasComunes.push(token);
    else comunes.push(token);
  }

  const medidasIzquierda = izquierda.filter(esMedida);
  const medidasDerecha = [...derecha].filter(esMedida);
  const enComun = new Set(medidasComunes);
  const medidasSoloProveedor = [...new Set(medidasIzquierda)].filter((m) => !enComun.has(m));
  const medidasSoloProducto = medidasDerecha.filter((m) => !enComun.has(m));

  return {
    comunes,
    medidasComunes,
    medidasSoloProveedor,
    medidasSoloProducto,
    // Solo es conflicto si AMBOS declaran medida y no comparten ninguna. Si uno
    // de los dos no la menciona, no hay contradicción: falta información.
    medidaEnConflicto:
      medidasComunes.length === 0 &&
      medidasIzquierda.length > 0 &&
      medidasDerecha.length > 0,
  };
}

/** «tapón · macho · galvanizado · medida 1/2"» — vacío si no comparten nada. */
export function resumirCoincidencias(comparacion: Comparacion): string[] {
  return [
    ...comparacion.comunes,
    ...comparacion.medidasComunes.map((m) => `medida ${m}`),
  ];
}

/**
 * La advertencia que hay que leer antes de confirmar, o null si no hay ninguna.
 *
 * Es el aviso que habría evitado que 10 de 21 alias de la base apuntaran al
 * producto equivocado.
 */
export function advertirDiferencia(comparacion: Comparacion): string | null {
  if (comparacion.medidaEnConflicto) {
    const suya = comparacion.medidasSoloProveedor.join(", ");
    const nuestra = comparacion.medidasSoloProducto.join(", ");
    return `El proveedor dice ${suya} y este producto es ${nuestra}.`;
  }
  if (comparacion.comunes.length === 0 && comparacion.medidasComunes.length === 0) {
    return "No comparten ninguna palabra: revísalo con cuidado.";
  }
  return null;
}
