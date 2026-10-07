import { body, checked, json, manager, publishPending, serve } from "../_shared/attendance.ts";
import { requiredText, uuid, dateOrNull } from "../_shared/attendance-validation.ts";
serve(async (req) => {
  const { admin, user } = await manager(req);
  const input = await body(req);
  let employee: string;
  if (input.action === "retry") {
    employee = uuid(input.employee_id);
    checked(await user.rpc("attendance_retry_enrollment", { _employee: employee }));
  } else {
    const department = requiredText(input.department, "department", 20);
    if (!["firmware", "hardware", "logistic", "software", "manager"].includes(department))
      throw new Error("Invalid department");
    const start = input.employment_start ? dateOrNull(input.employment_start) : null;
    if (input.employment_start && !start) throw new Error("Invalid employment start date");
    const email = input.email ? requiredText(input.email, "email", 254).toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    employee = checked(
      await user.rpc("attendance_save_employee", {
        _name: requiredText(input.name, "name", 120),
        _department: department,
        _enroll_id: requiredText(input.enroll_id, "enroll_id", 64),
        _email: email,
        _email_verified: input.email_verified === true,
        _start: start,
      }),
    );
  }
  let publishing: { configured: boolean; sent: number };
  try {
    publishing = await publishPending(admin, employee);
  } catch {
    publishing = { configured: false, sent: 0 };
  }
  const current = await admin
    .from("attendance_employees")
    .select("enrollment_status")
    .eq("id", employee)
    .maybeSingle();
  return json({
    employee_id: employee,
    status: current.data?.enrollment_status || "pending",
    publishing,
  });
});
