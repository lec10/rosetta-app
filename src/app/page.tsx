"use client";

import { useState, useRef } from "react";
import { convertImscToRosetta } from "@/lib/imsc-to-rosetta";

type Status = "idle" | "processing" | "done" | "error";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [outputFilename, setOutputFilename] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setStatus("idle");
    setErrorMsg("");
    setResultBlob(null);
  }

  async function handleConvert() {
    if (!file) return;

    setStatus("processing");
    setErrorMsg("");
    setResultBlob(null);

    try {
      const text = await file.text();
      const result = convertImscToRosetta(text);
      const blob = new Blob([result], { type: "application/xml" });
      const name = file.name.replace(/\.[^.]+$/, "") + ".imscr";

      setResultBlob(blob);
      setOutputFilename(name);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStatus("error");
    }
  }

  function handleDownload() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 shadow-lg p-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-center text-zinc-900 dark:text-zinc-100">
          Conversor IMSC &rarr; Rosetta
        </h1>

        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
          Sube un archivo IMSC 1.1 (.xml) exportado desde EZTitles y
          descarga el archivo IMSC-Rosetta (.imscr).
        </p>

        {/* File input */}
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xml"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {file ? file.name : "Seleccionar archivo .xml"}
          </button>
        </div>

        {/* Convert button */}
        <button
          onClick={handleConvert}
          disabled={!file || status === "processing"}
          className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 py-3 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {status === "processing" ? "Convirtiendo..." : "Convertir"}
        </button>

        {/* Status messages */}
        {status === "done" && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 flex flex-col gap-3">
            <p className="text-sm text-green-700 dark:text-green-300 text-center">
              Conversion exitosa: <strong>{outputFilename}</strong>
            </p>
            <button
              onClick={handleDownload}
              className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors cursor-pointer"
            >
              Descargar .imscr
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4">
            <p className="text-sm text-red-700 dark:text-red-300 text-center">
              {errorMsg}
            </p>
          </div>
        )}
        <p className="text-xs text-center text-zinc-400 dark:text-zinc-600">
          v1.1.0
        </p>
      </div>
    </div>
  );
}
