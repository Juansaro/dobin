import {
  ChevronLeft,
  History,
  Inbox,
  LayoutGrid,
  Settings,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import type { View } from "@/core/types";
import { CollectionTree } from "@/features/collections/CollectionTree";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const nav: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: "request", label: "Colecciones", icon: LayoutGrid },
  { id: "webhooks", label: "Webhooks", icon: Inbox },
  { id: "history", label: "Historial", icon: History },
  { id: "settings", label: "Ajustes", icon: Settings },
  { id: "plans", label: "Planes", icon: Sparkles },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const workspace = useAppStore((s) => s.workspace);
  const environments = useAppStore((s) => s.environments);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const activeEnv = environments.find((e) => e.isActive)?.id ?? "";

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 268 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="flex h-full shrink-0 flex-col border-r border-line bg-panel"
    >
      <div className="flex items-center gap-2 px-3 py-3">
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">openDobin</div>
            <div className="truncate text-[11px] text-muted">
              {workspace?.name ?? "Personal"}
            </div>
          </div>
        ) : (
          <div className="flex-1 text-center text-accent">oD</div>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-foreground"
        >
          <ChevronLeft
            className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {!collapsed ? (
        <div className="px-3 pb-2">
          <select
            value={activeEnv}
            onChange={(e) => void setActiveEnvironment(e.target.value)}
            className="h-8 w-full rounded-md border border-line bg-background px-2 text-xs"
          >
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <nav className="space-y-0.5 px-2">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
                active ? "bg-panel-2 text-foreground" : "text-muted hover:bg-panel-2/70 hover:text-foreground",
                collapsed && "justify-center",
              )}
              title={item.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed ? item.label : null}
            </button>
          );
        })}
      </nav>

      {!collapsed && view === "request" ? (
        <CollectionTree />
      ) : (
        <div className="flex-1" />
      )}
    </motion.aside>
  );
}
