"use client";

// La primitiva difusa. Un mismo componente sirve para tres cosas: la paleta de
// comandos (⌘K), elegir el producto oficial de un ítem y buscar una orden.
//
// Se opera igual con teclado que con ratón, y las teclas van escritas con su
// palabra al pie: quien no sepa que existe ⏎ lo lee en pantalla.

import { useEffect, useMemo, useRef, useState } from "react";
import { filtrar, type Puntuado } from "@/lib/fuzzy";

export interface OpcionBuscador {
  id: string;
  /** Texto principal; sobre él se resaltan los caracteres que casaron. */
  etiqueta: string;
  /** Código, NIT o similar. Se busca y se muestra, pero no se resalta. */
  detalle?: string;
  /** Contexto a la derecha: grupo, fecha, atajo… */
  contexto?: string;
}

interface Props<T extends OpcionBuscador> {
  titulo: string;
  marcador: string;
  opciones: readonly T[];
  alElegir: (opcion: T) => void;
  alCerrar: () => void;
  /** Texto del pie a la derecha, p. ej. «2176 productos». */
  recuento?: (visibles: number, total: number) => string;
  vacio?: string;
}

/** Resalta en peso 600 —no en color— los caracteres que casaron. */
function Resaltado({ texto, indices }: { texto: string; indices: number[] }) {
  if (indices.length === 0) return <>{texto}</>;
  const marcados = new Set(indices);
  return (
    <>
      {Array.from(texto).map((caracter, i) =>
        marcados.has(i) ? (
          <b key={i} className="font-semibold">
            {caracter}
          </b>
        ) : (
          <span key={i}>{caracter}</span>
        ),
      )}
    </>
  );
}

export function Buscador<T extends OpcionBuscador>({
  titulo,
  marcador,
  opciones,
  alElegir,
  alCerrar,
  recuento,
  vacio = "Sin resultados.",
}: Props<T>) {
  const [consulta, setConsulta] = useState("");
  const [activa, setActiva] = useState(0);
  const listaRef = useRef<HTMLUListElement>(null);

  const resultados: Puntuado<T>[] = useMemo(
    () =>
      filtrar(
        opciones,
        consulta,
        (o) => o.etiqueta,
        (o) => `${o.detalle ?? ""} ${o.contexto ?? ""}`,
      ),
    [opciones, consulta],
  );

  // Mantiene visible la opción activa cuando se navega con el teclado.
  useEffect(() => {
    listaRef.current?.children[activa]?.scrollIntoView({ block: "nearest" });
  }, [activa]);

  function alPulsar(evento: React.KeyboardEvent) {
    if (evento.key === "ArrowDown" || (evento.key === "n" && evento.ctrlKey)) {
      evento.preventDefault();
      setActiva((i) => Math.min(i + 1, resultados.length - 1));
    } else if (evento.key === "ArrowUp" || (evento.key === "p" && evento.ctrlKey)) {
      evento.preventDefault();
      setActiva((i) => Math.max(i - 1, 0));
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const elegida = resultados[activa];
      if (elegida) alElegir(elegida.opcion);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      alCerrar();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-tinta/20 px-4 pt-[10vh]"
      onMouseDown={alCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="entrar flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-suave border border-acero-claro bg-papel shadow-[var(--shadow-foco)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="border-b border-acero-claro px-4 py-3 text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase">
          {titulo}
        </p>

        <div className="border-b border-acero-claro px-4">
          <input
            autoFocus
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              // Al cambiar la consulta la selección vuelve arriba: la primera
              // opción siempre es la mejor.
              setActiva(0);
            }}
            onKeyDown={alPulsar}
            placeholder={marcador}
            aria-label={marcador}
            aria-controls="buscador-resultados"
            className="w-full bg-transparent py-3 text-item outline-none"
          />
        </div>

        {resultados.length === 0 ? (
          <p className="px-4 py-8 text-center text-cuerpo text-acero">{vacio}</p>
        ) : (
          <ul
            id="buscador-resultados"
            ref={listaRef}
            role="listbox"
            className="flex-1 overflow-y-auto"
          >
            {resultados.map(({ opcion, indices }, i) => (
              <li key={opcion.id} role="option" aria-selected={i === activa}>
                <button
                  type="button"
                  onMouseEnter={() => setActiva(i)}
                  onClick={() => alElegir(opcion)}
                  className={`flex w-full items-baseline gap-3 border-l-2 px-4 py-2.5 text-left text-cuerpo ${
                    i === activa
                      ? "border-tinta bg-campo"
                      : "border-transparent hover:bg-campo"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <Resaltado texto={opcion.etiqueta} indices={indices} />
                  </span>
                  {opcion.detalle && (
                    <span className="shrink-0 font-mono text-etiqueta text-acero">
                      {opcion.detalle}
                    </span>
                  )}
                  {opcion.contexto && (
                    <span className="hidden shrink-0 truncate text-etiqueta text-acero sm:block sm:max-w-[13rem]">
                      {opcion.contexto}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-acero-claro px-4 py-2.5 text-etiqueta text-acero">
          <span>Escribe para filtrar · pulsa una opción o usa ↑↓ y Enter · Esc cierra</span>
          {recuento && <span>{recuento(resultados.length, opciones.length)}</span>}
        </p>
      </div>
    </div>
  );
}
