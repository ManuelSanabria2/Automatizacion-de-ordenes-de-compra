// Módulo de proveedores: catálogo (pendiente) e importación masiva desde Excel.
import Link from "next/link";

export default function ProveedoresPage() {
  return (
    <main className="p-8 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Proveedores</h1>
      <Link href="/proveedores/importar" className="text-blue-600 hover:underline">
        Importar desde Excel
      </Link>
    </main>
  );
}
