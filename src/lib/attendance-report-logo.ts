import logoUrl from "../../image copy.png";

export async function attendanceReportLogo(): Promise<string> {
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error("Could not load the report logo. Please retry.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the report logo."));
    reader.readAsDataURL(blob);
  });
}
