import { getCurrentWindow } from "@/lib/backend/platform/window";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdNote } from "react-icons/md";
import ChildWindowHeader from "@/components/layout/ChildWindowHeader";
import ExternalNoteViewer from "@/components/note-editor/ExternalNoteViewer";
import NoteEditor, { type NoteEditorHandle } from "@/components/note-editor/NoteEditor";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";

export default function NoteEditorPage() {
  const { t } = useTranslation();
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const [title, setTitle] = useState("");
  const params = new URLSearchParams(window.location.search);
  const noteId = params.get("noteId");
  const externalPath = params.get("externalPath");
  const [externalMarkdown, setExternalMarkdown] = useState<string | null>(null);
  const [externalError, setExternalError] = useState("");

  useEffect(() => {
    if (!externalPath) return;
    invoke<{ title: string; markdown: string }>("open_note_external", {
      path: externalPath,
    })
      .then((doc) => {
        setExternalMarkdown(doc.markdown);
        setTitle(doc.title);
      })
      .catch((err) => setExternalError(getErrorMessage(err)));
  }, [externalPath]);

  if (!noteId && !externalPath) return null;

  const closeWindow = () => {
    getCurrentWindow()
      .close()
      .catch(() => {});
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <ChildWindowHeader
        title={title.trim() || t("notes.title")}
        icon={<MdNote className="text-base" />}
        alwaysOnTopControl
        windowControls
        onClose={() => {
          if (editorRef.current) {
            editorRef.current.requestClose();
            return;
          }
          closeWindow();
        }}
      />
      {externalPath ? (
        externalError ? (
          <div className="p-4 text-sm text-red-400">{externalError}</div>
        ) : externalMarkdown === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : (
          <ExternalNoteViewer markdown={externalMarkdown} />
        )
      ) : (
        <NoteEditor
          ref={editorRef}
          noteId={noteId ?? ""}
          onTitleChange={setTitle}
        />
      )}
    </div>
  );
}
