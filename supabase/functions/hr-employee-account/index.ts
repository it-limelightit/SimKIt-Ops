import {
  body,
  checked,
  HttpError,
  json,
  manager,
  publishPending,
  serve,
} from "../_shared/attendance.ts";
import { uuid } from "../_shared/attendance-validation.ts";

serve(async (req) => {
  const { admin, user } = await manager(req);
  checked(await user.rpc("hr_assert_access"));
  const input = await body(req);
  const employee = uuid(input.employee_id);
  const revision = input.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 1)
    throw new HttpError(400, "Employee revision required");
  if (input.action === "enroll") {
    const status = checked(
      await user.rpc("hr_request_enrollment", { _employee: employee, _revision: revision }),
    );
    const record = checked(
      await admin.from("hr_employees").select("attendance_employee_id").eq("id", employee).single(),
    ) as { attendance_employee_id: string };
    let publishing = { configured: false, sent: 0 };
    if (status !== "enrolled") {
      try {
        publishing = await publishPending(admin, record.attendance_employee_id);
      } catch {
        /* Keep the saved request for retry. */
      }
    }
    return json({ employee_id: employee, status, publishing });
  }
  if (input.action !== "create") throw new HttpError(400, "Invalid HR account action");
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 8 || password.length > 128)
    throw new HttpError(400, "Password must contain 8 to 128 characters");
  const context = checked(
    await user.rpc("hr_provision_context", { _employee: employee, _revision: revision }),
  ) as {
    id: string;
    email: string;
    name: string;
    mobile: string;
    app_access: string;
    attendance_employee_id: string;
  };
  const office = context.app_access === "employee";
  const created = await admin.auth.admin.createUser({
    email: context.email,
    password,
    email_confirm: true,
    app_metadata: office
      ? { office_employee: true, attendance_employee_id: context.attendance_employee_id }
      : {},
    user_metadata: { name: context.name, mobile: context.mobile, role: "worker" },
  });
  if (created.error || !created.data.user)
    throw new HttpError(
      409,
      "Could not create login. If the email already has an account, use Link existing login. Otherwise, check the password policy.",
    );
  const accountId = created.data.user.id;
  try {
    checked(await user.rpc("hr_attach_login", { _employee: employee, _revision: revision }));
  } catch (error) {
    // A lost response may follow a committed transaction. Never delete a linked account.
    const saved = await admin
      .from("hr_employees")
      .select("auth_user_id")
      .eq("id", employee)
      .maybeSingle();
    if (saved.error)
      throw new HttpError(
        503,
        "Login was created, but its link could not be verified. Refresh and use Link existing login; do not create a second account.",
      );
    if (saved.data?.auth_user_id === accountId)
      return json({ employee_id: employee, linked: true });
    const cleanup = await admin.auth.admin.deleteUser(accountId);
    if (cleanup.error)
      throw new HttpError(
        503,
        "Login was created but could not be linked or cleaned up. Refresh and use Link existing login.",
      );
    throw error;
  }
  // Account creation never starts face enrollment. No webcam is required.
  return json({ employee_id: employee, linked: true });
});
