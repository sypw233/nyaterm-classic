import { describe, expect, it } from "vitest";
import {
  commandEntersForeignShell,
  commandLeavesShell,
  commandStartsSuggestionSuppressingProgram,
  ForeignShellTracker,
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

describe("commandEntersForeignShell", () => {
  it("counts shells opened on another host, container or distro", () => {
    for (const command of [
      "ssh host",
      "ssh -p 2222 -i ~/.ssh/key user@host",
      "/usr/bin/ssh -o StrictHostKeyChecking=no host",
      "sudo ssh host",
      "FOO=1 ssh host",
      "exec ssh host",
      "mosh host",
      "telnet 10.0.0.1 23",
      "docker exec -it web bash",
      "docker exec -ti web sh",
      "docker run --rm -it ubuntu",
      "podman exec --interactive --tty c bash",
      "docker container exec -it web bash",
      "kubectl exec -it pod -- sh",
      "oc rsh pod",
      "lxc exec box -- bash",
      "machinectl shell root@box",
      "vagrant ssh",
      "nsenter -t 1 -a",
      "chroot /mnt/root",
      "wsl",
      "wsl -d Ubuntu",
      "wsl ~",
      "adb shell",
      "adb -s emulator-5554 shell",
      "cd /tmp && ssh host",
    ]) {
      expect(commandEntersForeignShell(command), command).toBe(1);
    }

    expect(commandEntersForeignShell("ssh a; ssh b")).toBe(2);
  });

  it("does not count commands that return to the local prompt by themselves", () => {
    for (const command of [
      "",
      "ls -la",
      "su",
      "sudo -i",
      "bash",
      "tmux",
      "ssh host uptime",
      "ssh -N -L 8080:localhost:80 host",
      "ssh -f host",
      "ssh -W host:22 jump",
      "ssh host &",
      "cat key | ssh host 'cat > key'",
      "mosh host -- top",
      "telnet",
      "docker exec web ls",
      "docker run --rm ubuntu echo hi",
      "docker run -d nginx",
      "docker run -dit nginx",
      "docker ps",
      "kubectl get pods",
      "kubectl exec pod -- ls",
      "lxc list",
      "vagrant up",
      "chroot /mnt/root /bin/ls",
      "wsl -l -v",
      "wsl --shutdown",
      "wsl -d Ubuntu -e ls",
      "wsl ls",
      "adb devices",
      "adb shell ls /sdcard",
      "echo ssh host",
      "grep ssh file",
    ]) {
      expect(commandEntersForeignShell(command), command).toBe(0);
    }
  });
});

describe("commandLeavesShell", () => {
  it("recognizes the commands that end a shell", () => {
    for (const command of ["exit", "logout", "exit 1", "  exit  ", "cd /; exit", "exec exit"]) {
      expect(commandLeavesShell(command), command).toBe(true);
    }
    for (const command of ["", "echo exit", "exitcode", "ls exit", "ssh exit"]) {
      expect(commandLeavesShell(command), command).toBe(false);
    }
  });
});

describe("ForeignShellTracker", () => {
  it("follows enter and leave and never underflows", () => {
    const shells = new ForeignShellTracker();
    expect(shells.isActive()).toBe(false);
    shells.leave();
    expect(shells.isActive()).toBe(false);
    shells.enter(0);
    expect(shells.isActive()).toBe(false);
    shells.enter(1, "$ ");
    shells.enter(1, "root@box# ");
    expect(shells.getDepth()).toBe(2);
    shells.leave();
    expect(shells.isActive()).toBe(true);
    shells.leave();
    expect(shells.isActive()).toBe(false);
  });

  it("bounds runaway nesting", () => {
    const shells = new ForeignShellTracker();
    shells.enter(Number.MAX_SAFE_INTEGER);
    expect(shells.getDepth()).toBe(ForeignShellTracker.MAX_DEPTH);
  });

  it("returns early when the outermost prompt comes back", () => {
    const shells = new ForeignShellTracker();
    shells.enter(1, "alice@host:~$");
    shells.notePrompt("root@container:/#");
    expect(shells.isActive()).toBe(true);
    shells.notePrompt("alice@host:~$");
    expect(shells.isActive()).toBe(false);
  });

  it("ignores prompts when no outer prompt was recorded", () => {
    const shells = new ForeignShellTracker();
    shells.enter(1);
    shells.notePrompt("$");
    expect(shells.isActive()).toBe(true);
  });

  it("resets on reconnect", () => {
    const shells = new ForeignShellTracker();
    shells.enter(2, "$ ");
    shells.reset();
    expect(shells.isActive()).toBe(false);
    expect(shells.getDepth()).toBe(0);
  });
});
