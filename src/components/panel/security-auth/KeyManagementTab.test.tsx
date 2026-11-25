import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SshKey } from "@/types/global";
import { KeyManagementTab } from "./KeyManagementTab";

const { invokeMock, toastSuccessMock, writeClipboardTextMock, unlockFooterProps } = vi.hoisted(
  () => ({
    invokeMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    writeClipboardTextMock: vi.fn(),
    unlockFooterProps: [] as Array<{ unlockRequestNonce?: number; unlocked?: boolean }>,
  }),
);

vi.mock("@/lib/invoke", () => ({ invoke: invokeMock }));
vi.mock("@/lib/clipboard", () => ({ writeClipboardText: writeClipboardTextMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));
vi.mock("./SecretUnlockFooter", () => ({
  SecretUnlockFooter: (props: { unlockRequestNonce?: number; unlocked?: boolean }) => {
    unlockFooterProps.push(props);
    return null;
  },
}));
vi.mock("@/components/dialog/security-auth/KeyDeleteDialog", () => ({ KeyDeleteDialog: () => null }));
vi.mock("@/components/dialog/security-auth/KeyEditorDialog", () => ({ KeyEditorDialog: () => null }));
vi.mock("@/components/dialog/security-auth/PrivateKeyViewDialog", () => ({
  PrivateKeyViewDialog: () => null,
}));

const key: SshKey = {
  sort_order: 0,
  id: "key-1",
  name: "Production key",
  has_key_data: true,
};
const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest production";

describe("KeyManagementTab", () => {
  beforeEach(() => {
    unlockFooterProps.length = 0;
    invokeMock.mockReset();
    writeClipboardTextMock.mockReset();
    toastSuccessMock.mockReset();
    writeClipboardTextMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_ssh_keys":
          return Promise.resolve([key]);
        case "get_ssh_key_public_key":
          return Promise.resolve(publicKey);
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
  });

  it("copies a public key while secrets remain locked", async () => {
    render(<KeyManagementTab />);

    await screen.findByText(key.name);
    fireEvent.click(screen.getByRole("button", { name: "settings.copyPublicKey" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_ssh_key_public_key", { id: key.id });
      expect(writeClipboardTextMock).toHaveBeenCalledWith(publicKey);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("settings.copyPublicKeySuccess");

    fireEvent.click(screen.getByRole("button", { name: "settings.viewPrivateKey" }));
    expect(invokeMock).not.toHaveBeenCalledWith("get_ssh_key_private_key", { id: key.id });
  });

  it("asks for the master password before editing an existing key", async () => {
    render(<KeyManagementTab />);

    await screen.findByText(key.name);
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));

    // Locked editing must request unlock instead of opening the editor; the
    // footer's nonce is how the panel asks for the master password.
    await waitFor(() => {
      const last = unlockFooterProps[unlockFooterProps.length - 1];
      expect(last?.unlocked).toBe(false);
      expect(last?.unlockRequestNonce ?? 0).toBeGreaterThan(0);
    });
  });
});
