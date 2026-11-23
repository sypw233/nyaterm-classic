import { listen } from "@/lib/backend/api";
import { getCurrentWebview } from "@/lib/backend/platform/webview";
import { runtime } from "@/lib/backend/runtime";
import { useEffect } from "react";
import {
  collectExternalDropAdditionalObjects,
  createExternalFileDropBridgeMessage,
  DRAG_EVENT_CAPTURE_OPTIONS,
  getExternalFileDropBridge,
  getDragEventPosition,
  isDropPositionTopmostWithinElement,
  isExternalFileDragEvent,
  type NativeFileDropEventPayload,
} from "@/lib/nativeFileDrop";

/**
 * Cross-platform OS file drop for the notes panel.
 *
 * Windows routes Explorer drops through the WebView2 additional-objects
 * bridge; other platforms use Tauri's native drag-drop event. Both paths
 * report absolute local paths, which the caller imports as notes.
 */
export function useNotesExternalDrop({
  containerRef,
  enabled,
  onDropPaths,
  onDropStateChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onDropPaths: (paths: string[]) => void;
  onDropStateChange: (active: boolean) => void;
}) {
  useEffect(() => {
    if (runtime !== "desktop" || !enabled) return;
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) return;

    const isOver = (position: { x: number; y: number }) =>
      isDropPositionTopmostWithinElement(position, containerRef.current);
    const reset = () => onDropStateChange(false);

    const handleDragEnter = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) return;
      const over = isOver(getDragEventPosition(event));
      if (!over) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      onDropStateChange(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) return;
      if (!isOver(getDragEventPosition(event))) {
        reset();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) return;
      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;
      if (leftWindow || !isOver(getDragEventPosition(event))) reset();
    };
    const handleDrop = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) return;
      if (!isOver(getDragEventPosition(event))) return;
      event.preventDefault();
      reset();
      if (event.dataTransfer) {
        void collectExternalDropAdditionalObjects(event.dataTransfer).then((objects) => {
          const payload = objects.length > 0 ? objects : Array.from(event.dataTransfer?.files ?? []);
          if (payload.length > 0) {
            bridge.postMessageWithAdditionalObjects(
              createExternalFileDropBridgeMessage(getDragEventPosition(event)),
              payload,
            );
          }
        });
      }
    };
    const handleWindowBlur = () => reset();

    window.addEventListener("dragenter", handleDragEnter, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragover", handleDragOver, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragleave", handleDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("drop", handleDrop, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragover", handleDragOver, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragleave", handleDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("drop", handleDrop, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("blur", handleWindowBlur);
      reset();
    };
  }, [containerRef, enabled, onDropStateChange]);

  useEffect(() => {
    if (runtime !== "desktop" || !enabled) return;
    const bridge = getExternalFileDropBridge();
    if (bridge?.postMessageWithAdditionalObjects) return;

    let cancelled = false;
    const reset = () => onDropStateChange(false);
    const handleBlur = () => reset();
    window.addEventListener("blur", handleBlur);

    const unlistenPromise = listen<NativeFileDropEventPayload>("external-file-drop", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.kind === "leave") {
        reset();
        return;
      }
      const over = isDropPositionTopmostWithinElement(payload.position, containerRef.current);
      if (payload.kind === "enter" || payload.kind === "over") {
        onDropStateChange(over);
        return;
      }
      if (payload.kind !== "drop") return;
      reset();
      if (over) onDropPaths(payload.paths);
    });
    const unlistenNativePromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.type === "leave") {
        reset();
        return;
      }
      const over = isDropPositionTopmostWithinElement(payload.position, containerRef.current);
      if (payload.type === "enter" || payload.type === "over") {
        onDropStateChange(over);
        return;
      }
      if (payload.type !== "drop") return;
      reset();
      if (over) onDropPaths(payload.paths);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("blur", handleBlur);
      reset();
      unlistenPromise.then((unlisten) => unlisten());
      unlistenNativePromise.then((unlisten) => unlisten());
    };
  }, [containerRef, enabled, onDropPaths, onDropStateChange]);
}
