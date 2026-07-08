// Panel de inicio: acceso a los módulos del sistema, en el orden del flujo.
import Link from "next/link";

const MODULOS = [
  {
    href: "/cotizaciones",
    titulo: "Nueva cotización",
    descripcion:
      "Sube el PDF del proveedor, revisa los ítems extraídos y genera la orden de compra.",
    destacado: true,
  },
  {
    href: "/ordenes",
    titulo: "Órdenes de compra",
    descripcion: "Historial de órdenes generadas y descarga del documento oficial.",
    destacado: false,
  },
  {
    href: "/catalogo",
    titulo: "Catálogo de productos",
    descripcion:
      "Nombres oficiales de la empresa, con su unidad y tasa de IVA por defecto.",
    destacado: false,
  },
  {
    href: "/proveedores",
    titulo: "Proveedores",
    descripcion: "Catálogo de proveedores e importación masiva desde Excel.",
    destacado: false,
  },
];

export default function InicioPage() {
  return (
    <main className="p-8 max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Órdenes de Compra</h1>
        <p className="text-sm text-gray-600 mt-1">
          De la cotización del proveedor al documento oficial de ENERCER S.A. E.S.P,
          con consecutivo automático e historial completo.
        </p>
      </div>

      <nav className="grid gap-4 sm:grid-cols-2">
        {MODULOS.map((modulo) => (
          <Link
            key={modulo.href}
            href={modulo.href}
            className={
              modulo.destacado
                ? "rounded border border-blue-600 bg-blue-600 p-4 text-white hover:bg-blue-700"
                : "rounded border border-gray-300 p-4 hover:border-blue-600 hover:bg-gray-50"
            }
          >
            <h2 className="font-medium">{modulo.titulo}</h2>
            <p
              className={`text-sm mt-1 ${modulo.destacado ? "text-blue-100" : "text-gray-600"}`}
            >
              {modulo.descripcion}
            </p>
          </Link>
        ))}
      </nav>
    </main>
  );
}
