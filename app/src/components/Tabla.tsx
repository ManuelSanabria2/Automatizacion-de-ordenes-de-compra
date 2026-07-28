"use client";

// Tabla del sistema. Vive dentro de una tarjeta, así que no lleva bordes
// exteriores: solo separa filas.
//
// El scroll horizontal es suyo, nunca de la página: en móvil se desplaza la
// tabla y el resto de la pantalla se queda quieto.

export function Tabla({
  children,
  descripcion,
  ancho = "56rem",
}: {
  children: React.ReactNode;
  /** Resumen para lectores de pantalla; no se pinta. */
  descripcion: string;
  ancho?: string;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className="w-full border-collapse text-dato"
        style={{ minWidth: ancho }}
      >
        <caption className="sr-only">{descripcion}</caption>
        {children}
      </table>
    </div>
  );
}

export function Cabecera({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-acero-claro">{children}</tr>
    </thead>
  );
}

type CeldaProps = {
  children?: React.ReactNode;
  /** Las cifras a la derecha, para que las unidades se alineen. */
  numerica?: boolean;
  className?: string;
  colSpan?: number;
};

export function Th({ children, numerica, className = "" }: CeldaProps) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase ${
        numerica ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numerica, className = "", colSpan }: CeldaProps) {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-3 align-top ${numerica ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}

export function Fila({
  children,
  atenuada,
  className = "",
}: {
  children: React.ReactNode;
  /** Fila excluida de la orden: se atenúa, pero sigue siendo legible. */
  atenuada?: boolean;
  className?: string;
}) {
  return (
    <tr
      className={`border-b border-acero-claro/60 last:border-b-0 ${
        atenuada ? "text-acero" : "hover:bg-campo"
      } ${className}`}
    >
      {children}
    </tr>
  );
}

/** Lo que se muestra cuando un dato no existe. Nunca una celda en blanco. */
export function Vacio() {
  return (
    <span aria-label="sin dato" className="text-acero">
      —
    </span>
  );
}
