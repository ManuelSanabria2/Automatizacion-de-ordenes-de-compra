-- Aprendizaje de alias: NIT canónico y referencia del proveedor.
--
-- 1) El NIT se guardaba tal como venía del PDF ("830.113.629", "800081030-1",
--    "860030640"), así que el mismo proveedor generaba varias familias de alias
--    y el sistema no reconocía lo que ya había aprendido. Se normaliza a solo
--    dígitos, sin dígito de verificación — el mismo criterio que
--    `app.core.texto.normalizar_nit`.
--
-- 2) Se añade `referencia_proveedor`: el código/SKU que el proveedor imprime en
--    su cotización. Es una clave mucho más estable que el texto libre (el
--    proveedor reescribe la descripción, pero no su propia referencia). No
--    lleva restricción de unicidad propia: la identidad del alias sigue siendo
--    (proveedor_nit, nombre_proveedor_texto); la referencia es una vía de
--    búsqueda adicional.
--
-- OJO: el paso 1 puede colapsar dos filas en la misma clave única
-- (proveedor_nit, nombre_proveedor_texto). Se deduplica ANTES de normalizar,
-- conservando la más reciente. HACER RESPALDO antes de aplicar.

-- Paso 1a: eliminar los alias que quedarían duplicados tras normalizar el NIT,
-- conservando el más reciente de cada grupo.
with normalizados as (
  select
    id,
    regexp_replace(
      case
        when proveedor_nit ~ '-[0-9]$' then left(proveedor_nit, length(proveedor_nit) - 2)
        else proveedor_nit
      end,
      '\D', '', 'g'
    ) as nit_normalizado,
    nombre_proveedor_texto,
    created_at
  from alias_productos
),
sobrantes as (
  select id
  from (
    select
      id,
      row_number() over (
        partition by nit_normalizado, nombre_proveedor_texto
        order by created_at desc, id desc
      ) as posicion
    from normalizados
  ) as ordenados
  where posicion > 1
)
delete from alias_productos where id in (select id from sobrantes);

-- Paso 1b: normalizar el NIT de los alias que quedan.
update alias_productos
set proveedor_nit = regexp_replace(
  case
    when proveedor_nit ~ '-[0-9]$' then left(proveedor_nit, length(proveedor_nit) - 2)
    else proveedor_nit
  end,
  '\D', '', 'g'
);

-- NOTA: `proveedores.nit` NO se toca a propósito. Es la clave primaria y
-- `ordenes_compra.proveedor_nit` la referencia sin `on update cascade`, así que
-- normalizarla en sitio rompería las órdenes ya emitidas. No hace falta: la
-- tabla de alias no tiene clave foránea contra proveedores, y el backend
-- normaliza el NIT al consultar los alias. Unificar el formato en `proveedores`
-- es un cambio aparte, con migración de las órdenes incluida.

-- Paso 2: referencia del proveedor.
alter table alias_productos
  add column if not exists referencia_proveedor text;

create index if not exists idx_alias_productos_referencia
  on alias_productos (proveedor_nit, referencia_proveedor)
  where referencia_proveedor is not null;
