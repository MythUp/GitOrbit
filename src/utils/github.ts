// Purpose: Provide small helpers to extract owner and display names from GitHub profile URLs.
export function ownerFromGithubUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

export function ownerDisplayName(url: string): string {
  const owner = ownerFromGithubUrl(url);
  if (!owner) {
    return "Unknown";
  }
  return owner;
}