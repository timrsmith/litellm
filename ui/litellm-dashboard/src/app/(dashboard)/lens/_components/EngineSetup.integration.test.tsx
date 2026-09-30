import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/test-utils";
import { EngineSetup } from "./EngineSetup";
import { apiClient } from "@/components/networking";
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
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.post).mockResolvedValue({ eligible: 0, executions: [] });
  });
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
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Metadata key 1" }), { target: { value: "swarm" } });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a key and value for every condition, or remove it");
    expect(screen.queryByRole("textbox", { name: "Questions & checks" })).not.toBeInTheDocument();
  });
  it("previews identifiable matching runs and saves the same filter selection", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockImplementation(async (_path, options) => {
      const body = options?.body as { settings: Settings };
      return body.settings.filters?.some((f) => f.key === "swarm" && f.value === "research")
        ? {
            eligible: 1,
            executions: [
              {
                id: "run",
                source: "requests",
                trace_id: "request-42",
                name: "Research report",
                start_time: "2026-09-30 18:00:00.000",
                span_count: 1,
              },
            ],
          }
        : { eligible: 0, executions: [] };
    });
    renderWithProviders(<EngineSetup models={["analysis"]} accessToken="test" onClose={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Research" } });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Metadata key 1" }), { target: { value: "swarm" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Metadata value 1" }), { target: { value: "research" } });
    expect(await screen.findByText("1 matching runs")).toBeInTheDocument();
    expect(screen.getByText("Research report")).toBeInTheDocument();
    expect(screen.getByText("request-42")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("swarm is research")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Analysis model" }), "analysis");
    await user.click(screen.getByRole("button", { name: "Run analysis" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ key: "swarm", value: "research" }], enabled: false }),
    );
  });
});
