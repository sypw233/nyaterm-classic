import { describe, expect, it } from "vitest";
import { formatAiMessageTime } from "./aiMessageTime";

describe("formatAiMessageTime", () => {
  const now = new Date(2026, 10, 25, 15, 30); // 2026-11-25 15:30 local

  it("shows only wall-clock time for a message from today", () => {
    const createdAt = new Date(2026, 10, 25, 9, 5).toISOString();
    expect(formatAiMessageTime(createdAt, now)).toBe("09:05");
  });

  it("keeps the date for a message from a previous day this year", () => {
    const createdAt = new Date(2026, 10, 20, 9, 5).toISOString();
    expect(formatAiMessageTime(createdAt, now)).toBe("11-20 09:05");
  });

  it("adds the year for a message from another year", () => {
    const createdAt = new Date(2025, 0, 3, 7, 0).toISOString();
    expect(formatAiMessageTime(createdAt, now)).toBe("2025-01-03 07:00");
  });

  it("returns null for an empty or invalid timestamp", () => {
    expect(formatAiMessageTime("", now)).toBeNull();
    expect(formatAiMessageTime("not-a-date", now)).toBeNull();
  });
});
