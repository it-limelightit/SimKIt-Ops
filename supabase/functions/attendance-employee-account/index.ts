import { body, checked, HttpError, json, manager, publishPending, serve } from "../_shared/attendance.ts";
import { dateOrNull, requiredText, uuid } from "../_shared/attendance-validation.ts";

async function ensureOfficeIdentity(admin: any, accountId: string, employee: string, maySetMetadata: boolean) {
  let result = await admin.auth.admin.getUserById(accountId);
  if (result.error || !result.data.user) throw new HttpError(503, "Could not verify the office login account");
  let metadata = result.data.user.app_metadata || {};
  const matches = () => metadata.office_employee === true &&
    String(metadata.attendance_employee_id || "").toLowerCase() === employee.toLowerCase();
  if (!matches()) {
    if (!maySetMetadata) throw new HttpError(409, "Existing login is not an office employee account");
    const updated = await admin.auth.admin.updateUserById(accountId, {
      app_metadata: { ...metadata, office_employee: true, attendance_employee_id: employee },
    });
    if (updated.error) throw new HttpError(503, "Could not mark the new login as an office employee");
    result = await admin.auth.admin.getUserById(accountId);
    if (result.error || !result.data.user) throw new HttpError(503, "Could not verify the office login account");
    metadata = result.data.user.app_metadata || {};
    if (!matches()) throw new HttpError(503, "Office login metadata did not save correctly");
  }

  const roles = checked(await admin.from("user_roles").select("role").eq("user_id", accountId));
  const assigned = Array.isArray(roles) ? roles.map((row: any) => row.role) : [];
  if (assigned.length !== 1 || assigned[0] !== "employee") {
    checked(await admin.from("user_roles").delete().eq("user_id", accountId));
    checked(await admin.from("user_roles").insert({ user_id: accountId, role: "employee" }));
  }
}

