import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { emptyAuth, METHODS } from "@/core/types";
import type { AuthSpec, Environment, EnvCompareResult } from "@/core/types";
import { CODE_TARGETS, generateCode, type CodeTarget } from "@/core/codegen";
import { interpolate, resolveVars } from "@/core/interpolate";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/input";
import { methodTone } from "@/lib/utils";
import { KeyValueEditor } from "./KeyValueEditor";
import { ResponsePanel } from "./ResponsePanel";
import { TestsEditor } from "./TestsEditor";
import { PreRequestEditor } from "./PreRequestEditor";
import { DiffView } from "./DiffView";
import { Modal } from "@/ui/modal";

const tabs = ["params", "headers", "body", "auth", "pre", "tests"] as const;
type Tab = (typeof tabs)[number];

const tabLabel: Record<Tab, string> = {
  params: "Params",
  headers: "Headers",
  body: "Body",
  auth: "Auth",
  pre: "Pre-request",
  tests: "Tests",
};

export function RequestWorkbench() {
  const draft = useAppStore((s) => s.draft);
  const patchDraft = useAppStore((s) => s.patchDraft);
  const send = useAppStore((s) => s.send);
  const cancel = useAppStore((s) => s.cancel);
  const saveDraft = useAppStore((s) => s.saveDraft);
  const sending = useAppStore((s) => s.sending);
  const sendKind = useAppStore((s) => s.sendKind);
  const dirty = useAppStore((s) => s.dirty);
  const response = useAppStore((s) => s.response);
  const timeoutMs = useAppStore((s) => s.timeoutMs);
  const followRedirects = useAppStore((s) => s.followRedirects);
  const acceptInvalidCerts = useAppStore((s) => s.acceptInvalidCerts);
  const obtainToken = useAppStore((s) => s.obtainToken);
  const assertionResults = useAppStore((s) => s.assertionResults);
  const lastSnapshot = useAppStore((s) => s.lastSnapshot);
  const environments = useAppStore((s) => s.environments);
  const compare = useAppStore((s) => s.compare);
  const compareEnvironments = useAppStore((s) => s.compareEnvironments);
  const clearCompare = useAppStore((s) => s.clearCompare);
  const [tab, setTab] = useState<Tab>("params");
  const [showOptions, setShowOptions] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeTarget, setCodeTarget] = useState<CodeTarget>("fetch");
  const [compareOpen, setCompareOpen] = useState(false);
  const [envA, setEnvA] = useState("");
  const [envB, setEnvB] = useState("");

  useEffect(() => {
    if (compare) setCompareOpen(false);
  }, [compare]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void send();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveDraft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, saveDraft]);

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Crea un request para empezar.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <select
          value={draft.method}
          onChange={(e) =>
            patchDraft({ method: e.target.value as typeof draft.method })
          }
          className={`h-8 rounded-md border border-line bg-background px-2 font-mono text-xs ${methodTone(draft.method)}`}
        >
          {METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
        <Input
          value={draft.url}
          onChange={(e) => patchDraft({ url: e.target.value })}
          placeholder="https://api.ejemplo.com/v1/recurso"
          className="font-mono"
        />
        {sending && sendKind === "single" ? (
          <Button variant="outline" onClick={() => void cancel()}>
            Cancelar
          </Button>
        ) : (
          <Button disabled={sending} onClick={() => void send()}>
            Enviar
          </Button>
        )}
        <Button variant={dirty ? "default" : "outline"} onClick={() => void saveDraft()}>
          Guardar
        </Button>
        <Button variant="ghost" onClick={() => setCodeOpen(true)}>
          Código
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const active =
              environments.find((item) => item.isActive)?.id ?? environments[0]?.id ?? "";
            const other =
              environments.find((item) => item.id !== active)?.id ?? active;
            setEnvA(active);
            setEnvB(other);
            setCompareOpen(true);
          }}
        >
          Comparar
        </Button>
        <Button variant="ghost" onClick={() => setShowOptions((v) => !v)}>
          Opciones
        </Button>
      </div>

      {showOptions ? (
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-3 py-2 text-xs text-muted">
          <label className="flex items-center gap-2">
            Timeout
            <Input
              type="number"
              className="h-7 w-24"
              value={timeoutMs}
              onChange={(e) =>
                useAppStore.setState({ timeoutMs: Number(e.target.value) || 30000 })
              }
            />
            ms
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={followRedirects}
              className="accent-accent"
              onChange={(e) =>
                useAppStore.setState({ followRedirects: e.target.checked })
              }
            />
            Seguir redirects
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={acceptInvalidCerts}
              className="accent-accent"
              onChange={(e) =>
                useAppStore.setState({ acceptInvalidCerts: e.target.checked })
              }
            />
            Aceptar certificado inválido
          </label>
          <span>Ctrl+Enter envía · Ctrl+S guarda · Ctrl+K busca</span>
        </div>
      ) : null}

      <VarHint />

      <div className="flex items-center gap-1 px-3 pt-2">
        {tabs.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              tab === id ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {tabLabel[id]}
          </button>
        ))}
        <Input
          value={draft.name}
          onChange={(e) => patchDraft({ name: e.target.value })}
          className="ml-auto h-7 max-w-[220px]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {tab === "params" ? (
              <KeyValueEditor
                rows={draft.query}
                onChange={(query) => patchDraft({ query })}
              />
            ) : null}
            {tab === "headers" ? (
              <KeyValueEditor
                rows={draft.headers}
                onChange={(headers) => patchDraft({ headers })}
              />
            ) : null}
            {tab === "body" ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-1">
                  {(["none", "json", "text", "form"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() =>
                        patchDraft({ body: { ...draft.body, type } })
                      }
                      className={`rounded-md px-2 py-1 text-xs capitalize ${
                        draft.body.type === type
                          ? "bg-panel-2"
                          : "text-muted"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {draft.body.type === "json" || draft.body.type === "text" ? (
                  <Textarea
                    rows={10}
                    value={draft.body.content}
                    onChange={(e) =>
                      patchDraft({
                        body: { ...draft.body, content: e.target.value },
                      })
                    }
                  />
                ) : null}
                {draft.body.type === "form" ? (
                  <KeyValueEditor
                    rows={draft.body.form}
                    onChange={(form) =>
                      patchDraft({ body: { ...draft.body, form } })
                    }
                  />
                ) : null}
              </div>
            ) : null}
            {tab === "pre" ? (
              <PreRequestEditor
                steps={draft.preRequest ?? []}
                onChange={(preRequest) => patchDraft({ preRequest })}
              />
            ) : null}
            {tab === "tests" ? (
              <TestsEditor
                tests={draft.tests ?? []}
                onChange={(tests) => patchDraft({ tests })}
              />
            ) : null}
            {tab === "auth" ? (
              <AuthEditor
                auth={{ ...emptyAuth(), ...draft.auth }}
                onChange={(auth) => patchDraft({ auth })}
                oauthBusy={oauthBusy}
                onObtainToken={async () => {
                  setOauthBusy(true);
                  try {
                    await obtainToken();
                    toast.success("Token guardado en este request");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : String(error),
                    );
                  } finally {
                    setOauthBusy(false);
                  }
                }}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      {compare ? (
        <CompareSplit
          compare={compare}
          environments={environments}
          sending={sending}
          onClose={clearCompare}
        />
      ) : (
        <ResponsePanel
          result={response}
          sending={sending}
          assertionResults={assertionResults}
          previousSnapshot={lastSnapshot}
        />
      )}
      <CodeModal
        open={codeOpen}
        target={codeTarget}
        onTarget={setCodeTarget}
        onClose={() => setCodeOpen(false)}
      />
      <Modal
        open={compareOpen}
        title="Comparar entornos"
        onClose={() => {
          if (sendKind === "compare") return;
          setCompareOpen(false);
        }}
        footer={
          sendKind === "compare" ? (
            <>
              <span className="mr-auto self-center text-xs text-muted">
                Comparando…
              </span>
              <Button variant="outline" onClick={() => void cancel()}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCompareOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={!envA || !envB || envA === envB || sending}
                onClick={() => {
                  void compareEnvironments(envA, envB).catch((err: Error) =>
                    toast.error(err.message),
                  );
                }}
              >
                Enviar a ambos
              </Button>
            </>
          )
        }
      >
        <p className="mb-3 text-xs text-muted">
          Mismo request, dos interpolaciones. El entorno activo de la barra no cambia.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs">
            Entorno A
            <select
              value={envA}
              onChange={(e) => setEnvA(e.target.value)}
              className="h-8 w-full rounded-md border border-line bg-background px-2 text-sm"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Entorno B
            <select
              value={envB}
              onChange={(e) => setEnvB(e.target.value)}
              className="h-8 w-full rounded-md border border-line bg-background px-2 text-sm"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </div>
  );
}

const authTypes: { id: AuthSpec["type"]; label: string }[] = [
  { id: "none", label: "Ninguna" },
  { id: "bearer", label: "Bearer" },
  { id: "basic", label: "Basic" },
  { id: "apikey", label: "API key" },
  { id: "oauth2", label: "OAuth2" },
];

function AuthEditor({
  auth,
  onChange,
  oauthBusy,
  onObtainToken,
}: {
  auth: AuthSpec;
  onChange: (auth: AuthSpec) => void;
  oauthBusy: boolean;
  onObtainToken: () => Promise<void>;
}) {
  return (
    <div className="max-w-lg space-y-3">
      <div className="flex flex-wrap gap-1">
        {authTypes.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange({ ...auth, type: item.id })}
            className={`rounded-md px-2 py-1 text-xs ${
              auth.type === item.id ? "bg-panel-2" : "text-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {auth.type === "bearer" ? (
        <Input
          placeholder="Token"
          value={auth.token}
          onChange={(e) => onChange({ ...auth, token: e.target.value })}
        />
      ) : null}
      {auth.type === "basic" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Usuario"
            value={auth.username}
            onChange={(e) => onChange({ ...auth, username: e.target.value })}
          />
          <Input
            type="password"
            placeholder="Contraseña"
            value={auth.password}
            onChange={(e) => onChange({ ...auth, password: e.target.value })}
          />
        </div>
      ) : null}
      {auth.type === "apikey" ? (
        <div className="space-y-2">
          <Input
            placeholder="Nombre del header o query"
            value={auth.keyName}
            onChange={(e) => onChange({ ...auth, keyName: e.target.value })}
          />
          <Input
            type="password"
            placeholder="Valor"
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
          />
          <div className="flex gap-1">
            {(["header", "query"] as const).map((place) => (
              <button
                key={place}
                onClick={() => onChange({ ...auth, apiKeyIn: place })}
                className={`rounded-md px-2 py-1 text-xs ${
                  (auth.apiKeyIn === "query" ? "query" : "header") === place
                    ? "bg-panel-2"
                    : "text-muted"
                }`}
              >
                {place === "header" ? "Header" : "Query"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {auth.type === "oauth2" ? (
        <div className="space-y-2">
          <div className="flex gap-1">
            {(
              [
                ["client_credentials", "Client credentials"],
                ["authorization_code", "Authorization code + PKCE"],
              ] as const
            ).map(([grant, label]) => (
              <button
                key={grant}
                onClick={() => onChange({ ...auth, grant })}
                className={`rounded-md px-2 py-1 text-xs ${
                  (auth.grant === "authorization_code"
                    ? "authorization_code"
                    : "client_credentials") === grant
                    ? "bg-panel-2"
                    : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Token URL"
            value={auth.tokenUrl}
            onChange={(e) => onChange({ ...auth, tokenUrl: e.target.value })}
          />
          {auth.grant === "authorization_code" ? (
            <Input
              placeholder="Authorize URL"
              value={auth.authorizeUrl}
              onChange={(e) =>
                onChange({ ...auth, authorizeUrl: e.target.value })
              }
            />
          ) : null}
          <Input
            placeholder="Client ID"
            value={auth.clientId}
            onChange={(e) => onChange({ ...auth, clientId: e.target.value })}
          />
          <Input
            type="password"
            placeholder="Client secret"
            value={auth.clientSecret}
            onChange={(e) =>
              onChange({ ...auth, clientSecret: e.target.value })
            }
          />
          <Input
            placeholder="Scopes (separados por espacio)"
            value={auth.scopes}
            onChange={(e) => onChange({ ...auth, scopes: e.target.value })}
          />
          {auth.accessToken ? (
            <p className="text-xs text-muted">
              Token listo
              {auth.expiresAt
                ? ` · caduca ${formatExpiry(auth.expiresAt)}`
                : ""}
            </p>
          ) : (
            <p className="text-xs text-muted">
              Obtén un token antes de enviar. El Bearer se aplica al request.
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={oauthBusy}
            onClick={() => void onObtainToken()}
          >
            {oauthBusy ? "Esperando login…" : "Obtener token"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function formatExpiry(expiresAt: string) {
  const asNumber = Number(expiresAt);
  if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) {
    return new Date(asNumber * 1000).toLocaleString();
  }
  const asDate = Date.parse(expiresAt);
  if (Number.isFinite(asDate)) return new Date(asDate).toLocaleString();
  return expiresAt;
}

function VarHint() {
  const draft = useAppStore((s) => s.draft);
  const environments = useAppStore((s) => s.environments);
  const collections = useAppStore((s) => s.collections);
  const env = environments.find((item) => item.isActive) ?? environments[0];
  const collection = collections.find((item) => item.id === draft?.collectionId);
  const colVars = (collection?.variables ?? []).filter((row) => row.enabled && row.key.trim()).length;
  return (
    <div className="border-b border-line px-3 py-1 text-[11px] text-muted">
      Entorno {env?.name ?? "ninguno"}
      {colVars ? ` · ${colVars} vars de colección` : ""}
      {" · {{$guid}} {{$timestamp}} {{$nonce}}"}
    </div>
  );
}

function CompareSplit({
  compare,
  environments,
  sending,
  onClose,
}: {
  compare: EnvCompareResult;
  environments: Environment[];
  sending: boolean;
  onClose: () => void;
}) {
  const nameA =
    environments.find((item) => item.id === compare.envAId)?.name ?? "A";
  const nameB =
    environments.find((item) => item.id === compare.envBId)?.name ?? "B";
  return (
    <section className="flex min-h-[260px] flex-1 flex-col border-t border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm">
          Comparación {nameA} vs {nameB}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line overflow-hidden">
        <div className="min-h-0 overflow-auto">
          <ResponsePanel
            result={compare.resultA}
            sending={sending}
            assertionResults={compare.assertionsA}
            label={nameA}
          />
        </div>
        <div className="min-h-0 overflow-auto">
          <ResponsePanel
            result={compare.resultB}
            sending={sending}
            assertionResults={compare.assertionsB}
            previousSnapshot={{
              requestId: "",
              status: compare.resultA.status ?? 0,
              headers: compare.resultA.headers,
              body: compare.resultA.body,
              encoding: compare.resultA.bodyEncoding,
              contentType: compare.resultA.contentType,
              at: "",
            }}
            label={nameB}
          />
        </div>
      </div>
      <div className="max-h-48 overflow-auto border-t border-line p-3" data-selectable>
        <p className="mb-2 text-[11px] uppercase text-muted">Diff de body</p>
        <DiffView
          left={compare.resultA.body}
          right={compare.resultB.body}
          leftEncoding={compare.resultA.bodyEncoding}
          rightEncoding={compare.resultB.bodyEncoding}
          leftType={compare.resultA.contentType}
          rightType={compare.resultB.contentType}
          emptyLabel="Sin body en A"
        />
      </div>
    </section>
  );
}

function CodeModal({
  open,
  target,
  onTarget,
  onClose,
}: {
  open: boolean;
  target: CodeTarget;
  onTarget: (target: CodeTarget) => void;
  onClose: () => void;
}) {
  const draft = useAppStore((s) => s.draft);
  const workspace = useAppStore((s) => s.workspace);
  const collections = useAppStore((s) => s.collections);
  const environments = useAppStore((s) => s.environments);
  const secrets = useAppStore((s) => s.secrets);
  if (!draft) return null;
  const env = environments.find((item) => item.isActive) ?? environments[0];
  const collection = collections.find((item) => item.id === draft.collectionId);
  const vars = resolveVars({
    global: workspace?.variables,
    collection: collection?.variables,
    environment: env?.variables,
    secrets,
  });
  const interpolated = {
    ...draft,
    url: interpolate(draft.url, vars),
    headers: draft.headers.map((row) => ({
      ...row,
      key: interpolate(row.key, vars),
      value: interpolate(row.value, vars),
    })),
    query: draft.query.map((row) => ({
      ...row,
      key: interpolate(row.key, vars),
      value: interpolate(row.value, vars),
    })),
    body: {
      ...draft.body,
      content: interpolate(draft.body.content, vars),
      form: draft.body.form.map((row) => ({
        ...row,
        key: interpolate(row.key, vars),
        value: interpolate(row.value, vars),
      })),
    },
    auth: {
      ...draft.auth,
      token: interpolate(draft.auth.token, vars),
      username: interpolate(draft.auth.username, vars),
      password: interpolate(draft.auth.password, vars),
      keyName: interpolate(draft.auth.keyName, vars),
      accessToken: interpolate(draft.auth.accessToken, vars),
    },
  };
  const code = generateCode(interpolated, target);
  return (
    <Modal
      open={open}
      title="Generar código"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(code);
              toast.success("Código copiado");
            }}
          >
            Copiar
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {CODE_TARGETS.map((item) => (
          <button
            key={item.id}
            onClick={() => onTarget(item.id)}
            className={`rounded-md px-2 py-1 text-xs ${
              target === item.id ? "bg-panel-2" : "text-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Textarea rows={12} readOnly value={code} />
    </Modal>
  );
}


