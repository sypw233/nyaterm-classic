import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotesPanel from "./NotesPanel";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  refresh: vi.fn(),
  setSelectedNodeId: vi.fn(),
  setExpandedFolderIds: vi.fn(),
  runAction: vi.fn(),
  importPaths: vi.fn(),
  noteFolderIdForConnection: vi.fn(),
  setNoteFolderForConnection: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.log } }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/windowManager", () => ({
  openNoteEditor: vi.fn(),
  openExternalNoteEditor: vi.fn(),
}));
vi.mock("@/context/AppContext", () => ({
  useApp: () => ({ tabs: [], activeTabId: null }),
}));
vi.mock("@/hooks/useNotesAutoSwitch", () => ({
  useNotesAutoSwitch: vi.fn(),
}));
vi.mock("@/hooks/useNotesExternalDrop", () => ({
  useNotesExternalDrop: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count: number }) => (options ? `${key}: ${options.count}` : key),
  }),
}));
vi.mock("@/hooks/useNotesTree", () => ({
  useNotesTree: () => ({
    folders: [],
    notes: [],
    loading: false,
    error: null,
    selectedNodeId: null,
    expandedFolderIds: new Set(),
    refresh: mocks.refresh,
    setSelectedNodeId: mocks.setSelectedNodeId,
    setExpandedFolderIds: mocks.setExpandedFolderIds,
    runAction: mocks.runAction,
    importPaths: mocks.importPaths,
    noteFolderIdForConnection: mocks.noteFolderIdForConnection,
    setNoteFolderForConnection: mocks.setNoteFolderForConnection,
  }),
}));

async function chooseExport() {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <NotesPanel />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "common.more" }));
  await user.click(await screen.findByRole("menuitem", { name: "notes.export" }));
}

async function chooseMenuItem(name: string) {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <NotesPanel />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "common.more" }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("Notes panel import menu", () => {
  beforeEach(() => vi.resetAllMocks());

  it("imports selected markdown files into the tree", async () => {
    mocks.open.mockResolvedValue(["/a.md", "/b.md"]);
    mocks.importPaths.mockResolvedValue({
      folderCount: 0,
      noteCount: 2,
      rootIds: ["n1", "n2"],
    });
    await chooseMenuItem("notes.import");
    await waitFor(() =>
      expect(mocks.importPaths).toHaveBeenCalledWith(["/a.md", "/b.md"], null),
    );
    expect(mocks.open).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    expect(mocks.success).toHaveBeenCalledWith("notes.importSuccess: 2");
    expect(mocks.setSelectedNodeId).toHaveBeenCalledWith("n1");
  });

  it("imports a selected folder", async () => {
    mocks.open.mockResolvedValue("/Docs");
    mocks.importPaths.mockResolvedValue({
      folderCount: 1,
      noteCount: 3,
      rootIds: ["f1"],
    });
    await chooseMenuItem("notes.importFolder");
    await waitFor(() =>
      expect(mocks.importPaths).toHaveBeenCalledWith(["/Docs"], null),
    );
    expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: true });
  });

  it("does nothing when import selection is cancelled", async () => {
    mocks.open.mockResolvedValue(null);
    await chooseMenuItem("notes.import");
    expect(mocks.importPaths).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});

describe("Notes panel export menu", () => {
  beforeEach(() => vi.resetAllMocks());

  it("exports all notes through one command and reports the count without changing tree state", async () => {
    mocks.open.mockResolvedValue("/Documents");
    mocks.invoke.mockResolvedValue({
      outputPath: "/Documents/NyaTerm Notes",
      folderCount: 1,
      noteCount: 3,
    });
    await chooseExport();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("notes.exportSuccess: 3"));
    expect(mocks.open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("export_notes", {
      destination: "/Documents",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.setSelectedNodeId).not.toHaveBeenCalled();
    expect(mocks.setExpandedFolderIds).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("does nothing when directory selection is cancelled", async () => {
    mocks.open.mockResolvedValue(null);
    await chooseExport();
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["dialog", "command"])("reports and logs %s failures", async (source) => {
    const error = new Error("Access denied");
    mocks.open.mockResolvedValue("/Documents");
    if (source === "dialog") mocks.open.mockRejectedValue(error);
    else mocks.invoke.mockRejectedValue(error);
    await chooseExport();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Access denied"));
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "notes.export_failed", error }),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });
});
