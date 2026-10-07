/** Recognize only document objects belonging to the configured backend. */
export function getSiteDocumentPath(fileUrl: string, projectUrl: string): string | null {
  try {
    const url = new URL(fileUrl);
    if (url.origin !== new URL(projectUrl).origin) return null;
    const match = url.pathname.match(
      /^\/storage\/v1\/object\/(?:public|authenticated|sign)\/site-docs\/(.+)$/,
    );
    if (!match) return null;
    const objectPath = decodeURIComponent(match[1]);
    if (
      objectPath.includes("\\") ||
      objectPath.split("/").some((part) => !part || part === "." || part === "..")
    )
      return null;
    return objectPath;
  } catch {
    return null;
  }
}

type DocumentStorage = {
  from(bucket: string): {
    createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<{
      data: { signedUrl: string } | null;
      error: unknown;
    }>;
  };
};

export async function resolveSiteDocumentUrl(
  fileUrl: string,
  projectUrl: string,
  storage: DocumentStorage,
): Promise<string> {
  const objectPath = getSiteDocumentPath(fileUrl, projectUrl);
  if (!objectPath) return fileUrl;
  // The caller's signed-in session and Storage RLS determine access.
  const { data, error } = await storage.from("site-docs").createSignedUrl(objectPath, 300);
  if (error || !data?.signedUrl) throw new Error("Document access denied or file unavailable");
  return data.signedUrl;
}
