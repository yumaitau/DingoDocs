"use client";

import { useRef, useState, useTransition } from "react";
import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type AssetOption = { id: string; name: string };
type UploadResult = {
  ok: boolean;
  filename: string;
  error?: string;
  duplicateId?: string;
};

export function EvidenceUploadZone({
  engagementId,
  assets,
}: {
  engagementId: string;
  assets: AssetOption[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [pending, startTransition] = useTransition();

  function addFiles(items: FileList | null) {
    if (!items) return;
    setFiles((current) => [...current, ...Array.from(items)].slice(0, 25));
  }

  function submit(formData: FormData) {
    for (const file of files) formData.append("files", file);
    startTransition(async () => {
      const response = await fetch(
        `/api/v1/engagements/${engagementId}/evidence`,
        {
          method: "POST",
          body: formData,
        },
      );
      const body = (await response.json()) as {
        results?: UploadResult[];
        error?: string;
      };
      setResults(
        body.results ?? [
          {
            ok: false,
            filename: "Upload",
            error: body.error ?? "Upload failed",
          },
        ],
      );
      if (body.results?.some((result) => result.ok)) {
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <form action={submit} className="space-y-4 rounded-xl border bg-paper p-5">
      <div>
        <h2 className="font-semibold">Upload evidence</h2>
        <p className="mt-1 text-sm text-slate-500">
          Add up to 25 files. The server verifies file signatures, hashes
          content, detects duplicates, and queues malware scanning.
        </p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`flex min-h-36 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition ${
          dragging
            ? "border-[var(--harbour-500)] bg-[var(--harbour-50)]"
            : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <UploadCloud className="size-7 text-slate-400" />
        <span className="mt-2 text-sm font-medium">
          Drop files here or choose files
        </span>
        <span className="mt-1 text-xs text-slate-500">
          100 MB per file by default
        </span>
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        onChange={(event) => addFiles(event.target.files)}
        accept="image/png,image/jpeg,image/webp,video/mp4,text/plain,text/csv,application/json,application/xml,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.tcpdump.pcap,application/yaml"
      />
      {files.length ? (
        <ul className="grid gap-1 text-sm" aria-label="Files ready to upload">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex justify-between gap-4"
            >
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {formatBytes(file.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium">
          Classification
          <select
            name="classification"
            className={field}
            defaultValue="restricted"
          >
            <option value="restricted">Restricted</option>
            <option value="internal">Internal</option>
            <option value="client_visible">Client visible</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Restriction reason
          <input name="restrictionReason" className={field} maxLength={500} />
        </label>
        <label className="text-sm font-medium">
          Retain until
          <input name="retentionUntil" className={field} type="date" />
        </label>
      </div>
      {assets.length ? (
        <fieldset>
          <legend className="text-sm font-medium">Link to assets</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {assets.map((asset) => (
              <label key={asset.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="assetIds" value={asset.id} />
                {asset.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Button type="submit" disabled={!files.length || pending}>
        {pending
          ? "Uploading…"
          : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </Button>
      <div aria-live="polite" className="space-y-1 text-sm">
        {results.map((result, index) => (
          <p
            key={`${result.filename}-${index}`}
            className={result.ok ? "text-emerald-700" : "text-red-700"}
          >
            {result.ok
              ? `${result.filename} uploaded`
              : `${result.filename}: ${result.error}`}
            {result.duplicateId ? ` (existing ${result.duplicateId})` : ""}
          </p>
        ))}
      </div>
    </form>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
