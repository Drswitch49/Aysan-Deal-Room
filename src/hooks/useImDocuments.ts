/**
 * A deal's IM & supporting attachments.
 *
 * The deal-detail surfaces used to render `rawFields.IM_Review_Documents`,
 * which the deal mapper synthesises from the single `deal_files_secure_url`
 * column — a slot with no room for a file name, so every attachment showed as
 * the literal "Deal file" and each upload silently replaced the last. This
 * reads the `im_review_documents` table instead, which holds one row per file
 * with its own `document_name`.
 *
 * Attachments come in two kinds and the UI has to tell them apart: files we
 * hold in Cloudinary (downloadable outright) and links to somebody else's drive
 * (all we can do is open them). `isExternalDoc` is that test.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listImDocuments,
  uploadImDocument,
  removeImDocument,
  replaceImDocument,
  getImDocumentFileUrl,
  type ImDoc,
} from "../api/admin";

export type { ImDoc };

/** True when the row is a link to an external drive rather than a file we hold. */
export function isExternalDoc(doc: ImDoc): boolean {
  return !doc.publicId;
}

/** Read a File as bare base64 (no `data:…;base64,` prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Click a synthetic anchor — navigates to an attachment URL without a new tab. */
function saveAs(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function useImDocuments(dealId?: string, onChange?: () => void) {
  const [docs, setDocs] = useState<ImDoc[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(dealId));
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dealId) {
      setDocs([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setDocs(await listImDocuments(dealId));
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load attachments.");
    } finally {
      setIsLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upload = useCallback(
    async (file: File) => {
      if (!dealId) return;
      setError(null);
      setIsUploading(true);
      try {
        await uploadImDocument(dealId, file.name, file.type, await toBase64(file));
        await reload();
        onChange?.();
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to upload the file.");
      } finally {
        setIsUploading(false);
      }
    },
    [dealId, reload, onChange],
  );

  const replace = useCallback(
    async (doc: ImDoc, file: File) => {
      if (!dealId) return;
      setError(null);
      setBusyId(doc.id ?? null);
      try {
        await replaceImDocument(dealId, doc.id, file.name, file.type, await toBase64(file));
        await reload();
        onChange?.();
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to replace the file.");
      } finally {
        setBusyId(null);
      }
    },
    [dealId, reload, onChange],
  );

  const remove = useCallback(
    async (doc: ImDoc) => {
      if (!dealId) return;
      setError(null);
      setBusyId(doc.id ?? null);
      try {
        await removeImDocument(dealId, doc.id);
        await reload();
        onChange?.();
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to delete the file.");
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [dealId, reload, onChange],
  );

  /**
   * Save an attachment to disk — or, for an external link, open it.
   *
   * For a file we hold, fetching it as a blob first is what keeps its real
   * name: the signed Cloudinary URL is cross-origin, so an anchor's `download`
   * attribute is ignored on it and the browser would fall back to the (random)
   * public id. If the blob fetch is blocked, the signed URL is already marked
   * as an attachment server-side, so navigating to it still downloads rather
   * than opening a tab.
   *
   * An external link is somebody else's file on somebody else's host; we can't
   * stream it, and navigating the current tab to it would throw the user out of
   * the app if it renders a preview page instead. Those open in a new tab.
   */
  const download = useCallback(async (doc: ImDoc) => {
    if (!doc.id) {
      setError("This attachment has no id and can't be opened.");
      return;
    }
    setError(null);
    setDownloadingId(doc.id);
    // Opened synchronously, inside the click gesture, or the popup blocker eats
    // it once the await below resolves.
    const externalWindow = isExternalDoc(doc) ? window.open("", "_blank", "noopener,noreferrer") : null;
    try {
      const url = await getImDocumentFileUrl(doc.id, "download");
      if (isExternalDoc(doc)) {
        if (externalWindow) externalWindow.location.href = url;
        else saveAs(url, doc.filename);
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const objectUrl = URL.createObjectURL(await res.blob());
        saveAs(objectUrl, doc.filename);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      } catch {
        saveAs(url, doc.filename);
      }
    } catch (err: any) {
      console.error(err);
      externalWindow?.close();
      setError(err.message || "Could not open this attachment.");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return {
    docs,
    isLoading,
    isUploading,
    busyId,
    downloadingId,
    error,
    setError,
    reload,
    upload,
    replace,
    remove,
    download,
  };
}