serve(async (req) => {
  const { admin, user } = await manager(req);
  const input = await body(req);
  if (input.action === "link_manager") {
    const employee = uuid(input.employee_id);
    const email = requiredText(input.email, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Valid SimKit login email required");
    const record = checked(await admin.from("attendance_employees")
      .select("auth_user_id,department,deleted_at").eq("id", employee).maybeSingle());
    if (!record || record.deleted_at || record.department !== "manager")
      throw new HttpError(404, "Active manager attendance record not found");
    const matches = checked(await admin.from("profiles").select("id,email,is_active").eq("email", email).limit(2));
    if (!Array.isArray(matches) || matches.length !== 1 || !matches[0].is_active ||
      String(matches[0].email || "").toLowerCase() !== email)
      throw new HttpError(404, "Could not find one active SimKit account for that email");
    const accountId = matches[0].id as string;
    if (record.auth_user_id && record.auth_user_id !== accountId)
      throw new HttpError(409, "This Attendance record is already linked to another login");
    const accountResult = await admin.auth.admin.getUserById(accountId);
    const account = accountResult.data.user;
    if (accountResult.error || !account || !account.email_confirmed_at ||
      account.email?.toLowerCase() !== email)
      throw new HttpError(409, "The SimKit login email is not confirmed or does not match");
    const roles = checked(await admin.from("user_roles").select("role").eq("user_id", accountId));
    if (!Array.isArray(roles) || !roles.some((row: any) => row.role === "supervisor"))
      throw new HttpError(409, "This SimKit account does not have manager access");
    const oldMetadata = account.app_metadata || {};
    if (oldMetadata.office_employee === true &&
      String(oldMetadata.attendance_employee_id || "").toLowerCase() !== employee.toLowerCase())
      throw new HttpError(409, "This SimKit login is already linked to another office employee");
    const nextMetadata = { ...oldMetadata, office_employee: true, attendance_employee_id: employee };
    let metadataChanged = false;
    if (JSON.stringify(oldMetadata) !== JSON.stringify(nextMetadata)) {
      const updated = await admin.auth.admin.updateUserById(accountId, { app_metadata: nextMetadata });
      if (updated.error) throw new HttpError(503, "Could not prepare the existing manager login");
      metadataChanged = true;
    }
    try {
      checked(await user.rpc("attendance_link_manager_login", {
        _employee: employee, _auth_user: accountId, _email: email,
      }));
    } catch (error) {
      if (metadataChanged) {
        const rollback = await admin.auth.admin.updateUserById(accountId, { app_metadata: oldMetadata });
        if (rollback.error) throw new HttpError(503, "Link failed and account metadata could not be restored. Manager permissions and password remain unchanged; contact support.");
      }
      throw error;
    }
    return json({ employee_id: employee, account_linked: true, roles_changed: false, password_changed: false });
  }
  const creating = input.action === "create";
  if (!creating && input.action !== "update") throw new HttpError(400, "Invalid account action");
  const name = requiredText(input.name, "name", 120);
  const department = requiredText(input.department, "department", 20);
  if (!["firmware", "logistic", "software", "manager", "hardware"].includes(department))
    throw new HttpError(400, "Invalid department");
  if (creating && department === "hardware") throw new HttpError(400, "Select a current department");
  const email = requiredText(input.email, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Valid email required");
  const start = dateOrNull(input.employment_start);
  if (!start || start > new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10))
    throw new HttpError(400, "Valid employment start date required");
  const password = typeof input.password === "string" ? input.password : "";
  if (password && (password.length < 8 || password.length > 128))
    throw new HttpError(400, "Password must contain 8 to 128 characters");
  const employee = creating ? crypto.randomUUID() : uuid(input.employee_id);
  let accountId: string | null = null;
  let enroll: string;
  if (!creating) {
    const existing = checked(await admin.from("attendance_employees")
      .select("auth_user_id,enroll_id,deleted_at,department,email").eq("id", employee).maybeSingle());
    if (!existing || existing.deleted_at) throw new HttpError(404, "Employee not found");
    accountId = existing.auth_user_id;
    enroll = existing.enroll_id;
    if (accountId && existing.department === "manager") {
      const account = await admin.auth.admin.getUserById(accountId);
      const roles = checked(await admin.from("user_roles").select("role").eq("user_id", accountId));
      if (account.error || !account.data.user ||
        account.data.user.app_metadata.office_employee !== true ||
        account.data.user.app_metadata.attendance_employee_id !== employee ||
        !Array.isArray(roles) || !roles.some((row: any) => row.role === "supervisor"))
        throw new HttpError(409, "Linked manager login could not be verified");
      if (department !== "manager" || email !== account.data.user.email?.toLowerCase())
        throw new HttpError(400, "Keep the linked manager department and SimKit login email unchanged");
      checked(await user.rpc("attendance_update_employee", {
        _employee: employee, _name: name, _department: "manager", _email: email,
        _email_verified: true, _start: start,
      }));
      return json({ employee_id: employee, account_linked: true, roles_changed: false, password_changed: false });
    }
  } else enroll = requiredText(input.enroll_id, "enroll_id", 64);
  if (!accountId && !password) throw new HttpError(400, "Password is required to create the login account");
  const newAccount = !accountId;
  if (newAccount) {
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { office_employee: true, attendance_employee_id: employee },
      user_metadata: { name },
    });
    if (result.error || !result.data.user)
      throw new HttpError(409, "Could not create login. The email may already belong to another account, or the password may not meet the account policy.");
    accountId = result.data.user.id;
  } else {
    const existing = await admin.auth.admin.getUserById(accountId!);
    if (existing.error || existing.data.user?.app_metadata.office_employee !== true ||
      existing.data.user.app_metadata.attendance_employee_id !== employee)
      throw new HttpError(409, "Existing login is not an office employee account");
    const updated = await admin.auth.admin.updateUserById(accountId!, {
      email, email_confirm: true, ...(password ? { password } : {}), user_metadata: { name },
    });
    if (updated.error) throw new HttpError(409, "Could not update login email or password. Check for an email already in use and the password policy.");
  }
  try {
    await ensureOfficeIdentity(admin, accountId!, employee, newAccount);
    checked(await user.rpc("attendance_save_employee_account", {
      _employee: employee, _auth_user: accountId, _name: name, _department: department,
      _enroll_id: enroll, _email: email, _email_verified: input.email_verified === true,
      _start: start, _create: creating,
    }));
  } catch (error) {
    if (newAccount) {
      const cleanup = await admin.auth.admin.deleteUser(accountId!);
      if (cleanup.error) throw new HttpError(503, "Employee save failed and login cleanup needs administrator review. Do not create another account.");
    } else throw new HttpError(409, "Login updated, but employee details could not be saved. Retry saving the same details to synchronize them.");
    throw error;
  }
  // Editing details or setting a password must never trigger device enrollment.
  let publishing = { configured: false, sent: 0 };
  if (creating) {
    try { publishing = await publishPending(admin, employee); } catch { /* saved; retry separately */ }
  }
  return json({ employee_id: employee, status: "pending", account_saved: true, publishing });
});
