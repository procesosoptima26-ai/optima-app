import type {
  RespuestaTerceros,
  RolTercero,
  Tercero,
} from "./administracion.types";

async function leerRespuesta<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;

  if (!response.ok) {
    const posibleError = data as { error?: string };
    throw new Error(posibleError.error || "No se pudo completar la operación.");
  }

  return data;
}

export async function obtenerTerceros(
  rol?: RolTercero
): Promise<Tercero[]> {
  const query = rol ? `?rol=${encodeURIComponent(rol)}` : "";
  const response = await fetch(`/api/administracion/terceros${query}`);
  const data = await leerRespuesta<RespuestaTerceros>(response);

  if (!data.ok || !data.terceros) {
    throw new Error(data.error || "No se pudieron cargar los terceros.");
  }

  return data.terceros;
}
