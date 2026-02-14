import React, { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";

const FileUpload = ({
  onFileSelect,
  accept = { "application/pdf": [".pdf"] },
  maxSize,
}) => {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  const acceptForDropzone = useMemo(() => {
    if (!accept) return undefined;
    if (typeof accept === "string") {
      const extensions = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (!extensions.length) return undefined;

      // Map common resume formats; keep it permissive.
      return {
        "application/pdf": extensions.includes(".pdf") ? [".pdf"] : [],
        "text/plain": extensions.includes(".txt") ? [".txt"] : [],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          extensions.includes(".docx") ? [".docx"] : [],
        "application/msword": extensions.includes(".doc") ? [".doc"] : [],
      };
    }
    return accept;
  }, [accept]);

  const onDrop = useCallback(
    (acceptedFiles) => {
      const file = acceptedFiles?.[0];
      if (!file) return;
      setError(null);
      setSelected(file);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const onDropRejected = useCallback((rejections) => {
    const first = rejections?.[0];
    const message = first?.errors?.[0]?.message || "File rejected";
    setError(message);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: acceptForDropzone,
    multiple: false,
    maxSize,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors ${
        isDragActive
          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
          : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
      }`}
    >
      <input {...getInputProps()} />
      <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
        <Upload className="h-5 w-5" />
        <div>
          <div className="font-medium">
            {selected ? `Selected: ${selected.name}` : "Upload your resume"}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Drag & drop or click to select
          </div>
          {error ? (
            <div className="text-sm text-red-600 dark:text-red-400 mt-1">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default FileUpload;
