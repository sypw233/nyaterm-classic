import { describe, expect, it } from "vitest";
import {
  isBareShellPrompt,
  sanitizeTerminalCommand,
  stripTerminalCommandPrompt,
} from "./terminalCommand";

describe("terminal prompt boundaries", () => {
  it("strips a standalone POSIX dollar prompt but not command variables", () => {
    expect(stripTerminalCommandPrompt("$ s")).toBe("s");
    expect(stripTerminalCommandPrompt("$ s  s   s")).toBe("s  s   s");
    expect(stripTerminalCommandPrompt("$ ")).toBe("");
    expect(stripTerminalCommandPrompt("$HOME")).toBe("$HOME");
    expect(stripTerminalCommandPrompt("$s")).toBe("$s");
    expect(stripTerminalCommandPrompt("echo $DISPLAY")).toBe("echo $DISPLAY");
    expect(stripTerminalCommandPrompt('echo "$HOME"')).toBe('echo "$HOME"');
    expect(stripTerminalCommandPrompt("'$HOME'")).toBe("'$HOME'");
  });

  it("preserves existing POSIX, bracketed, PowerShell and Windows prefixes", () => {
    expect(
      stripTerminalCommandPrompt("alice@server:~/work$ echo $DISPLAY"),
    ).toBe("echo $DISPLAY");
    expect(stripTerminalCommandPrompt("[alice@server] # ls -la")).toBe(
      "ls -la",
    );
    expect(stripTerminalCommandPrompt("PS C:\\work> echo $DISPLAY")).toBe(
      "echo $DISPLAY",
    );
    expect(stripTerminalCommandPrompt("C:\\work> dir")).toBe("dir");
  });

  it("keeps command-internal whitespace when normalizing suggestions", () => {
    expect(sanitizeTerminalCommand("$ s  s   s  ")).toBe("s  s   s");
    expect(sanitizeTerminalCommand("$HOME  &&  echo $DISPLAY")).toBe(
      "$HOME  &&  echo $DISPLAY",
    );
  });
});

describe("bare shell prompt detection", () => {
  it("recognizes an idle prompt across supported shells", () => {
    for (const line of [
      "alice@server:~/work$",
      "alice@server:~/work$ ",
      "[alice@server] #",
      "$ ",
      "PS C:\\work>",
      "C:\\work>",
      "console:/ #",
      "switch#",
      "router(config)#",
      "console:/ # ",
    ]) {
      expect(isBareShellPrompt(line), line).toBe(true);
    }
  });

  it("strips device CLI prompts before recording a command", () => {
    expect(stripTerminalCommandPrompt("console:/ # ls")).toBe("ls");
    expect(stripTerminalCommandPrompt("switch# show version")).toBe(
      "show version",
    );
    expect(stripTerminalCommandPrompt("router(config)# show run")).toBe(
      "show run",
    );
    expect(stripTerminalCommandPrompt("console:/ #")).toBe("");
    expect(sanitizeTerminalCommand("console:/ # ls")).toBe("ls");
  });

  it("does not treat device prompts as command text when the marker is internal", () => {
    expect(stripTerminalCommandPrompt("echo $DISPLAY")).toBe("echo $DISPLAY");
    expect(stripTerminalCommandPrompt("echo foo # bar")).toBe("echo foo # bar");
  });

  it("does not treat command output as a prompt", () => {
    for (const line of [
      "alice@server:~/work$ git log",
      "commit 1a2b3c4 -- initial",
      "",
      "   ",
      "less README.md",
    ]) {
      expect(isBareShellPrompt(line), line).toBe(false);
    }
  });
});
