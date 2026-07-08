# INSTRUCCIONES.md — Sistema de Generación Automática de Órdenes de Compra

## 1. Resumen del proyecto

Sistema que recibe cotizaciones en PDF de distintos proveedores (cada uno con su propio formato y su propia nomenclatura de productos), extrae los ítems mediante IA, los reconcilia contra el catálogo interno de la empresa, y genera automáticamente la Orden de Compra en el formato oficial de la empresa (plantilla fija tipo ENERCER), preservando secciones fijas, calculando totales/IVA/descuentos, y asignando un consecutivo único.

**Problema que resuelve:** hoy el proceso es manual en Excel, propenso a errores de transcripción, inconsistencias de nombres de producto entre proveedores, y sin trazabilidad de qué se compró y cuándo.

## 2. Objetivo funcional

1. Subir un PDF de cotización de cualquier proveedor.
2. Extraer automáticamente ítems, cantidades, precios y datos del proveedor.
3. Traducir los nombres de producto del proveedor al nombre oficial que maneja la empresa (aprendizaje incremental por proveedor).
4. Permitir completar campos que no vienen en la cotización (proyecto, plazo de entrega, forma de pago, sitio de entrega, descuentos).
5. Calcular subtotal, descuentos, IVA (variable) y total.
6. Generar el documento final de Orden de Compra respetando el formato oficial, con consecutivo automático.
7. Mantener un catálogo de proveedores que se puede cargar masivamente desde Excel.
8. Guardar historial completo para auditoría.

## 3. Stack tecnológico

> **Confirmado con el cliente: esta es una aplicación web (no móvil).** Frontend en Next.js, no Flutter. El resto del stack (Supabase, FastAPI, Gemini) se mantiene consistente con los demás proyectos.

- **Frontend:** Next.js (App Router, TypeScript) — dashboard web de uso interno para la bodega
- **Backend / orquestación IA:** FastAPI (Python)
- **Base de datos:** Supabase (PostgreSQL + RLS + Storage para PDFs y plantillas)
- **IA de extracción:** Gemini API (modelo Flash / Flash-Lite por defecto, ver sección 9)
- **Generación de documento final:** openpyxl (si la plantilla es Excel) o python-docx (si es Word) — se define según el formato real que entregue el cliente
- **Importación de proveedores:** pandas / openpyxl para lectura de Excel

## 4. Arquitectura general (flujo de datos)

```
[PDF cotización] → [FastAPI: /extraer] → [Gemini API] → JSON estructurado
        ↓
[Resolución de nombres: alias_productos] → matching exacto → fuzzy → sugerencia Gemini → manual
        ↓
[Pantalla de revisión: Next.js] → usuario confirma/corrige/agrega descuentos
        ↓
[FastAPI: /generar-orden] → consecutivo atómico + cálculo totales → relleno de plantilla
        ↓
[Documento final] + [Registro en Supabase: ordenes_compra + items]
```

Módulo independiente y paralelo:

```
[Excel de proveedores] → [FastAPI: /importar-proveedores] → validación → upsert en tabla `proveedores`
```

## 5. Modelo de datos (Supabase / PostgreSQL)

