/**
 * The shape every identifier that ends up in a Firestore document path must have. Google
 * user ids (`sub`), Gmail message ids and this service's prompt versions are all URL-safe
 * tokens, so anything else at a trust boundary — a `/` that would address a nested
 * document, a `_` that would collide with the composite-key separator the repositories
 * use, a `..` segment — is rejected before a path is ever built from it. One definition
 * shared by every repository and request schema, so the check cannot drift between them.
 */
export const SAFE_ID = /^[A-Za-z0-9-]+$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}
