export function isJenilThakar(name: string | null | undefined) {
  return name?.trim().replace(/\s+/g, " ").toLowerCase() === "jenil thakar";
}
