import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ListInput } from "../components/ListInput";
import { Field } from "../components/ui";

function Leadership() {
  const [items, setItems] = useState(["Code Review", "Mentoring", "Estimation"]);
  return <Field label="Leadership"><ListInput label="Leadership" value={items} onChange={setItems} /></Field>;
}

describe("list input inside a label", () => {
  it("clicking the label or a blank area never removes an item (it focuses the text box)", async () => {
    render(<Leadership />);
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByText("Leadership"));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Leadership" })).toHaveFocus();
  });

  it("still adds with Enter and removes with ×", async () => {
    render(<Leadership />);
    await userEvent.type(screen.getByRole("textbox", { name: "Leadership" }), "Hiring{Enter}");
    expect(screen.getByText("Hiring")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Mentoring" }));
    expect(screen.queryByText("Mentoring")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
  });
});
