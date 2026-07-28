"use client";

// El selector de producto oficial.
//
// Sustituye al <select> que pintaba los 2176 productos del catálogo en cada
// fila. Aquel control era la causa directa de que 10 de los 21 alias guardados
// apuntaran al producto equivocado: todos a los primeros por orden alfabético,
// porque elegir mal era tan fácil como soltar el ratón sin querer.
//
// Aquí se escriben tres letras y se elige. Busca por nombre y por código, así
// que sirve tanto a quien recuerda el nombre como a quien tiene el código
// delante.

import { Buscador, type OpcionBuscador } from "@/components/Buscador";
import type { Producto } from "@/lib/api";

interface OpcionProducto extends OpcionBuscador {
  producto: Producto;
}

export const CREAR_NUEVO = "__nuevo__";

interface Props {
  catalogo: Producto[];
  /** Texto del proveedor, para saber qué se está resolviendo. */
  textoProveedor: string;
  alElegir: (productoId: string) => void;
  alCerrar: () => void;
  /** Si se pasa, aparece la opción de crear un producto que no existe. */
  alCrearNuevo?: () => void;
}

export function BuscadorProducto({
  catalogo,
  textoProveedor,
  alElegir,
  alCerrar,
  alCrearNuevo,
}: Props) {
  const opciones: OpcionProducto[] = catalogo.map((producto) => ({
    id: producto.id,
    etiqueta: producto.nombre_oficial,
    detalle: producto.codigo ?? undefined,
    contexto: producto.grupo ?? undefined,
    producto,
  }));

  if (alCrearNuevo) {
    opciones.push({
      id: CREAR_NUEVO,
      etiqueta: "+ Crear producto nuevo…",
      contexto: "No está en el catálogo",
      producto: {
        id: CREAR_NUEVO,
        nombre_oficial: "",
        codigo: null,
        grupo: null,
        unidad_default: null,
        tasa_iva_default: 19,
      },
    });
  }

  return (
    <Buscador
      titulo={`Producto para: ${textoProveedor}`}
      marcador="Nombre o código del catálogo…"
      opciones={opciones}
      vacio="Ningún producto coincide. Prueba con menos palabras."
      recuento={(visibles, total) =>
        visibles === total ? `${total} productos` : `${visibles} de ${total}`
      }
      alCerrar={alCerrar}
      alElegir={(opcion) => {
        if (opcion.id === CREAR_NUEVO) {
          alCerrar();
          alCrearNuevo?.();
          return;
        }
        alElegir(opcion.id);
        alCerrar();
      }}
    />
  );
}
