// Búsqueda difusa por subsecuencia, al estilo fzf: escribes "codo galv 1/2" y
// encuentra «CODO 90° HG DE 1/2"» aunque no hayas tecleado ni una palabra
// completa. Sustituye al <select> con 2176 opciones que había en la pantalla de
// revisión, donde elegir mal era tan fácil como soltar el ratón.
//
// Normaliza igual que el backend (backend/app/core/texto.py): sin acentos y en
// minúsculas, para que lo que ves al escribir case con lo que el servidor puntuó.

// Abreviaturas del dominio. Sin esto, teclear «codo galv 1/2» no encuentra
// «CODO 90° HG DE 1/2"», porque el proveedor escribe GALV y el catálogo HG:
// son la misma cosa y el operador no tiene por qué saber cuál usa cada uno.
//
// ESPEJO de SINONIMOS en `backend/app/core/texto.py` — misma convención que
// `lib/api.ts` con los modelos Pydantic: si allí se añade una abreviatura,
// añadirla aquí. Solo se replican las que sirven para buscar; el backend tiene
// además las de unidades, que aquí no aportan.
const SINONIMOS: Record<string, string> = {
  galv: "galvanizado",
  galvanizada: "galvanizado",
  hg: "galvanizado",
  cu: "cobre",
  pex: "pe al pe",
  pealpex: "pe al pe",
  pealpe: "pe al pe",
  inox: "inoxidable",
  val: "valvula",
  valv: "valvula",
  tub: "tuberia",
  conect: "conector",
  adapt: "adaptador",
  abraz: "abrazadera",
  flex: "flexible",
  m: "macho",
  h: "hembra",
  "1216": '1/2"',
  "1620": '3/4"',
  "2025": '1"',
};

/** «Válvula GALV 1/2"» → «valvula galvanizado 1/2"» */
export function normalizar(texto: string): string {
  const base = texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return base
    .split(/\s+/)
    .map((palabra) => SINONIMOS[palabra] ?? palabra)
    .join(" ");
}

export interface Coincidencia {
  /** Puntuación relativa; solo sirve para ordenar entre sí. */
  puntos: number;
  /** Índices de los caracteres que casaron, para resaltarlos. */
  indices: number[];
}

/** ¿El carácter anterior indica que aquí empieza una palabra? */
function inicioDePalabra(texto: string, posicion: number): boolean {
  return posicion === 0 || /[\s\-/(.,]/.test(texto[posicion - 1]);
}

/**
 * Busca `consulta` como subsecuencia de `texto`.
 *
 * Puntúa mejor lo que casa literal, lo que casa de corrido y lo que casa al
 * principio de una palabra — que es como se busca de verdad: tecleando el
 * principio de lo que se recuerda.
 *
 * Los espacios separan términos independientes: «codo 1/2» casa aunque en el
 * nombre haya seis palabras entre «codo» y «1/2».
 */
export function coincidir(texto: string, consulta: string): Coincidencia | null {
  const objetivo = normalizar(texto);
  const terminos = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return { puntos: 0, indices: [] };

  let puntos = 0;
  const indices: number[] = [];

  for (const termino of terminos) {
    const casado = casarTermino(objetivo, termino, indices);
    if (!casado) return null;
    puntos += casado.puntos;
    indices.push(...casado.indices);
  }

  // A igualdad de coincidencia, gana el nombre más corto: es más probable que
  // sea el producto buscado y no otro que lo contiene por casualidad.
  puntos -= objetivo.length * 0.05;
  indices.sort((a, b) => a - b);
  return { puntos, indices };
}

function casarTermino(
  objetivo: string,
  termino: string,
  yaUsados: number[],
): Coincidencia | null {
  const usados = new Set(yaUsados);

  // Coincidencia literal: la mejor con diferencia, y la más frecuente cuando
  // se teclea un código.
  const literal = objetivo.indexOf(termino);
  if (literal !== -1) {
    return {
      puntos:
        termino.length * 12 +
        (inicioDePalabra(objetivo, literal) ? 20 : 0) +
        (literal === 0 ? 15 : 0),
      indices: Array.from({ length: termino.length }, (_, i) => literal + i),
    };
  }

  // Subsecuencia: los caracteres en orden, aunque estén separados.
  const indices: number[] = [];
  let desde = 0;
  let anterior = -2;
  let puntos = 0;

  for (const caracter of termino) {
    let encontrado = -1;
    for (let i = desde; i < objetivo.length; i++) {
      if (objetivo[i] === caracter && !usados.has(i)) {
        encontrado = i;
        break;
      }
    }
    if (encontrado === -1) return null;

    if (encontrado === anterior + 1) puntos += 6; // caracteres seguidos
    if (inicioDePalabra(objetivo, encontrado)) puntos += 8;
    puntos += 1;

    indices.push(encontrado);
    anterior = encontrado;
    desde = encontrado + 1;
  }
  return { puntos, indices };
}

export interface Puntuado<T> {
  opcion: T;
  indices: number[];
  puntos: number;
}

/**
 * Filtra y ordena una lista por su ajuste a la consulta.
 *
 * `etiqueta` es el texto que se resalta. `extra` (código, grupo…) también se
 * busca pero no se resalta: teclear un código encuentra el producto sin
 * ensuciar el nombre con marcas.
 */
export function filtrar<T>(
  opciones: readonly T[],
  consulta: string,
  etiqueta: (opcion: T) => string,
  extra?: (opcion: T) => string,
  limite = 60,
): Puntuado<T>[] {
  const termino = consulta.trim();
  if (!termino) {
    return opciones.slice(0, limite).map((opcion) => ({ opcion, indices: [], puntos: 0 }));
  }

  const resultados: Puntuado<T>[] = [];
  for (const opcion of opciones) {
    const enEtiqueta = coincidir(etiqueta(opcion), termino);
    if (enEtiqueta) {
      resultados.push({ opcion, indices: enEtiqueta.indices, puntos: enEtiqueta.puntos });
      continue;
    }
    if (extra) {
      const enExtra = coincidir(extra(opcion), termino);
      // Casar por el campo secundario vale menos que casar por el nombre.
      if (enExtra) resultados.push({ opcion, indices: [], puntos: enExtra.puntos - 30 });
    }
  }

  resultados.sort((a, b) => b.puntos - a.puntos);
  return resultados.slice(0, limite);
}
