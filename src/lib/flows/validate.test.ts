import { describe, it, expect } from "vitest";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "entry_node_id" &&
          i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(
      issues.some((i) => i.message.includes("at least one node")),
    ).toBe(true);
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) =>
          i.message.includes("Duplicate node_key") &&
          i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.message.includes("at least one keyword"),
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("blank"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.node_key === "b" && i.field === "text"),
    ).toBe(true);
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at most 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: longTitle, next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("over 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "Go", next_node_key: "ghost" },
          ],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Duplicate button reply id")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("exceeds 24 chars")),
    ).toBe(true);
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("unreachable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [
      { node_key: "s", node_type: "wibble", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Unknown node type")),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — show_menu", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (menuConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "show_menu", config: menuConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a valid show_menu node (no body required)", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ intro_text: "Menu:", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing next_node_key", () => {
    const issues = validateFlowForActivation(baseFlow, nodesWith({}));
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "next_node_key"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "ghost" }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "next_node_key"),
    ).toBe(true);
  });

  it("treats show_menu as a normal forward edge for reachability", () => {
    const set = reachableFromEntry("s", nodesWith({ next_node_key: "h" }));
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("validateFlowForActivation — send_media", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (mediaConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "send_media", config: mediaConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated send_media node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "document",
        media_url: "https://cdn.example/invoice.pdf",
        caption: "Your invoice",
        filename: "invoice.pdf",
        next_node_key: "h",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing media_url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_url"),
    ).toBe(true);
  });

  it("flags missing media_type", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_type"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "ghost",
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "m" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags caption exceeding 1024 chars", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        caption: "x".repeat(1025),
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "caption"),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});

// ============================================================
// Booking nodes (pick_date / check_availability / create_reservation)
// ============================================================

const bookingFlow = {
  name: "Book a table",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["book"] },
  entry_node_id: "s",
};

/** A well-formed booking graph; override one node's config per test. */
function bookingNodes(
  overrides: {
    pd?: Record<string, unknown>;
    ca?: Record<string, unknown>;
    cr?: Record<string, unknown>;
  } = {},
) {
  return [
    { node_key: "s", node_type: "start", config: { next_node_key: "pd" } },
    {
      node_key: "pd",
      node_type: "pick_date",
      config: overrides.pd ?? {
        text: "Which day?",
        days_to_offer: 2,
        output_var: "booking_date",
        next_node_key: "ca",
        no_dates_next: "e",
      },
    },
    {
      node_key: "ca",
      node_type: "check_availability",
      config: overrides.ca ?? {
        date_var: "booking_date",
        text: "Pick a time",
        button_label: "View times",
        slot_interval_minutes: 30,
        output_var: "booking_time",
        next_node_key: "cr",
        unavailable_next: "e",
      },
    },
    {
      node_key: "cr",
      node_type: "create_reservation",
      config: overrides.cr ?? {
        date_var: "booking_date",
        time_var: "booking_time",
        party_size_var: "party_size",
        reservation_status: "pending",
        success_next: "e",
        error_next: "e",
      },
    },
    { node_key: "e", node_type: "end", config: {} },
  ];
}

describe("validateFlowForActivation — booking nodes", () => {
  it("accepts a well-formed booking flow", () => {
    expect(validateFlowForActivation(bookingFlow, bookingNodes())).toEqual([]);
  });

  it("allows pick_date without a no-open-days branch (built-in fallback)", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        pd: {
          text: "Which day?",
          days_to_offer: 2,
          output_var: "booking_date",
          next_node_key: "ca",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "pd" && i.field === "no_dates_next"),
    ).toBe(false);
  });

  it("flags pick_date with days_to_offer above the button limit", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        pd: {
          text: "Which day?",
          days_to_offer: 5,
          output_var: "booking_date",
          next_node_key: "ca",
          no_dates_next: "e",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "pd" && i.field === "days_to_offer"),
    ).toBe(true);
  });

  it("flags pick_date output_var that isn't a valid identifier", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        pd: {
          text: "Which day?",
          days_to_offer: 2,
          output_var: "2bad",
          next_node_key: "ca",
          no_dates_next: "e",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "pd" && i.field === "output_var"),
    ).toBe(true);
  });

  it("flags check_availability with a non-positive interval", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        ca: {
          date_var: "booking_date",
          text: "Pick a time",
          button_label: "View times",
          slot_interval_minutes: 0,
          output_var: "booking_time",
          next_node_key: "cr",
          unavailable_next: "e",
        },
      }),
    );
    expect(
      issues.some(
        (i) => i.node_key === "ca" && i.field === "slot_interval_minutes",
      ),
    ).toBe(true);
  });

  it("allows check_availability without an unavailable branch (built-in fallback)", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        ca: {
          date_var: "booking_date",
          text: "Pick a time",
          button_label: "View times",
          slot_interval_minutes: 30,
          output_var: "booking_time",
          next_node_key: "cr",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "ca" && i.field === "unavailable_next"),
    ).toBe(false);
  });

  it("flags check_availability max_options above the list limit", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        ca: {
          date_var: "booking_date",
          text: "Pick a time",
          button_label: "View times",
          slot_interval_minutes: 30,
          max_options: 25,
          output_var: "booking_time",
          next_node_key: "cr",
          unavailable_next: "e",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "ca" && i.field === "max_options"),
    ).toBe(true);
  });

  it("flags create_reservation missing a required var", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        cr: {
          date_var: "booking_date",
          time_var: "booking_time",
          party_size_var: "",
          reservation_status: "pending",
          success_next: "e",
          error_next: "e",
        },
      }),
    );
    expect(
      issues.some((i) => i.node_key === "cr" && i.field === "party_size_var"),
    ).toBe(true);
  });

  it("flags create_reservation with an invalid status", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        cr: {
          date_var: "booking_date",
          time_var: "booking_time",
          party_size_var: "party_size",
          reservation_status: "tentative",
          success_next: "e",
          error_next: "e",
        },
      }),
    );
    expect(
      issues.some(
        (i) => i.node_key === "cr" && i.field === "reservation_status",
      ),
    ).toBe(true);
  });

  it("allows create_reservation without branch targets (built-in messages)", () => {
    const issues = validateFlowForActivation(
      bookingFlow,
      bookingNodes({
        cr: {
          date_var: "booking_date",
          time_var: "booking_time",
          party_size_var: "party_size",
          reservation_status: "pending",
        },
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "cr" &&
          (i.field === "error_next" || i.field === "success_next"),
      ),
    ).toBe(false);
  });

  it("walks booking branches for reachability", () => {
    const set = reachableFromEntry("s", bookingNodes());
    expect(set).toEqual(new Set(["s", "pd", "ca", "cr", "e"]));
  });
});
