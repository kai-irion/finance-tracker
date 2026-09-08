const PAGE_SIZE = 1000;

// Supabase/PostgREST caps an unbounded select at 1000 rows by default — silently, with no
// error, just a short result. Any query meant to load "every matching row" (not a
// deliberately-limited page) needs to loop with .range() until a page comes back short of
// PAGE_SIZE, or it truncates once the table grows past 1000 rows. `buildPage` should
// construct the *whole* query fresh each call (select/filters/order + .range(from, to)),
// since a Supabase query builder isn't meant to be re-awaited after mutation.
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}
