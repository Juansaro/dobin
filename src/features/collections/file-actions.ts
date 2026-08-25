import { toast } from "sonner";
import { pickCollectionFile } from "@/core/collection-io";

export async function runCollectionImport(
  importCollectionJson: (text: string) => Promise<string>,
) {
  const text = await pickCollectionFile();
  if (text == null) return;
  try {
    const name = await importCollectionJson(text);
    toast.success(`Colección “${name}” importada`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export function runCollectionExport(
  exportCollection: (id: string) => void,
  id: string,
) {
  exportCollection(id);
  toast.message("Colección exportada", {
    description: "Los secretos se quedan en este PC.",
  });
}