```sql
-- Contador consecutivo por año
create table contador_ordenes (
  anio int primary key,
  ultimo_numero int not null default 0
);

-- Catálogo interno — espejo del Excel "Requisición Abastecimientos"
-- (hoja Catalogo: Grupo | Codigo | Item | Unidad). Debe mantener exactamente
-- el mismo nombre (Item) y código de ese archivo. Ni el código ni el nombre
-- son únicos por sí solos (códigos genéricos reutilizados, nombres repetidos
-- en grupos distintos); la combinación nombre + código sí es única.
create table productos_empresa (
  id uuid primary key default gen_random_uuid(),
  nombre_oficial text not null,
  codigo text,
  grupo text,
  unidad_default text,
  tasa_iva_default numeric default 19,
  created_at timestamptz default now()
);

-- Alias por proveedor — aprendizaje de nomenclatura
create table alias_productos (
  id uuid primary key default gen_random_uuid(),
  proveedor_nit text not null,
  nombre_proveedor_texto text not null,
  producto_empresa_id uuid references productos_empresa(id),
  created_at timestamptz default now(),
  unique(proveedor_nit, nombre_proveedor_texto)
);

-- Proveedores — se carga masivamente desde Excel, o se crea al vuelo si no existe
create table proveedores (
  nit text primary key,
  nombre text not null,
  direccion text,
  ciudad text,
  contacto text,
  telefono text,
  email text,
  actualizado_en timestamptz default now()
);

-- Órdenes de compra generadas
create table ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  numero_orden text unique not null,        -- ej: GCS-OC-COR-2026-001
  fecha date not null default current_date,
  proveedor_nit text references proveedores(nit),
  numero_cotizacion text,
  proyecto text,
  plazo_entrega text,
  forma_pago text,
  sitio_entrega text,
  tasa_iva numeric default 19,
  descuento_general_porcentaje numeric default 0,   -- descuento a nivel de toda la orden
  subtotal numeric,
  valor_descuento numeric default 0,
  iva numeric,
  total numeric,
  pdf_cotizacion_url text,                  -- referencia al PDF original en Supabase Storage
  documento_generado_url text,              -- referencia a la orden final generada
  created_at timestamptz default now()
);

create table ordenes_compra_items (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references ordenes_compra(id) on delete cascade,
  item_num int,
  producto_empresa_id uuid references productos_empresa(id),
  descripcion_final text not null,          -- nombre oficial, CONGELADO al momento de la orden
  unidad text,
  cantidad numeric,
  valor_unitario numeric,
  descuento_porcentaje numeric default 0,   -- descuento a nivel de ítem
  valor_total numeric                       -- ya con descuento de ítem aplicado
);
```

**Nota de integridad histórica:** `descripcion_final` guarda el texto congelado en el momento de generar la orden, no una referencia dinámica al catálogo. Si el nombre oficial de un producto cambia después, las órdenes ya emitidas no se alteran retroactivamente.

## 6. Reglas de negocio invariables

### 6.1 Secciones fijas de la plantilla (NUNCA se modifican por el sistema)
- Encabezado de la empresa (logo, NIT, dirección, ciudad) — esquina superior derecha
- Texto completo de "OBLIGACIONES DEL CONTRATISTA"
- Redacción fija del bloque "VALOR Y FORMA DE PAGO" (solo el valor y la forma de pago concretos son variables, el texto envolvente no)
- Encabezados de la tabla de ítems
- Bloque de firma

### 6.2 Campos autogenerados
- **Número de orden:** formato `GCS-OC-COR-{AÑO}-{consecutivo de 3 dígitos}`. El consecutivo **se reinicia en 001 cada año nuevo**. La asignación debe ser atómica (usar función RPC en Supabase con bloqueo de fila) para evitar colisiones si dos órdenes se generan simultáneamente.
- **Fecha:** fecha de generación de la orden.
- **Subtotal, descuento, IVA, total:** calculados por el sistema, nunca digitados manualmente.

### 6.3 Campos extraídos + reconciliados
- Proveedor (nombre, NIT, dirección, ciudad) — si el NIT ya existe en `proveedores`, se autocompleta; si no, se crea.
- Número de cotización del proveedor.
- Ítems: descripción del proveedor → resuelta a nombre oficial vía `alias_productos`.

### 6.4 Campos manuales obligatorios (no vienen en el PDF)
- Proyecto
- Plazo de entrega
- Forma de pago (texto)
- Sitio de entrega
- Tasa de IVA aplicable a la orden (por defecto 19%, editable — hay productos exentos)
- Descuentos (por ítem y/o general de la orden), si aplica

