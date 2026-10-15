import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../api/queryClient";

describe("query client", () => {
  it("refetches lists on screen after any successful change", async () => {
    const client = createQueryClient({ queries: { retry: false } });
    const fetchJobs = vi.fn(async () => ["job"]);
    const observer = new QueryObserver(client, { queryKey: ["jobs"], queryFn: fetchJobs });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(fetchJobs).toHaveBeenCalledTimes(1));

    // A change that doesn't say which lists it affects.
    await client.getMutationCache().build(client, { mutationFn: async () => "ok" }).execute(undefined);
    await vi.waitFor(() => expect(fetchJobs).toHaveBeenCalledTimes(2));

    // A failed change refreshes nothing.
    await client.getMutationCache().build(client, { mutationFn: async () => { throw new Error("no"); } })
      .execute(undefined).catch(() => {});
    expect(fetchJobs).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
