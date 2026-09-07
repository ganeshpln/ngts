/**
 * Explicit success/failure type.
 *
 * The decision path does not use exceptions for control flow: an over-broad `catch` somewhere in a
 * pipeline is exactly how an email gets silently lost, and NFR-002 forbids silent loss. Every
 * stage returns a Result and the orchestrator decides what a failure means.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Unwrap or throw. Only for call sites that have already established success. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`Attempted to unwrap a failed Result: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}
