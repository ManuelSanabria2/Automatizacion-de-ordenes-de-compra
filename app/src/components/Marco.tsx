"use client";

// La cáscara de la aplicación: una barra con los cuatro destinos escritos y el
// contenido sobre el campo gris.
//
// Sin paleta de comandos ni atajos: el operador de esta app no es programador y
// ⌘K solo sería ruido. Todo lo que se puede hacer está escrito y se puede pulsar.

import Link from "next/link";
import { usePathname } from "next/navigation";

const DESTINOS = [
  { href: "/cotizaciones", etiqueta: "Cotizaciones" },
  { href: "/ordenes", etiqueta: "Órdenes" },
  { href: "/catalogo", etiqueta: "Catálogo" },
  { href: "/proveedores", etiqueta: "Proveedores" },
];

export function Marco({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();

  return (
    <div className="min-h-full">
      <header className="border-b border-acero-claro bg-papel">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <Link href="/" className="text-cuerpo font-semibold">
            ENERCER
            <span className="ml-2 font-normal text-acero">Órdenes de compra</span>
          </Link>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {DESTINOS.map((destino) => {
              const activo = ruta.startsWith(destino.href);
              return (
                <Link
                  key={destino.href}
                  href={destino.href}
                  aria-current={activo ? "page" : undefined}
                  className={
                    activo
                      ? "border-b-2 border-tinta pb-1 text-cuerpo font-medium"
                      : "border-b-2 border-transparent pb-1 text-cuerpo text-acero hover:text-tinta"
                  }
                >
                  {destino.etiqueta}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-5 py-6">{children}</div>
    </div>
  );
}
