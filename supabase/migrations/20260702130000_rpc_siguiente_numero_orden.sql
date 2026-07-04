-- ============================================================================
-- RPC siguiente_numero_orden — consecutivo atómico por año (sección 6.2)
--
-- Formato retornado: GCS-OC-COR-{año}-{consecutivo con padding a 3 dígitos}
-- El consecutivo se reinicia en 001 cada año nuevo.
--
-- Atomicidad: se usa INSERT ... ON CONFLICT DO UPDATE, que toma el mismo
-- bloqueo de fila que un SELECT ... FOR UPDATE pero además elimina la carrera
-- del patrón clásico "SELECT FOR UPDATE y si no existe, INSERT": con dos
-- transacciones simultáneas en un año sin registro, ambas verían la fila
-- ausente e intentarían insertarla. Con el upsert, la primera inserta (1) y
-- la segunda espera el bloqueo y luego incrementa (2) — nunca hay duplicados
-- ni errores de unique violation.
-- ============================================================================

create or replace function public.siguiente_numero_orden(p_anio int default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_anio int := coalesce(p_anio, extract(year from current_date)::int);
  v_numero int;
begin
  insert into contador_ordenes as c (anio, ultimo_numero)
  values (v_anio, 1)
  on conflict (anio) do update
    set ultimo_numero = c.ultimo_numero + 1
  returning c.ultimo_numero into v_numero;

  return 'GCS-OC-COR-' || v_anio || '-' || lpad(v_numero::text, 3, '0');
end;
$$;

-- Postgres otorga EXECUTE a PUBLIC por defecto — se restringe a autenticados
-- y al backend (service_role). El rol anónimo no puede generar consecutivos.
revoke execute on function public.siguiente_numero_orden(int) from public, anon;
grant execute on function public.siguiente_numero_orden(int) to authenticated, service_role;
