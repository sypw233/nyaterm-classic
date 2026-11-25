import { describe, expect, it } from "vitest";
import { completePathFragment } from "./pathCompletion";

const dir = (name: string) => ({ name, isDirectory: true });
const file = (name: string) => ({ name, isDirectory: false });

describe("completePathFragment", () => {
  it("completes a unique directory with a trailing separator", () => {
    expect(
      completePathFragment("/home/us", [dir("user"), file("notes.txt")]),
    ).toEqual({ value: "/home/user/", completed: true });
  });

  it("ignores files", () => {
    expect(
      completePathFragment("/home/us", [file("useful.txt")]),
    ).toEqual({ value: "/home/us", completed: false });
  });

  it("extends to the shared prefix for several matches", () => {
    const result = completePathFragment("/var/lo", [dir("log"), dir("local")]);
    expect(result).toEqual({ value: "/var/lo", completed: false });
    // "lo" already covers the shared prefix of log/local, so nothing changes.
  });

  it("narrows multi-match input to the longest common prefix", () => {
    const result = completePathFragment("/var/l", [dir("log"), dir("local"), dir("lib")]);
    expect(result).toEqual({ value: "/var/l", completed: false });
  });

  it("completes a bare fragment with no parent", () => {
    expect(completePathFragment("Do", [dir("Documents")])).toEqual({
      value: "Documents/",
      completed: true,
    });
  });

  it("is case-insensitive when matching", () => {
    expect(completePathFragment("/x/my", [dir("MyFolder")])).toEqual({
      value: "/x/MyFolder/",
      completed: true,
    });
  });

  it("returns the input unchanged when nothing matches", () => {
    expect(completePathFragment("/x/zzz", [dir("abc")])).toEqual({
      value: "/x/zzz",
      completed: false,
    });
  });

  it("uses a backslash separator for Windows-style input", () => {
    expect(completePathFragment("C:\\Us", [dir("Users")])).toEqual({
      value: "C:\\Users\\",
      completed: true,
    });
  });
});
