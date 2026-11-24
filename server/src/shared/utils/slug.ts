/** Generate a URL-safe slug from a name, with a short random suffix for uniqueness */
export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}
