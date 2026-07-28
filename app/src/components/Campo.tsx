"use client";

// Campos con etiqueta de verdad. Antes casi todos los inputs de la aplicación
// solo tenían `placeholder`: en cuanto escribes desaparece lo que te decía qué
// ibas a escribir, y un lector de pantalla nunca lo anuncia.

import { useId } from "react";

export const claseCampo =
  "w-full rounded-suave border border-acero-claro bg-papel px-3 py-2 text-cuerpo text-tinta " +
  "focus:border-tinta disabled:bg-campo disabled:text-acero read-only:bg-campo read-only:text-acero";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  /** Aclaración bajo el campo: unidades, formato esperado, consecuencias. */
  ayuda?: string;
  /** Códigos, NIT e importes se leen mejor en monoespaciada. */
  mono?: boolean;
}

export function Campo({
  etiqueta,
  ayuda,
  mono,
  required,
  className = "",
  ...resto
}: Props) {
  const id = useId();
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase"
      >
        {etiqueta}
        {required && (
          <span aria-hidden className="ml-1 text-alto">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        required={required}
        aria-describedby={idAyuda}
        className={`${claseCampo} ${mono ? "font-mono text-dato" : ""} ${className}`}
        {...resto}
      />
      {ayuda && (
        <p id={idAyuda} className="text-etiqueta text-acero">
          {ayuda}
        </p>
      )}
    </div>
  );
}
