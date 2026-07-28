"use client";

// Lo primero que ve el operador al abrir una cotización: qué llegó, cuánto ya
// sabe el sistema y cuánto le toca a él.
//
// El cuadre con el total impreso del PDF es la pieza que evita el fallo
// silencioso: en la prueba end-to-end Gemini se saltó tres filas repetidas sin
// avisar, y solo se descubrió sumando a mano. Ahora se suma solo.

import { formatoCOP, type TotalesExtraidos } from "@/lib/api";
import { Boton, Etiqueta, Tarjeta } from "@/components/Tarjeta";

export interface Conteos {
  total: number;
  yaConocidos: number;
  porRevisar: number;
  sinEncontrar: number;
}

interface Props {
  conteos: Conteos;
  sumaItems: number;
  totalesPdf: TotalesExtraidos;
  alRevisar: () => void;
  alVerTodos: () => void;
}

function Cifra({
  valor,
  etiqueta,
  tono = "normal",
}: {
  valor: number;
  etiqueta: string;
  tono?: "normal" | "atencion" | "alto";
}) {
  const color = {
    normal: "text-tinta",
    atencion: "text-atencion",
    alto: "text-alto",
  }[tono];
  const borde = {
    normal: "border-acero-claro",
    atencion: "border-atencion/40 bg-atencion-fondo",
    alto: "border-alto/30 bg-alto-fondo",
  }[tono];

  return (
    <div className={`rounded-suave border p-4 ${borde}`}>
      <p className={`font-mono text-cifra leading-none font-semibold ${color}`}>{valor}</p>
      <p className="mt-2 text-etiqueta text-acero">{etiqueta}</p>
    </div>
  );
}

export function ResumenCotizacion({
  conteos,
  sumaItems,
  totalesPdf,
  alRevisar,
  alVerTodos,
}: Props) {
  // El PDF puede no traer subtotal discriminado; en ese caso no hay nada que
  // cuadrar y no se inventa una alarma.
  const referencia = totalesPdf.subtotal || 0;
  const hayReferencia = referencia > 0;
  const diferencia = referencia - sumaItems;
  // Un peso de diferencia es redondeo del proveedor, no una fila perdida.
  const cuadra = Math.abs(diferencia) < 1;
  const pendientes = conteos.porRevisar + conteos.sinEncontrar;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra valor={conteos.yaConocidos} etiqueta="Ya los conoces" />
        <Cifra
          valor={conteos.porRevisar}
          etiqueta="Por revisar"
          tono={conteos.porRevisar > 0 ? "atencion" : "normal"}
        />
        <Cifra
          valor={conteos.sinEncontrar}
          etiqueta="Sin encontrar"
          tono={conteos.sinEncontrar > 0 ? "alto" : "normal"}
        />

        {hayReferencia ? (
          <div
            className={`rounded-suave border p-4 ${
              cuadra ? "border-listo/30 bg-listo-fondo" : "border-alto/30 bg-alto-fondo"
            }`}
          >
            <p
              className={`text-cuerpo leading-none font-semibold ${
                cuadra ? "text-listo" : "text-alto"
              }`}
            >
              <span aria-hidden>{cuadra ? "✓ " : "! "}</span>
              {cuadra ? "Cuadra con el PDF" : "No cuadra con el PDF"}
            </p>
            <p className="mt-2 text-etiqueta text-acero">
              {cuadra ? (
                <>Los {conteos.total} ítems suman el total impreso.</>
              ) : (
                <>
                  Faltan {formatoCOP(Math.abs(diferencia))}. Puede que se haya saltado alguna
                  fila: compáralo con el PDF.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-suave border border-acero-claro p-4">
            <p className="text-cuerpo leading-none font-semibold text-acero">Sin total impreso</p>
            <p className="mt-2 text-etiqueta text-acero">
              La cotización no trae subtotal, así que no se puede verificar la suma.
            </p>
          </div>
        )}
      </div>

      <Tarjeta className="p-5">
        {pendientes > 0 ? (
          <>
            <Etiqueta>Siguiente paso</Etiqueta>
            <p className="mt-2 text-item leading-snug">
              {pendientes === 1
                ? "Queda 1 ítem por confirmar."
                : `Quedan ${pendientes} ítems por confirmar.`}{" "}
              <span className="text-acero">
                Los otros {conteos.yaConocidos} ya los habías confirmado antes.
              </span>
            </p>
          </>
        ) : (
          <>
            <Etiqueta>Todo listo</Etiqueta>
            <p className="mt-2 text-item leading-snug">
              Los {conteos.total} ítems están confirmados. Solo falta completar los datos de la
              orden.
            </p>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          {pendientes > 0 && (
            <Boton variante="principal" grande onClick={alRevisar}>
              Revisar los {pendientes} pendientes
            </Boton>
          )}
          <Boton variante={pendientes > 0 ? "normal" : "principal"} grande onClick={alVerTodos}>
            Ver los {conteos.total} ítems
          </Boton>
        </div>
      </Tarjeta>
    </div>
  );
}
