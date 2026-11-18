import { describe, expect, it } from "vitest";
import {
  commandStartsSuggestionSuppressingProgram,
  isPagerSearchOrCommandInput,
  isPagerSingleKeyInput,
} from "./commandSuggestionSuppression";

describe("commandStartsSuggestionSuppressingProgram", () => {
  it("keeps suppressing known full-screen programs and pagers", () => {
    for (const command of [
      "vim file",
      "less file",
      "man ls",
      "htop",
      "sudo -u root htop",
      "tail -f /var/log/syslog",
      "journalctl -u nginx",
      "systemctl status nginx",
      "systemctl list-units",
    ]) {
      expect(commandStartsSuggestionSuppressingProgram(command), command).toBe(
        true,
      );
    }
  });

  it("does not suppress non-interactive commands", () => {
    for (const command of [
      "ls -la",
      "journalctl --no-pager",
      "systemctl --no-pager status nginx",
      "systemctl restart nginx",
      "loginctl enable-linger user",
      "git status",
      "git commit -m log",
      "echo git log",
    ]) {
      expect(commandStartsSuggestionSuppressingProgram(command), command).toBe(
        false,
      );
    }
  });

  it("detects git subcommands that hand output to the pager", () => {
    for (const command of [
      "git log",
      "git show HEAD",
      "git diff --stat",
      "git blame README.md",
      "git reflog",
      "git shortlog -sn",
      "git whatchanged",
      "git stash list",
      "sudo git log",
      "git --paginate log",
      "git -p log",
    ]) {
      expect(commandStartsSuggestionSuppressingProgram(command), command).toBe(
        true,
      );
    }
  });

  it("leaves pagination disabled and piped git output alone", () => {
    for (const command of [
      "git --no-pager log",
      "git -P diff",
      "GIT_PAGER=cat git log",
      "PAGER=cat git show HEAD",
      "git -c core.pager=cat log",
      "git log | head",
      "git log > out.txt",
      "git show HEAD | cat",
      "git log &> both.txt",
    ]) {
      expect(commandStartsSuggestionSuppressingProgram(command), command).toBe(
        false,
      );
    }
  });

  it("still pages when only stderr is redirected", () => {
    // `2>` keeps stdout on the terminal, so less still runs.
    expect(
      commandStartsSuggestionSuppressingProgram("git log 2> err.txt"),
    ).toBe(true);
    expect(commandStartsSuggestionSuppressingProgram("git log 2>&1")).toBe(
      true,
    );
  });

  it("only considers the pager-relevant part of compound commands", () => {
    expect(
      commandStartsSuggestionSuppressingProgram("echo done; git log"),
    ).toBe(true);
    expect(
      commandStartsSuggestionSuppressingProgram("git log; echo done"),
    ).toBe(true);
    expect(
      commandStartsSuggestionSuppressingProgram(
        "git status && git commit -m ok",
      ),
    ).toBe(false);
  });

  it("ignores unrelated shells and unknown commands", () => {
    for (const command of ["", "   ", "kubectl get pods", "git"]) {
      expect(commandStartsSuggestionSuppressingProgram(command), command).toBe(
        false,
      );
    }
  });
});

describe("pager input helpers", () => {
  it("detects pager search prefixes", () => {
    expect(isPagerSearchOrCommandInput("/error")).toBe(true);
    expect(isPagerSearchOrCommandInput("?error")).toBe(true);
    expect(isPagerSearchOrCommandInput(":set nu")).toBe(true);
    expect(isPagerSearchOrCommandInput("git log")).toBe(false);
  });

  it("detects pager single-key input", () => {
    expect(isPagerSingleKeyInput("q")).toBe(true);
    expect(isPagerSingleKeyInput(" ")).toBe(true);
    expect(isPagerSingleKeyInput("x")).toBe(false);
  });
});
