// Carga masiva de proveedores: sube un Excel (.xlsx) al backend FastAPI y
// muestra el resumen de la importación (nuevos, actualizados, errores, advertencias).

import { Importador } from "@/components/Importador";

export default function ImportarProveedoresPage() {
  return (
    <Importador
      volverA={{ href: "/proveedores", etiqueta: "Proveedores" }}
      titulo="Cargar proveedores"
      descripcion="Sube un archivo Excel (.xlsx) con las columnas: NIT, Nombre, Dirección, Ciudad, Contacto, Teléfono, Email. NIT y Nombre son obligatorios."
      endpoint="/importacion/importar-proveedores"
    />
  );
}
