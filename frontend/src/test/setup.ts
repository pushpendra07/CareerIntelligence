import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Remembered sort/filters must not leak from one test into the next.
afterEach(() => window.localStorage.clear());
