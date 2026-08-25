import { useState } from "react";
import { isTauri, useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { KeyValueEditor } from "@/features/request/KeyValueEditor";
import type { CookieRecord, Environment, Secret } from "@/core/types";
import { PERSONAL_WORKSPACE_ID } from "@/core/types";
import { parseCurl, toCurl } from "@/core/curl";
import { runCollectionExport, runCollectionImport } from "@/features/collections/file-actions";
import { toast } from "sonner";
import { Textarea } from "@/ui/input";
import { Modal } from "@/ui/badge";
import { Features, getEntitlements } from "@/core/entitlements";
export function SettingsView() {
  const environments = useAppStore((s) => s.environments);
  const saveEnvironment = useAppStore((s) => s.saveEnvironment);
  const deleteEnvironment = useAppStore((s) => s.deleteEnvironment);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const draft = useAppStore((s) => s.draft);
  const applyImported = useAppStore((s) => s.applyImported);
  const duplicateRequest = useAppStore((s) => s.duplicateRequest);
  const collections = useAppStore((s) => s.collections);
  const exportCollection = useAppStore((s) => s.exportCollection);
  const importCollectionJson = useAppStore((s) => s.importCollectionJson);
  const secrets = useAppStore((s) => s.secrets);
  const saveSecret = useAppStore((s) => s.saveSecret);
  const deleteSecret = useAppStore((s) => s.deleteSecret);
  const cookies = useAppStore((s) => s.cookies);
  const upsertCookie = useAppStore((s) => s.upsertCookie);
  const deleteCookie = useAppStore((s) => s.deleteCookie);
  const clearCookies = useAppStore((s) => s.clearCookies);
  const workspace = useAppStore((s) => s.workspace);
  const saveWorkspaceVariables = useAppStore((s) => s.saveWorkspaceVariables);
  const [curlText, setCurlText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [selectedId, setSelectedId] = useState(
    environments.find((e) => e.isActive)?.id ?? environments[0]?.id ?? "",
  );
  const selected = environments.find((e) => e.id === selectedId) ?? environments[0];

  function newEnv() {
    const env: Environment = {
      id: crypto.randomUUID(),
      workspaceId: PERSONAL_WORKSPACE_ID,
      name: "Nuevo entorno",
      variables: [
        {
          id: crypto.randomUUID(),
          key: "baseUrl",
          value: "http://localhost:3000",
          enabled: true,
        },
      ],
      isActive: environments.length === 0,
      updatedAt: new Date().toISOString(),
    };
    void saveEnvironment(env).then(() => setSelectedId(env.id));
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <section>
          <h1 className="text-lg font-semibold">Ajustes</h1>
          <p className="text-sm text-muted">
            Datos locales en este PC. Sin cuenta ni internet obligatorio.
          </p>
        </section>

        <PlanAndGitSettings />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Globales</h2>
          <p className="text-xs text-muted">
            El entorno pisa a la colección, y la colección a estas. No salen en el JSON de backup.
          </p>
          <div className="rounded-xl border border-line bg-panel p-4">
            <KeyValueEditor
              allowSecret
              rows={workspace?.variables ?? []}
              onChange={(variables) => void saveWorkspaceVariables(variables)}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Entornos</h2>
            <Button size="sm" variant="outline" onClick={newEnv}>
              Nuevo entorno
            </Button>
          </div>
          <div className="flex gap-2">
            {environments.map((env) => (
              <button
                key={env.id}
                onClick={() => setSelectedId(env.id)}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  selected?.id === env.id ? "bg-panel-2" : "text-muted"
                }`}
              >
                {env.name}
                {env.isActive ? " · activo" : ""}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
              <Input
                value={selected.name}
                onChange={(e) =>
                  void saveEnvironment({
                    ...selected,
                    name: e.target.value,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
              <KeyValueEditor
                allowSecret
                rows={selected.variables}
                onChange={(variables) =>
                  void saveEnvironment({
                    ...selected,
                    variables,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setActiveEnvironment(selected.id)}
                >
                  Usar este entorno
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void deleteEnvironment(selected.id)}
                >
                  Borrar
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <SecretsPanel
          secrets={secrets}
          onSave={(secret) => void saveSecret(secret)}
          onDelete={(name) => void deleteSecret(name)}
        />

        <CookiesPanel
          cookies={cookies}
          onUpsert={(cookie) => void upsertCookie(cookie)}
          onDelete={(id) => void deleteCookie(id)}
          onClear={() => {
            if (window.confirm("¿Vaciar todas las cookies de este PC?")) {
              void clearCookies();
            }
          }}
        />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Colecciones</h2>
          <p className="text-xs text-muted">
            JSON de openDobin, Postman v2.1 u OpenAPI 3 / Swagger 2 (JSON o YAML).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runCollectionImport(importCollectionJson)}
            >
              Importar JSON / OpenAPI
            </Button>
            {collections.map((collection) => (
              <Button
                key={collection.id}
                size="sm"
                variant="outline"
                onClick={() =>
                  runCollectionExport(exportCollection, collection.id)
                }
              >
                Exportar {collection.name}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">cURL</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              Importar cURL
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!draft) return;
                void navigator.clipboard.writeText(toCurl(draft));
                toast.success("cURL copiado");
              }}
            >
              Copiar request como cURL
            </Button>
            <Button size="sm" variant="outline" onClick={() => void duplicateRequest()}>
              Duplicar request
            </Button>
          </div>
        </section>
      </div>

      <Modal
        open={showImport}
        title="Importar cURL"
        onClose={() => setShowImport(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowImport(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const parsed = parseCurl(curlText);
                if (!parsed) {
                  toast.error("No se pudo leer el cURL");
                  return;
                }
                applyImported(parsed);
                setShowImport(false);
                toast.success("Request importado");
              }}
            >
              Aplicar
            </Button>
          </>
        }
      >
        <Textarea
          rows={8}
          value={curlText}
          onChange={(e) => setCurlText(e.target.value)}
          placeholder="curl -X POST 'https://...'"
        />
      </Modal>
    </div>
  );
}

function PlanAndGitSettings() {
  const plan = useAppStore((s) => s.plan);
  const setPlan = useAppStore((s) => s.setPlan);
  const gitFolder = useAppStore((s) => s.gitFolder);
  const linkGitFolder = useAppStore((s) => s.linkGitFolder);
  const unlinkGitFolder = useAppStore((s) => s.unlinkGitFolder);
  const syncGitNow = useAppStore((s) => s.syncGitNow);
  const canTunnel = getEntitlements(plan).can(Features.WebhooksPublicTunnel);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Plan en este PC</h2>
        <p className="text-xs text-muted">
          Local: inbox en 127.0.0.1. Pro (dev): desbloquea el túnel público. Sin
          pasarela de pago.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={plan === "local" ? "default" : "outline"}
            onClick={() => void setPlan("local")}
          >
            Local
          </Button>
          <Button
            size="sm"
            variant={plan === "pro" ? "default" : "outline"}
            onClick={() => void setPlan("pro")}
          >
            Pro (dev)
          </Button>
        </div>
        <p className="text-[11px] text-muted">
          Túnel público: {canTunnel ? "desbloqueado" : "bloqueado"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Carpeta Git</h2>
        <p className="text-xs text-muted">
          Colecciones como ficheros (estilo Bruno). Los secretos no se escriben.
          Commit y push los haces tú con git.
        </p>
        <p className="truncate font-mono text-[12px] text-muted">
          {gitFolder || "Sin carpeta vinculada"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!isTauri()}
            onClick={() =>
              void linkGitFolder()
                .then((result) => {
                  if (result.message) toast.success(result.message);
                })
                .catch((err: Error) => toast.error(err.message))
            }
          >
            Vincular carpeta
          </Button>
          {gitFolder ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void syncGitNow()
                    .then((result) => toast.success(result.message))
                    .catch((err: Error) => toast.error(err.message))
                }
              >
                Sincronizar ahora
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void unlinkGitFolder().then(() => toast.success("Carpeta desvinculada"))
                }
              >
                Desvincular
              </Button>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}

function SecretsPanel({
  secrets,
  onSave,
  onDelete,
}: {
  secrets: Secret[];
  onSave: (secret: Secret) => void;
  onDelete: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Secretos</h2>
      <p className="text-xs text-muted">
        Viven en este PC. El JSON de colección se exporta sin estos valores.
      </p>
      <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
        {secrets.length === 0 ? (
          <p className="text-xs text-muted">No hay secretos todavía.</p>
        ) : (
          secrets.map((secret) => (
            <div key={secret.id} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate font-mono text-xs">
                {secret.name}
              </span>
              <Input
                type="password"
                value={secret.value}
                onChange={(e) =>
                  onSave({
                    ...secret,
                    value: e.target.value,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(secret.name)}
              >
                Borrar
              </Button>
            </div>
          ))
        )}
        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Valor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!name.trim()) return;
              onSave({
                id: crypto.randomUUID(),
                workspaceId: PERSONAL_WORKSPACE_ID,
                name: name.trim(),
                value,
                updatedAt: new Date().toISOString(),
              });
              setName("");
              setValue("");
            }}
          >
            Añadir
          </Button>
        </div>
      </div>
    </section>
  );
}

function CookiesPanel({
  cookies,
  onUpsert,
  onDelete,
  onClear,
}: {
  cookies: CookieRecord[];
  onUpsert: (cookie: CookieRecord) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [path, setPath] = useState("/");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const grouped = new Map<string, CookieRecord[]>();
  for (const cookie of cookies) {
    const list = grouped.get(cookie.domain) ?? [];
    list.push(cookie);
    grouped.set(cookie.domain, list);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Cookies</h2>
        {cookies.length ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Vaciar jar
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Se guardan al recibir Set-Cookie y se envían al mismo dominio. No van en el JSON.
      </p>
      <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
        {cookies.length === 0 ? (
          <p className="text-xs text-muted">El jar está vacío.</p>
        ) : (
          [...grouped.entries()].map(([host, list]) => (
            <div key={host} className="space-y-1.5">
              <p className="font-mono text-xs text-muted">{host}</p>
              {list.map((cookie) => (
                <div key={cookie.id} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate font-mono text-xs">
                    {cookie.name}
                  </span>
                  <Input
                    value={cookie.value}
                    onChange={(e) =>
                      onUpsert({ ...cookie, value: e.target.value })
                    }
                  />
                  <span className="w-16 shrink-0 truncate font-mono text-[11px] text-muted">
                    {cookie.path}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(cookie.id)}
                  >
                    Borrar
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
        <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
          <Input
            placeholder="Dominio"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <Input
            placeholder="Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <Input
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Valor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!domain.trim() || !name.trim()) return;
            onUpsert({
              id: crypto.randomUUID(),
              workspaceId: PERSONAL_WORKSPACE_ID,
              domain: domain.trim(),
              path: path.trim() || "/",
              name: name.trim(),
              value,
              expiresAt: null,
              secure: false,
              httpOnly: false,
            });
            setDomain("");
            setName("");
            setValue("");
          }}
        >
          Añadir cookie
        </Button>
      </div>
    </section>
  );
}