### 6.5 Lógica de descuentos
- **Descuento por ítem:** porcentaje aplicado sobre `cantidad × valor_unitario` de esa línea, antes de sumar al subtotal.
- **Descuento general de la orden:** porcentaje aplicado sobre el subtotal ya con descuentos de ítem aplicados, antes de calcular el IVA.
- **Orden de cálculo:** `valor_total_item = cantidad × valor_unitario × (1 − descuento_item/100)` → `subtotal = Σ valor_total_item` → `valor_descuento_general = subtotal × descuento_general/100` → `base_iva = subtotal − valor_descuento_general` → `iva = base_iva × tasa_iva/100` → `total = base_iva + iva`.
- Ambos descuentos son opcionales y por defecto 0.

### 6.6 Módulo de proveedores vía Excel
- El cliente debe poder cargar/actualizar el catálogo de proveedores subiendo un Excel con columnas: `NIT, Nombre, Dirección, Ciudad, Contacto, Teléfono, Email`.
- Importación debe hacer **upsert** por NIT (si el NIT ya existe, actualiza los demás campos; si no existe, lo crea).
- Debe mostrarse un resumen post-importación: cuántos proveedores nuevos, cuántos actualizados, cuántas filas con errores (NIT vacío o duplicado dentro del mismo archivo, columnas faltantes).
- La importación no debe borrar proveedores existentes que no aparezcan en el nuevo Excel (es una carga incremental, no un reemplazo total).

## 7. Flujo funcional completo (paso a paso)

1. Usuario sube PDF de cotización.
2. Sistema extrae datos vía Gemini → JSON con proveedor, cotización, ítems.
3. Sistema busca el proveedor por NIT en `proveedores`; si no existe, lo prellena para confirmación/creación.
4. Para cada ítem: busca en `alias_productos` (match exacto) → si no hay, aplica fuzzy matching contra `productos_empresa` → si no hay coincidencia con confianza suficiente, pide a Gemini una sugerencia razonada → si aún así no hay match aceptable, se marca para resolución manual.
5. Pantalla de revisión: usuario ve cada ítem con el nombre resuelto, puede corregirlo (lo cual actualiza/crea el alias), agregar descuentos por ítem, y completar proyecto / plazo de entrega / forma de pago / sitio de entrega / tasa de IVA / descuento general.
6. Usuario confirma → sistema obtiene el consecutivo del año actual, calcula subtotal/descuentos/IVA/total, y genera el documento final llenando la plantilla oficial.
7. Se guarda el registro completo (orden + ítems) y se almacena el documento generado y el PDF original en Supabase Storage.

## 8. Consideraciones para la integración con Gemini

- Modelo por defecto: **Gemini 2.5 Flash-Lite** (gratuito dentro de límites de tasa razonables para el volumen esperado). Dejar el modelo configurable por variable de entorno para poder subir a Flash o Pro si la precisión de extracción lo requiere con proveedores de formato muy irregular.
- El prompt de extracción debe forzar salida en JSON estructurado (schema fijo), nunca texto libre.
- El PDF se envía directamente a Gemini (soporta PDF/imagen nativamente) — no es necesario hacer OCR previo.
- El uso de Gemini para sugerencia de matching de nombres debe ser la excepción, no la regla — solo se invoca cuando el fuzzy matching por texto no encuentra un candidato con score suficiente. Esto mantiene el consumo de tokens mínimo.

## 9. Seguridad y control de acceso
- RLS en Supabase: todas las tablas accesibles solo para usuarios autenticados de la empresa (contexto single-tenant, similar al ajuste ya hecho en Don Héctor POS).
- El PDF original de cada cotización se conserva en Storage vinculado a la orden generada, para trazabilidad y auditoría.
- Las claves de Gemini API nunca se exponen en el cliente (frontend Next.js) — todas las llamadas pasan por el backend FastAPI.

## 10. Fuera de alcance (por ahora)
- Multi-empresa / multi-tenant (se asume una sola empresa usando el sistema).
- Aprobaciones/flujo de firmas digitales.
- Integración contable automática (ERP) — el sistema genera el documento, no lo contabiliza.
- Notificaciones automáticas al proveedor.