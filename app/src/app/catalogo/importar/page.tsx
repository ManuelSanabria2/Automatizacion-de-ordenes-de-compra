// Carga masiva del catálogo oficial: sube el Excel "Requisición Abastecimientos"
// (hoja Catalogo: Grupo | Codigo | Item | Unidad) al backend FastAPI y muestra
// el resumen de la sincronización (nuevos, actualizados, sin cambios, errores).
// La carga es incremental: nunca borra productos ausentes del archivo.

import { Importador } from "@/components/Importador";

export default function ImportarCatalogoPage() {
  return (
    <Importador
      volverA={{ href: "/catalogo", etiqueta: "Catálogo" }}
      titulo="Cargar catálogo oficial"
      descripcion="Sube el Excel «Requisición Abastecimientos» (columnas: Grupo, Codigo, Item, Unidad). Los productos se identifican por nombre + código: los nuevos se crean, los existentes actualizan grupo y unidad, y nunca se borra ninguno."
      endpoint="/importacion/importar-catalogo"
    />
  );
}
