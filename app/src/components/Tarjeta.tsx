"use client";

// Primitivas del sistema: la tarjeta (el papel sobre la mesa), el botón y el
// aviso. La jerarquía la da la elevación, no las líneas.

export function Tarjeta({
  children,
  className = "",
  destacada,
}: {
  children: React.ReactNode;
  className?: string;
  /** La que contiene la decisión en curso: se levanta un paso más. */
  destacada?: boolean;
}) {
  return (
    <section
      className={`rounded-suave border border-acero-claro bg-papel ${
        destacada ? "shadow-[var(--shadow-foco)]" : "shadow-[var(--shadow-tarjeta)]"
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function Titulo({ children }: { children: React.ReactNode }) {
  return <h1 className="text-titulo font-semibold tracking-tight">{children}</h1>;
}

export function Etiqueta({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase ${className}`}
    >
      {children}
    </p>
  );
}

type Variante = "principal" | "normal" | "discreta" | "peligro";

const ESTILOS: Record<Variante, string> = {
  principal: "border-tinta bg-tinta text-papel hover:bg-tinta/90",
  normal: "border-acero-claro bg-papel text-tinta hover:border-acero",
  discreta: "border-transparent bg-transparent text-acero hover:text-tinta",
  peligro: "border-transparent bg-transparent text-alto hover:underline",
};

export function Boton({
  children,
  variante = "normal",
  grande,
  className = "",
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  /** Para las acciones que el operador pulsa cientos de veces. */
  grande?: boolean;
}) {
  return (
    <button
      className={`rounded-suave border font-medium disabled:cursor-not-allowed disabled:border-acero-claro disabled:bg-campo disabled:text-acero ${
        grande ? "px-6 py-3 text-cuerpo" : "px-4 py-2 text-cuerpo"
      } ${ESTILOS[variante]} ${className}`}
      {...resto}
    >
      {children}
    </button>
  );
}

/**
 * Aviso en línea. El color solo aparece cuando significa algo, y nunca va solo:
 * lleva siempre un icono y una palabra, para que se entienda sin distinguirlo.
 */
export function Aviso({
  tono,
  titulo,
  children,
}: {
  tono: "error" | "atencion" | "listo";
  titulo?: string;
  children?: React.ReactNode;
}) {
  const estilos = {
    error: "border-alto/30 bg-alto-fondo text-alto",
    atencion: "border-atencion/40 bg-atencion-fondo text-tinta",
    listo: "border-listo/30 bg-listo-fondo text-listo",
  }[tono];
  const icono = { error: "!", atencion: "!", listo: "✓" }[tono];

  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-suave border px-4 py-3 text-cuerpo ${estilos}`}
    >
      <span aria-hidden className="font-semibold">
        {icono}
      </span>
      <div>
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children}
      </div>
    </div>
  );
}
