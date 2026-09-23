/** Bound the complete request, including reading its body, and cancel abandoned work. */
export async function requestJson(
  body: unknown,
  { signal, timeoutMs = 105_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The service took too long to respond. Please try again.", "TimeoutError"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      interrupted,
      (async () => {
        if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
        const response = await fetch(import.meta.env.VITE_API_URL || "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data: unknown = await response.json().catch(() => undefined);
        return { response, data };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
