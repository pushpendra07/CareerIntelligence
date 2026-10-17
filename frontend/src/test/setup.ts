import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy/waitFor wait up to 3 s (default 1 s): enough on a busy machine or a CI runner.
configure({ asyncUtilTimeout: 3000 });

// Remembered sort/filters must not leak from one test into the next.
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});
