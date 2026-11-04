export class InspectionTimeoutError extends Error { constructor() { super("The inspection exceeded its allowed runtime."); this.name = "InspectionTimeoutError"; } }

export async function withInspectionTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new InspectionTimeoutError()), timeoutMs); })]);
  } finally { if (timeout) clearTimeout(timeout); }
}
