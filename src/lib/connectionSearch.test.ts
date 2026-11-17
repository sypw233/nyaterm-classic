import { describe, expect, it } from "vitest";
import type { SavedConnection } from "@/types/global";
import {
  NO_SEARCH_RANK,
  normalizeConnectionSearchQuery,
  rankConnection,
  rankGroupName,
  sortByConnectionRelevance,
} from "./connectionSearch";

function connection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: "id-gateway",
    name: "Gateway",
    type: "ssh",
    host: "host.example.com",
    username: "root",
    ...overrides,
  } as SavedConnection;
}

describe("normalizeConnectionSearchQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeConnectionSearchQuery("  Prod Box  ")).toBe("prod box");
  });
});

describe("rankConnection", () => {
  it("ranks exact above prefix above substring", () => {
    const exact = rankConnection(connection({ name: "web" }), "web");
    const prefix = rankConnection(connection({ name: "web-01" }), "web");
    const substring = rankConnection(connection({ name: "my-web-01" }), "web");

    expect(exact).toBeGreaterThan(prefix!);
    expect(prefix).toBeGreaterThan(substring!);
  });

  it("prefers a name hit over the same hit in a description", () => {
    const named = rankConnection(connection({ name: "prod" }), "prod");
    const described = rankConnection(
      connection({ name: "x", description: "prod" }),
      "prod",
    );
    expect(named).toBeGreaterThan(described!);
  });

  it("matches tags without letting adjacent tags form a synthetic hit", () => {
    expect(
      rankConnection(connection({ tags: ["prod"] }), "prod"),
    ).not.toBeNull();
    expect(
      rankConnection(connection({ tags: ["pro", "d"] }), "prod"),
    ).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(rankConnection(connection(), "zzz")).toBeNull();
  });

  it("inherits a matching group rank", () => {
    const inherited = rankConnection(connection({ name: "node" }), "prod", 350);
    expect(inherited).not.toBeNull();
    expect(inherited).toBeGreaterThanOrEqual(350);
  });

  it("returns the neutral rank for an empty query", () => {
    expect(rankConnection(connection(), "   ")).toBe(NO_SEARCH_RANK);
  });
});

describe("rankGroupName", () => {
  it("uses the lower group weight tier than direct fields", () => {
    const group = rankGroupName("Production", "prod");
    const direct = rankConnection(connection({ name: "Production" }), "prod");
    expect(group).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(group);
  });
});

describe("sortByConnectionRelevance", () => {
  const records = [
    { connection: connection({ id: "c1", name: "my-prod-host" }) },
    { connection: connection({ id: "c2", name: "prod" }) },
    { connection: connection({ id: "c3", name: "prod-01" }) },
  ];

  it("orders by rank and keeps input order on ties", () => {
    const sorted = sortByConnectionRelevance(
      records,
      "prod",
      (record) => record.connection,
    );
    expect(sorted.map((record) => record.connection.id)).toEqual([
      "c2",
      "c3",
      "c1",
    ]);
  });

  it("returns a copy in the original order when the query is empty", () => {
    const sorted = sortByConnectionRelevance(
      records,
      "",
      (record) => record.connection,
    );
    expect(sorted.map((record) => record.connection.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(sorted).not.toBe(records);
  });

  it("drops non-matching records", () => {
    const sorted = sortByConnectionRelevance(
      records,
      "prod",
      (record) => record.connection,
    );
    expect(sorted).toHaveLength(3);
    expect(
      sortByConnectionRelevance(
        records,
        "nothing-here",
        (record) => record.connection,
      ),
    ).toHaveLength(0);
  });

  it("uses the supplied group rank for subtree matches", () => {
    const scoped = [
      { connection: connection({ id: "g1", name: "alpha" }), groupRank: 350 },
      { connection: connection({ id: "g2", name: "prod" }), groupRank: 0 },
    ];
    const sorted = sortByConnectionRelevance(
      scoped,
      "prod",
      (record) => record.connection,
      (record) => record.groupRank,
    );
    expect(sorted.map((record) => record.connection.id)).toEqual(["g2", "g1"]);
  });
});
