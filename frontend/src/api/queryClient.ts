import { MutationCache, QueryClient, type DefaultOptions } from "@tanstack/react-query";

/**
 * The app's query client. Any successful change (status, delete, edit, import…) marks every
 * cached list stale and refetches the ones on screen, so lists, counts and badges update
 * without a page reload. Returning to the browser tab refetches too (changes made elsewhere).
 */
export function createQueryClient(overrides: DefaultOptions = {}) {
  const client: QueryClient = new QueryClient({
    // A mutation that only reads (e.g. drafting text) opts out with `meta: { invalidates: false }`.
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => {
        if (mutation.meta?.invalidates !== false) void client.invalidateQueries();
      },
    }),
    defaultOptions: {
      ...overrides,
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true, ...overrides.queries },
    },
  });
  return client;
}
