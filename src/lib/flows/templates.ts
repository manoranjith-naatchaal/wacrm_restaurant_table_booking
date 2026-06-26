/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CheckAvailabilityNodeConfig,
  CollectInputNodeConfig,
  ConditionNodeConfig,
  CreateReservationNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  PickDateNodeConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMediaNodeConfig,
  SendMessageNodeConfig,
  ShowMenuNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_media"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "pick_date"
  | "check_availability"
  | "create_reservation"
  | "show_menu"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | SendMediaNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | PickDateNodeConfig
    | CheckAvailabilityNodeConfig
    | CreateReservationNodeConfig
    | ShowMenuNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon:
    | "MessageSquare"
    | "HelpCircle"
    | "UserPlus"
    | "CalendarCheck"
    | "UtensilsCrossed";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Book a table — WhatsApp booking via the booking nodes
// ============================================================
const BOOK_A_TABLE: FlowTemplate = {
  slug: "book_a_table",
  name: "Book a table",
  description:
    "Let guests book over WhatsApp: ask party size, offer Today/Tomorrow, show open times, confirm, and create the reservation — no agent needed.",
  icon: "CalendarCheck",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["book", "booking", "reserve", "table"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "ask_party" },
    },
    {
      node_key: "ask_party",
      node_type: "send_buttons",
      config: {
        text: "Hi! 🍽️ Let's get your table booked. How many guests?",
        capture_var: "party_size",
        buttons: [
          { reply_id: "2", title: "2 guests", next_node_key: "pick_day" },
          { reply_id: "4", title: "4 guests", next_node_key: "pick_day" },
          { reply_id: "6", title: "6 guests", next_node_key: "pick_day" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "pick_day",
      node_type: "pick_date",
      config: {
        text: "Great! Which day would you like to come in?",
        days_to_offer: 2,
        output_var: "booking_date",
        next_node_key: "show_times",
      } as PickDateNodeConfig,
    },
    {
      node_key: "show_times",
      node_type: "check_availability",
      config: {
        date_var: "booking_date",
        text: "Here are the available times. Tap one to continue:",
        button_label: "View times",
        slot_interval_minutes: 30,
        max_options: 10,
        output_var: "booking_time",
        next_node_key: "ask_name",
      } as CheckAvailabilityNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "And your name for the reservation?",
        var_key: "guest_name",
        next_node_key: "confirm",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "confirm",
      node_type: "send_buttons",
      config: {
        text: "Please confirm — {{vars.guest_name}}, {{vars.party_size}} guests on {{vars.booking_date_label}} at {{vars.booking_time_label}}.",
        buttons: [
          { reply_id: "yes", title: "Confirm", next_node_key: "book" },
          { reply_id: "no", title: "Start over", next_node_key: "ask_party" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "book",
      node_type: "create_reservation",
      config: {
        date_var: "booking_date",
        time_var: "booking_time",
        party_size_var: "party_size",
        guest_name_var: "guest_name",
        reservation_status: "pending",
        notes_template: "Booked via WhatsApp",
        success_next: "done",
      } as CreateReservationNodeConfig,
    },
    {
      node_key: "done",
      node_type: "send_message",
      config: {
        text: "🎉 You're booked, {{vars.guest_name}}! Table for {{vars.party_size}} on {{vars.booking_date_label}} at {{vars.booking_time_label}}. See you soon!",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 5. Restaurant hub — one keyword, a menu of everything: book a
//    table, order online, view the menu, or get FAQ answers.
//    Built entirely from existing blocks.
// ============================================================
const RESTAURANT_HUB: FlowTemplate = {
  slug: "restaurant_hub",
  name: "Restaurant hub",
  description:
    "One keyword opens a welcome message + menu of options: book a table, order online (Swiggy/Zomato links), view the menu, or browse FAQs. Replace the welcome image and links with your own.",
  icon: "UtensilsCrossed",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["hi", "hello", "menu", "start"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    // Welcome media — replace the placeholder image with your own
    // (upload it in the builder). The caption is the welcome message.
    {
      node_key: "welcome",
      node_type: "send_media",
      config: {
        media_type: "image",
        media_url: "https://placehold.co/1080x720/png?text=Welcome",
        caption:
          "👋 Welcome to our restaurant! How can we help you today?",
        next_node_key: "main_menu",
      } as SendMediaNodeConfig,
    },
    // Main menu — the hub everything routes back to.
    {
      node_key: "main_menu",
      node_type: "send_list",
      config: {
        text: "Please choose an option:",
        button_label: "View options",
        sections: [
          {
            title: "How can we help?",
            rows: [
              {
                reply_id: "book",
                title: "Book a table",
                description: "Reserve a table over WhatsApp",
                next_node_key: "ask_party",
              },
              {
                reply_id: "order",
                title: "Order online",
                description: "Swiggy, Zomato & more",
                next_node_key: "order_list",
              },
              {
                reply_id: "menu",
                title: "View menu",
                description: "See our dishes & prices",
                next_node_key: "menu_show",
              },
              {
                reply_id: "faq",
                title: "FAQ",
                description: "Hours, location & more",
                next_node_key: "faq_list",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },

    // ---- Book a table (booking nodes) ----
    {
      node_key: "ask_party",
      node_type: "send_buttons",
      config: {
        text: "Great! 🍽️ How many guests?",
        capture_var: "party_size",
        buttons: [
          { reply_id: "2", title: "2 guests", next_node_key: "pick_day" },
          { reply_id: "4", title: "4 guests", next_node_key: "pick_day" },
          { reply_id: "6", title: "6 guests", next_node_key: "pick_day" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "pick_day",
      node_type: "pick_date",
      config: {
        text: "Which day would you like to come in?",
        days_to_offer: 2,
        output_var: "booking_date",
        next_node_key: "show_times",
      } as PickDateNodeConfig,
    },
    {
      node_key: "show_times",
      node_type: "check_availability",
      config: {
        date_var: "booking_date",
        text: "Here are the available times. Tap one to continue:",
        button_label: "View times",
        slot_interval_minutes: 30,
        max_options: 10,
        output_var: "booking_time",
        next_node_key: "ask_name",
      } as CheckAvailabilityNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "And your name for the reservation?",
        var_key: "guest_name",
        next_node_key: "confirm",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "confirm",
      node_type: "send_buttons",
      config: {
        text: "Please confirm — {{vars.guest_name}}, {{vars.party_size}} guests on {{vars.booking_date_label}} at {{vars.booking_time_label}}.",
        buttons: [
          { reply_id: "yes", title: "Confirm", next_node_key: "book" },
          { reply_id: "no", title: "Start over", next_node_key: "ask_party" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "book",
      node_type: "create_reservation",
      config: {
        date_var: "booking_date",
        time_var: "booking_time",
        party_size_var: "party_size",
        guest_name_var: "guest_name",
        reservation_status: "pending",
        notes_template: "Booked via WhatsApp",
        success_next: "booked",
      } as CreateReservationNodeConfig,
    },
    {
      node_key: "booked",
      node_type: "send_message",
      config: {
        // Loop back to the main menu instead of ending: after a booking
        // the guest still has a live menu to tap (order, view menu,
        // FAQ, or book again) rather than landing in a dead-end where
        // tapping anything does nothing.
        text: "🎉 You're booked, {{vars.guest_name}}! Table for {{vars.party_size}} on {{vars.booking_date_label}} at {{vars.booking_time_label}}. See you soon!\n\nAnything else?",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },

    // ---- Order online (links via text — replace with your own) ----
    {
      node_key: "order_list",
      node_type: "send_list",
      config: {
        text: "Where would you like to order from?",
        button_label: "View partners",
        sections: [
          {
            title: "Delivery partners",
            rows: [
              {
                reply_id: "swiggy",
                title: "Swiggy",
                next_node_key: "order_swiggy",
              },
              {
                reply_id: "zomato",
                title: "Zomato",
                next_node_key: "order_zomato",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "order_swiggy",
      node_type: "send_message",
      config: {
        text: "Order on Swiggy here 👇\nhttps://www.swiggy.com/\n\n(Replace this link with your Swiggy page.)",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "order_zomato",
      node_type: "send_message",
      config: {
        text: "Order on Zomato here 👇\nhttps://www.zomato.com/\n\n(Replace this link with your Zomato page.)",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },

    // ---- Menu ----
    {
      node_key: "menu_show",
      node_type: "show_menu",
      config: {
        intro_text: "Here's our menu:",
        include_prices: true,
        include_descriptions: true,
        next_node_key: "main_menu",
      } as ShowMenuNodeConfig,
    },

    // ---- FAQ (edit these answers to match your restaurant) ----
    {
      node_key: "faq_list",
      node_type: "send_list",
      config: {
        text: "What would you like to know?",
        button_label: "View questions",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "faq_hours",
              },
              {
                reply_id: "location",
                title: "Location",
                next_node_key: "faq_location",
              },
              {
                reply_id: "parking",
                title: "Parking",
                next_node_key: "faq_parking",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "faq_human",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "faq_hours",
      node_type: "send_message",
      config: {
        text: "🕒 We're open every day, 12pm–11pm. Last orders at 10:30pm.",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "faq_location",
      node_type: "send_message",
      config: {
        text: "📍 We're at 123 Main Street. Map: https://maps.google.com/\n\n(Replace with your address & map link.)",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "faq_parking",
      node_type: "send_message",
      config: {
        text: "🅿️ Yes — free parking is available right next to the restaurant.",
        next_node_key: "main_menu",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "faq_human",
      node_type: "handoff",
      config: {
        note: "Guest asked to talk to a human from the FAQ menu.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  book_a_table: BOOK_A_TABLE,
  restaurant_hub: RESTAURANT_HUB,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
