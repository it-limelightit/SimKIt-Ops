Yes, let’s discuss first. **I haven’t changed any code, and I’ll wait until you say “start developing.”**

I checked the current code: office employee creation currently creates a login and requests face enrollment on the attendance device. Field associates have a separate **“Mark as online”** flow.

For Hardik bhai’s account (`admin@limelightit.io`), I suggest a section named **HR / Hiring** with this flow:

**1. Add the employee once**

Hardik enters the employee’s details. We create one HR record and either link their existing SimKit account or create their login. Existing employees should be linked so their attendance and work history stay connected.

Three separate choices matter here:

| Detail | Example |
|---|---|
| Employment type | Internship / Full time |
| App access | Employee / Field associate / Manager |
| Attendance method | Office device / Field online / Other approved method |

An intern can be a field associate, and a full-time employee can work in the office. Changing internship to full time should keep the same employee ID and history.

**2. Hardik doesn’t need the face device with him**

For an office employee, the proposed flow is:

**Hardik adds employee → Face enrollment pending → Someone at the office starts enrollment when the employee is at the device → Device confirms registration.**

Hardik can manage the employee remotely. The employee still needs to stand in front of the office device for the existing face registration process.

If you mean **capturing the employee’s face through a phone or laptop camera**, that would be an additional feature. A webcam photo alone does not establish live face verification or confirm that the attendance device can use it.

I recommend a separate **“Enroll on device”** action when the employee is ready, so adding an HR record doesn’t immediately start enrollment.

**3. Field associates**

Include them in the HR directory and link their existing field account. Their attendance can continue through the current field online flow; they wouldn’t need office face enrollment by default.

Selfie or location-based attendance could be discussed separately if you want stronger field attendance verification.

**4. Employee details and table**

Suggested order:

- Employee ID, name, email, mobile number.
- Department, designation, mentor/reporting manager.
- Joining date, employment type, active/left status.
- For interns: duration, expected end date, monthly stipend.
- For full-time staff: annual CTC/package and monthly gross salary as separate amounts.
- Attendance method and enrollment status.

The table would show current details, with a profile view for history.

**5. Salary revisions and conversion**

Use **“Revise compensation”** and **“Convert to full time”** actions with an effective date and reason. Preserve every previous value.

For example: ₹8,000 stipend from joining → ₹12,000 from a later date → full-time package from the conversion date. Extending an internship should also preserve its original dates.

Before we settle the flow, these are the main decisions:

1. By “live face scan,” do you mean **initial face registration** or **daily attendance using a phone/laptop**?
2. Should field associates appear in this HR section too? **I recommend yes, with their existing accounts linked.**
3. Should salary/package details be visible **only to Hardik**, or should anyone else have access?

---

## Development decisions — 22 October 2026

The discussion above is retained as the original proposal. Development was subsequently authorized.

- Hardik has no webcam. HR creation and login setup are separate from face enrollment. The employee registers at the existing office face device after an explicit enrollment request.
- Field associates are included in the HR directory and keep their field workspace and Mark as online attendance flow.
- HR, compensation details and offer letters are restricted to Hardik's verified, active `admin@limelightit.io` account.
- New hires can be recorded before joining. Existing users and attendance employees can be linked rather than duplicated.
- Existing office employees and active field associates are automatically visible in Hardik's main HR table. Complete HR details adds their missing information while keeping existing login and attendance records linked; unknown compensation and joining dates are not guessed.
- Internship stipend revisions, extensions and full-time conversion retain dated history. Annual CTC and monthly gross salary are separate fields.
- Software, firmware and field-associate offer letters are generated dynamically from the three supplied PDF formats, with preview, PDF download and saved offer history. The field template includes configurable incentives, travel allowance, targets and payroll-cycle terms.
- Generated offers preserve their saved employee and compensation values after later edits. Acceptance and signature spaces remain blank.

Deployment and validation details: [HR-HIRING-DEPLOYMENT.md](HR-HIRING-DEPLOYMENT.md).
