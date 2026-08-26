import {
  ChevronRight,
  Download,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { Collection, Folder, HttpRequestRecord } from "@/core/types";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { methodTone } from "@/lib/utils";
import { runCollectionExport, runCollectionImport } from "./file-actions";
import { KeyValueEditor } from "@/features/request/KeyValueEditor";
import { ConfirmDialog, Modal, PromptDialog } from "@/ui/modal";

type PromptState = {
  title: string;
  value: string;
  onSubmit: (value: string) => void;
};

type ConfirmState = {
  title: string;
  message: string;
  onConfirm: () => void;
};

export function CollectionTree() {
  const collections = useAppStore((s) => s.collections);
  const folders = useAppStore((s) => s.folders);
  const requests = useAppStore((s) => s.requests);
  const activeRequestId = useAppStore((s) => s.activeRequestId);
  const selectRequest = useAppStore((s) => s.selectRequest);
  const createCollection = useAppStore((s) => s.createCollection);
  const createRequest = useAppStore((s) => s.createRequest);
  const createFolder = useAppStore((s) => s.createFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const renameCollection = useAppStore((s) => s.renameCollection);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const deleteRequest = useAppStore((s) => s.deleteRequest);
  const exportCollection = useAppStore((s) => s.exportCollection);
  const importCollectionJson = useAppStore((s) => s.importCollectionJson);
  const saveCollectionVariables = useAppStore((s) => s.saveCollectionVariables);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [varsOf, setVarsOf] = useState<Collection | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function promptFolder(collectionId: string, parentId: string | null) {
    setPrompt({
      title: "Nombre de la carpeta",
      value: "Nueva carpeta",
      onSubmit: (name) => void createFolder(collectionId, parentId, name),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Colecciones
        </span>
        <div className="flex">
          <Button
            size="icon"
            variant="ghost"
            title="Importar colección"
            onClick={() => void runCollectionImport(importCollectionJson)}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Nueva colección"
            onClick={() =>
              setPrompt({
                title: "Nombre de la colección",
                value: "Nueva colección",
                onSubmit: (name) => void createCollection(name),
              })
            }
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        {collections.map((collection) => {
          const colFolders = folders.filter((f) => f.collectionId === collection.id);
          const colRequests = requests.filter((r) => r.collectionId === collection.id);
          const expanded = open[collection.id] ?? true;
          return (
            <div key={collection.id} className="mb-1">
              <div className="flex items-center gap-0.5 rounded-md px-1.5 hover:bg-panel-2">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-[13px]"
                  onClick={() =>
                    setOpen((prev) => ({ ...prev, [collection.id]: !expanded }))
                  }
                  onDoubleClick={() =>
                    setPrompt({
                      title: "Renombrar colección",
                      value: collection.name,
                      onSubmit: (name) => void renameCollection(collection.id, name),
                    })
                  }
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-muted transition-transform ${
                      expanded ? "rotate-90" : ""
                    }`}
                  />
                  <span className="truncate">{collection.name}</span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Exportar colección"
                  onClick={() => runCollectionExport(exportCollection, collection.id)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Variables de colección"
                  onClick={() => setVarsOf(collection)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Nueva carpeta"
                  onClick={() => promptFolder(collection.id, null)}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Nuevo request"
                  onClick={() => void createRequest(collection.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() =>
                    setConfirm({
                      title: "Borrar colección",
                      message: `¿Borrar “${collection.name}”?`,
                      onConfirm: () => void deleteCollection(collection.id),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded ? (
                <TreeBranch
                  collectionId={collection.id}
                  parentId={null}
                  folders={colFolders}
                  requests={colRequests}
                  depth={0}
                  open={open}
                  setOpen={setOpen}
                  activeRequestId={activeRequestId}
                  selectRequest={selectRequest}
                  createRequest={createRequest}
                  promptFolder={promptFolder}
                  onRenameFolder={(id, name) =>
                    setPrompt({
                      title: "Renombrar carpeta",
                      value: name,
                      onSubmit: (next) => void renameFolder(id, next),
                    })
                  }
                  onDeleteFolder={(id, name) =>
                    setConfirm({
                      title: "Borrar carpeta",
                      message: `¿Borrar “${name}”? Los requests pasan al padre.`,
                      onConfirm: () => void deleteFolder(id),
                    })
                  }
                  deleteRequest={deleteRequest}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <Modal
        open={Boolean(varsOf)}
        title={`Variables · ${varsOf?.name ?? ""}`}
        onClose={() => setVarsOf(null)}
        footer={
          <Button variant="ghost" onClick={() => setVarsOf(null)}>
            Cerrar
          </Button>
        }
      >
        {varsOf ? (
          <KeyValueEditor
            allowSecret
            rows={varsOf.variables ?? []}
            onChange={(variables) => {
              setVarsOf({ ...varsOf, variables });
              void saveCollectionVariables(varsOf.id, variables);
            }}
          />
        ) : null}
      </Modal>
      <PromptDialog
        key={prompt ? `${prompt.title}:${prompt.value}` : "prompt-closed"}
        open={Boolean(prompt)}
        title={prompt?.title ?? ""}
        defaultValue={prompt?.value ?? ""}
        onClose={() => setPrompt(null)}
        onSubmit={(value) => prompt?.onSubmit(value)}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm()}
      />
    </div>
  );
}

function TreeBranch({
  collectionId,
  parentId,
  folders,
  requests,
  depth,
  open,
  setOpen,
  activeRequestId,
  selectRequest,
  createRequest,
  promptFolder,
  onRenameFolder,
  onDeleteFolder,
  deleteRequest,
}: {
  collectionId: string;
  parentId: string | null;
  folders: Folder[];
  requests: HttpRequestRecord[];
  depth: number;
  open: Record<string, boolean>;
  setOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  activeRequestId: string | null;
  selectRequest: (id: string) => void;
  createRequest: (collectionId: string, folderId?: string | null) => Promise<void>;
  promptFolder: (collectionId: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string, name: string) => void;
  deleteRequest: (id: string) => Promise<void>;
}) {
  const childFolders = folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const childRequests = requests
    .filter((request) => request.folderId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <>
      {childFolders.map((folder) => {
        const expanded = open[folder.id] ?? true;
        return (
          <div key={folder.id}>
            <div
              className="group flex items-center gap-0.5 rounded-md px-1.5 hover:bg-panel-2"
              style={{ marginLeft: 12 + depth * 12 }}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-[13px]"
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [folder.id]: !expanded }))
                }
                onDoubleClick={() => onRenameFolder(folder.id, folder.name)}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 text-muted transition-transform ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{folder.name}</span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                title="Nueva subcarpeta"
                onClick={() => promptFolder(collectionId, folder.id)}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                title="Nuevo request"
                onClick={() => void createRequest(collectionId, folder.id)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                title="Borrar carpeta"
                onClick={() => onDeleteFolder(folder.id, folder.name)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {expanded ? (
              <TreeBranch
                collectionId={collectionId}
                parentId={folder.id}
                folders={folders}
                requests={requests}
                depth={depth + 1}
                open={open}
                setOpen={setOpen}
                activeRequestId={activeRequestId}
                selectRequest={selectRequest}
                createRequest={createRequest}
                promptFolder={promptFolder}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                deleteRequest={deleteRequest}
              />
            ) : null}
          </div>
        );
      })}
      {childRequests.map((request) => (
        <div
          key={request.id}
          className={`group flex items-center rounded-md ${
            activeRequestId === request.id ? "bg-panel-2" : "hover:bg-panel-2/70"
          }`}
          style={{ marginLeft: 16 + depth * 12 }}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
            onClick={() => selectRequest(request.id)}
          >
            <span
              className={`w-12 shrink-0 font-mono text-[10px] ${methodTone(request.method)}`}
            >
              {request.method}
            </span>
            <span className="truncate text-[13px]">{request.name}</span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={() => void deleteRequest(request.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </>
  );
}
