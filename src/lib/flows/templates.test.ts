import { describe, it, expect } from "vitest";
import { listFlowTemplates, getFlowTemplate } from "./templates";
import { validateFlowForActivation } from "./validate";

describe("flow templates", () => {
  it("every template activates with zero errors", () => {
    for (const t of listFlowTemplates()) {
      const issues = validateFlowForActivation(
        {
          name: t.name,
          trigger_type: t.trigger_type,
          trigger_config: t.trigger_config as Record<string, unknown>,
          entry_node_id: t.entry_node_id,
        },
        t.nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config as Record<string, unknown>,
        })),
      );
      const errors = issues.filter((i) => i.severity === "error");
      expect(
        errors,
        `${t.slug} should have no validation errors: ${JSON.stringify(errors)}`,
      ).toEqual([]);
    }
  });

  it("ships the WhatsApp booking template wired through the booking nodes", () => {
    const t = getFlowTemplate("book_a_table");
    expect(t).not.toBeNull();
    const types = new Set(t!.nodes.map((n) => n.node_type));
    expect(types.has("pick_date")).toBe(true);
    expect(types.has("check_availability")).toBe(true);
    expect(types.has("create_reservation")).toBe(true);
    // Party size is captured off the buttons into a var the booking
    // node reads.
    const askParty = t!.nodes.find((n) => n.node_key === "ask_party");
    expect((askParty!.config as { capture_var?: string }).capture_var).toBe(
      "party_size",
    );
  });

  it("captures the guest's name in the booking templates", () => {
    for (const slug of ["book_a_table", "restaurant_hub"]) {
      const t = getFlowTemplate(slug);
      expect(t, slug).not.toBeNull();
      // A collect_input step stores the typed name into vars.guest_name…
      const askName = t!.nodes.find((n) => n.node_key === "ask_name");
      expect(askName, `${slug} ask_name`).toBeTruthy();
      expect((askName!.config as { var_key?: string }).var_key).toBe(
        "guest_name",
      );
      // …and create_reservation reads it back as the guest name.
      const book = t!.nodes.find((n) => n.node_type === "create_reservation");
      expect(
        (book!.config as { guest_name_var?: string }).guest_name_var,
        `${slug} guest_name_var`,
      ).toBe("guest_name");
    }
  });
});
