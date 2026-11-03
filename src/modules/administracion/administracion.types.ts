export type RolUsuario = "USUARIO" | "ADMIN" | string;

export type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: RolUsuario;
  sucursal: string;
  modulos: string[];
  permisos?: string[];
};

export type SeccionAdministracion =
  | "resumen"
  | "terceros"
  | "documentos"
  | "cuentasCorrientes"
  | "pagos"
  | "cheques"
  | "bancos"
  | "configuracion";

export type RolTercero = "CLIENTE" | "PROVEEDOR" | "EMPLEADO" | "OTRO";

export type Tercero = {
  id: string;
  tercero: string;
  codigoTercero: string;
  roles: string[];
  tipoPersona: string;
  nombre: string;
  apellido: string;
  razonSocial: string;
  nombreComercial: string;
  tipoDocumento: string;
  numeroDocumento: string;
  cuitCuil: string;
  condicionIva: string;
  telefono: string;
  email: string;
  direccion: string;
  localidad: string;
  provincia: string;
  observaciones: string;
  activo: boolean;
};

export type RespuestaTerceros = {
  ok?: boolean;
  rol?: string | null;
  terceros?: Tercero[];
  error?: string;
};

export type MensajeAdministracion = {
  tipo: "info" | "exito" | "error";
  texto: string;
} | null;
