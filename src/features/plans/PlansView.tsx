import { motion } from "motion/react";
import { Check, Lock } from "lucide-react";
import { Features, getEntitlements } from "@/core/entitlements";
import type { PlanId } from "@/core/entitlements";
import { Button } from "@/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";

const plans = [
  {
    id: "local" as PlanId,
    name: "Local",
    price: "Gratis en tu PC",
    description: "Cliente HTTP y webhooks en localhost. Sin cuenta.",
    features: [
      "Requests y colecciones ilimitados",
      "Entornos y variables",
      "Inbox de webhooks en 127.0.0.1",
      "Historial local",
    ],
  },
  {
    id: "pro" as PlanId,
    name: "Pro",
    price: "Dev en este PC",
    description: "Túnel público para que Stripe o GitHub peguen a tu máquina.",
    features: [
      "Túnel público para webhooks",
      "Mismo cliente HTTP local-first",
      "Sin billing: selector Pro (dev)",
      "Sin sincronización en la nube",
    ],
  },
  {
    id: "enterprise" as PlanId,
    name: "Empresa",
    price: "Próximamente",
    description: "Espacios de equipo, roles y SSO para compañías.",
    features: [
      "Workspaces compartidos",
      "Invitar miembros y roles",
      "SSO",
      "Auditoría",
    ],
  },
];

export function PlansView() {
  const plan = useAppStore((s) => s.plan);
  const setPlan = useAppStore((s) => s.setPlan);
  const entitlements = getEntitlements(plan);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-wide text-accent">Planes</p>
        <h1 className="mt-1 text-2xl font-semibold">
          Tu plan: {plan === "pro" ? "Pro (dev)" : "Local"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          openDobin sigue siendo local-first. El túnel público pregunta{" "}
          {`can(${Features.WebhooksPublicTunnel})`}, no el nombre del plan. Hoy
          {entitlements.can(Features.WebhooksPublicTunnel)
            ? " el túnel está desbloqueado en este PC"
            : " el inbox es solo localhost"}. Empresa y billing real vienen después.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((item, index) => {
            const current = item.id === plan;
            const locked = item.id === "enterprise";
            return (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.28 }}
                className={`rounded-2xl border p-5 ${
                  current ? "border-accent/50 bg-panel" : "border-line bg-panel-2"
                }`}
              >
                <h2 className="text-base font-semibold">{item.name}</h2>
                <p className="mt-1 text-sm text-accent">{item.price}</p>
                <p className="mt-2 text-sm text-muted">{item.description}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {item.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5 w-full"
                  variant={current ? "default" : "outline"}
                  disabled={locked || current}
                  onClick={() =>
                    void setPlan(item.id)
                      .then(() =>
                        toast.success(
                          item.id === "pro"
                            ? "Pro (dev) activo. El túnel está desbloqueado."
                            : "Plan Local. El inbox vuelve a localhost.",
                        ),
                      )
                      .catch((err: Error) => toast.error(err.message))
                  }
                >
                  {current ? (
                    "Plan actual"
                  ) : locked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Próximamente
                    </>
                  ) : item.id === "pro" ? (
                    "Activar Pro (dev)"
                  ) : (
                    "Usar Local"
                  )}
                </Button>
              </motion.article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
