import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/test-utils";
import { EngineSetup } from "./EngineSetup";
import type { Settings } from "./engineData";

vi.mock("@/components/networking", () => ({ apiClient: { post: vi.fn() } }));

const settings: Settings = {
  name: "Research quality",
  model: "analysis",
  source: "traces",
  context: "",
  enabled: false,
  filters: [],
  interval_minutes: 15,
  monthly_budget: 20,
  sample_size: 100,
  service: "",
  checks: [
    { id: "first", instruction: "Find repeated searches", enabled: false },
    { id: "second", instruction: "Find incomplete reports", enabled: true },
  ],
};

describe("Engine setup", () => {
  it("preserves check identity and disabled state when questions are reordered", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <EngineSetup initial={settings} models={["analysis"]} accessToken="test" onClose={vi.fn()} onSave={save} />,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Questions & checks" }), {
      target: { value: "Find incomplete reports\nFind repeated searches" },
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ checks: [settings.checks[1], settings.checks[0]] }));
  });

  it("rejects invalid metadata before moving to the questions step", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EngineSetup models={["analysis"]} accessToken="test" onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Research" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Metadata filters/ }), { target: { value: "swarm" } });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write each filter as key=value");
    expect(screen.queryByRole("textbox", { name: "Questions & checks" })).not.toBeInTheDocument();
  });
});
