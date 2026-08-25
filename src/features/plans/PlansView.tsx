import { motion } from "motion/react";
import { Check, Lock } from "lucide-react";
import { getEntitlements, Features } from "@/core/entitlements";
import { Button } from "@/ui/button";

const plans = [
  {
    id: "local",
    name: "Local",
    price: "Gratis en tu PC",
    description: "Cliente HTTP y webhooks sin cuenta. Todo queda en este equipo.",
    features: [
      "Requests y colecciones ilimitados",
      "Entornos y variables",
      "Inbox de webhooks en localhost",
      "Historial local",
    ],
    current: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "Próximamente",
    description: "Para quien vive en APIs: túnel público, más historial y sincronización.",
    features: [
      "Túnel público para webhooks",
      "Historial con más retención",
      "Sincronización en la nube",
      "Importar / exportar avanzado",
    ],
    current: false,
  },
  {
    id: "enterprise",
    name: "Empresa",
    price: "Próximamente",
    description: "Espacios de equipo, roles y SSO para compañías.",
    features: [
      "Workspaces compartidos",
      "Invitar miembros y roles",
      "SSO",
      "Auditoría",
    ],
    current: false,
  },
];

export function PlansView() {
  const entitlements = getEntitlements();

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-wide text-accent">Planes</p>
        <h1 className="mt-1 text-2xl font-semibold">Tu plan: Local (ilimitado)</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          openDobin v1 es local-first. Pro y Empresa se enchufarán después sin
          cambiar cómo envías requests: la UI pregunta {`can(feature)`}, no el
          nombre del plan. Hoy {entitlements.can(Features.WorkspacesShared)
            ? "todo está desbloqueado en este PC"
            : "hay límites"}.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((plan, index) => (
            <motion.article
              key={plan.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, duration: 0.28 }}
              className={`rounded-2xl border p-5 ${
                plan.current
                  ? "border-accent/50 bg-panel"
                  : "border-line bg-panel-2"
              }`}
            >
              <h2 className="text-base font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-accent">{plan.price}</p>
              <p className="mt-2 text-sm text-muted">{plan.description}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5 w-full"
                variant={plan.current ? "default" : "outline"}
                disabled={!plan.current}
              >
                {plan.current ? (
                  "Plan actual"
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Próximamente
                  </>
                )}
              </Button>
            </motion.article>
          ))}
        </div>
      </div>
    </div>
  );
}
