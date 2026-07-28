"use client";

// El elemento central de la aplicación: una decisión, a tamaño de decisión.
//
// A la izquierda lo que escribió el proveedor; a la derecha lo que el sistema
// propone del catálogo. Y debajo, lo único que de verdad ayuda a decidir: en
// qué coinciden y en qué no.
//
// «73 %» no le sirve a nadie para juzgar. «Coinciden: tapón, macho,
// galvanizado y la medida 1/2"» sí. Y cuando la medida se contradice —el error
// caro de este dominio, porque un codo de 3/8" y uno de 3/4" se llaman casi
// igual— se dice antes de que la persona pulse «Sí».

import { comparar, resumirCoincidencias, advertirDiferencia } from "@/lib/coincidencias";
import { formatoCOP, type Producto } from "@/lib/api";
import { Boton, Etiqueta } from "@/components/Tarjeta";

interface Props {
  posicion: number;
  total: number;
  descripcion: string;
  referencia: string;
  unidad: string;
  cantidad: number;
  valorUnitario: number;
  /** El producto propuesto, o null si el sistema no encontró ninguno. */
  producto: Producto | null;
  /** Por qué lo propone: «Ya lo confirmaste antes», «Sugerido por Gemini»… */
  procedencia: string;
  justificacion: string | null;
  guardando: boolean;
  error: string | null;
  alConfirmar: () => void;
  alBuscarOtro: () => void;
  alOmitir: () => void;
}

export function TarjetaDecision({
  posicion,
  total,
  descripcion,
  referencia,
  unidad,
  cantidad,
  valorUnitario,
  producto,
  procedencia,
  justificacion,
  guardando,
  error,
  alConfirmar,
  alBuscarOtro,
  alOmitir,
}: Props) {
  const comparacion = producto ? comparar(descripcion, producto.nombre_oficial) : null;
  const coincidencias = comparacion ? resumirCoincidencias(comparacion) : [];
  const advertencia = comparacion ? advertirDiferencia(comparacion) : null;

  return (
    <div className="entrar">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Etiqueta>
          Ítem {posicion} de {total}
        </Etiqueta>
        <Progreso hechos={posicion - 1} total={total} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        {/* Lo que llegó */}
        <div className="rounded-suave border border-acero-claro bg-campo p-5">
          <Etiqueta className="mb-2">El proveedor escribió</Etiqueta>
          <p className="text-item leading-snug font-medium">{descripcion}</p>
          <p className="mt-3 font-mono text-dato text-acero">
            {cantidad} {unidad || "und"} × {formatoCOP(valorUnitario)}
          </p>
          {referencia && (
            <p className="mt-1 font-mono text-etiqueta text-acero">Ref. {referencia}</p>
          )}
        </div>

        <div
          aria-hidden
          className="hidden items-center justify-center text-acero md:flex"
        >
          →
        </div>

        {/* Lo que propone el sistema */}
        <div
          className={`rounded-suave border p-5 ${
            producto ? "border-acero-claro bg-papel" : "border-alto/40 bg-alto-fondo"
          }`}
        >
          <Etiqueta className="mb-2">
            {producto ? "El catálogo tiene" : "Sin producto asignado"}
          </Etiqueta>
          {producto ? (
            <>
              <p className="text-item leading-snug font-medium">{producto.nombre_oficial}</p>
              <p className="mt-3 font-mono text-dato text-acero">
                {producto.codigo ?? "sin código"}
                {producto.grupo ? ` · ${producto.grupo}` : ""}
              </p>
              <p className="mt-1 text-etiqueta text-acero">{procedencia}</p>
            </>
          ) : (
            <p className="text-cuerpo text-tinta">
              El sistema no encontró ningún producto parecido. Búscalo en el catálogo o créalo.
            </p>
          )}
        </div>
      </div>

      {/* Por qué. Lo que convierte la decisión en juicio y no en fe. */}
      {producto && (
        <div className="mt-4 rounded-suave border border-acero-claro bg-papel p-4">
          {coincidencias.length > 0 ? (
            <p className="text-cuerpo">
              <span className="text-acero">Coinciden: </span>
              {coincidencias.map((palabra, i) => (
                <span key={palabra}>
                  {i > 0 && <span className="text-acero"> · </span>}
                  <span className="font-medium">{palabra}</span>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-cuerpo text-acero">
              No comparten ninguna palabra reconocible.
            </p>
          )}

          {advertencia && (
            <p className="mt-2 flex gap-2 text-cuerpo text-alto">
              <span aria-hidden className="font-semibold">
                !
              </span>
              <span>{advertencia}</span>
            </p>
          )}

          {justificacion && (
            <p className="mt-2 text-cuerpo text-acero">{justificacion}</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-cuerpo text-alto">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Boton
          variante="principal"
          grande
          onClick={alConfirmar}
          disabled={!producto || guardando}
        >
          {guardando ? "Guardando…" : "Sí, es este"}
        </Boton>
        <Boton variante="normal" grande onClick={alBuscarOtro}>
          {producto ? "Buscar otro" : "Buscar en el catálogo"}
        </Boton>
        <Boton variante="discreta" onClick={alOmitir}>
          Dejarlo para después
        </Boton>
      </div>
    </div>
  );
}

/** Avance de la revisión: se ve cuánto falta sin tener que contar. */
export function Progreso({ hechos, total }: { hechos: number; total: number }) {
  const porcentaje = total === 0 ? 0 : Math.round((hechos / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuenow={hechos}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${hechos} de ${total} revisados`}
        className="h-1.5 w-40 overflow-hidden rounded-suave bg-acero-claro"
      >
        <div
          className="h-full bg-listo transition-[width] duration-200"
          style={{ width: `${porcentaje}%` }}
        />
      </div>
      <span className="font-mono text-etiqueta text-acero">
        {hechos}/{total}
      </span>
    </div>
  );
}
