const es = {
  "app.name": "openDobin",
  "nav.collections": "Colecciones",
  "nav.webhooks": "Webhooks",
  "nav.history": "Historial",
  "nav.settings": "Ajustes",
  "nav.plans": "Planes",
  "workspace.personal": "Personal",
  "request.send": "Enviar",
  "request.cancel": "Cancelar",
  "request.save": "Guardar",
  "request.params": "Params",
  "request.headers": "Headers",
  "request.body": "Body",
  "request.auth": "Auth",
  "response.empty": "La respuesta aparecerá aquí",
  "plans.current": "Tu plan: Local (ilimitado)",
  "plans.soon": "Próximamente",
} as const;

export type Msg = keyof typeof es;

export function t(key: Msg): string {
  return es[key];
}
