// Portada: los cuatro módulos, en el orden del flujo de trabajo.
//
// El primero no es «uno más de la lista»: es lo que el operador viene a hacer
// nueve de cada diez veces, así que ocupa el ancho y lo dice con todas las
// letras. Los otros tres quedan debajo, disponibles pero sin competir.
import Link from "next/link";

const MODULOS = [
  {
    href: "/ordenes",
    titulo: "Órdenes de compra",
    descripcion: "Historial de órdenes generadas y descarga del documento oficial.",
  },
  {
    href: "/catalogo",
    titulo: "Catálogo de productos",
    descripcion:
      "Nombres oficiales de la empresa, con su unidad y tasa de IVA por defecto.",
  },
  {
    href: "/proveedores",
    titulo: "Proveedores",
    descripcion: "Catálogo de proveedores e importación masiva desde Excel.",
  },
];

export default function InicioPage() {
  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h1 className="text-titulo font-semibold tracking-tight">Órdenes de Compra</h1>
        <p className="mt-1 max-w-2xl text-cuerpo text-acero">
          De la cotización del proveedor al documento oficial de ENERCER S.A. E.S.P, con
          consecutivo automático e historial completo.
        </p>
      </div>

      <Link
        href="/cotizaciones"
        className="rounded-suave border border-tinta bg-tinta p-6 text-papel shadow-[var(--shadow-tarjeta)] hover:bg-tinta/90"
      >
        <p className="text-etiqueta font-semibold tracking-[0.06em] text-papel/70 uppercase">
          Empezar aquí
        </p>
        <p className="mt-2 text-item font-medium">Nueva cotización</p>
        <p className="mt-1 max-w-xl text-cuerpo text-papel/80">
          Sube el PDF del proveedor, revisa los ítems extraídos y genera la orden de compra.
        </p>
      </Link>

      <nav className="grid gap-4 sm:grid-cols-3">
        {MODULOS.map((modulo) => (
          <Link
            key={modulo.href}
            href={modulo.href}
            className="rounded-suave border border-acero-claro bg-papel p-5 shadow-[var(--shadow-tarjeta)] hover:border-acero"
          >
            <p className="text-cuerpo font-medium">{modulo.titulo}</p>
            <p className="mt-1 text-cuerpo text-acero">{modulo.descripcion}</p>
          </Link>
        ))}
      </nav>
    </div>
  );
}
