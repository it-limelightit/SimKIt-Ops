type AssessmentData = Record<string, any> | null | undefined;

export function getFactoryFormState(data: AssessmentData) {
  const submitted = data?.assessment_phase_submitted === true;
  const completed = submitted && data?.factory_operations_done === true;
  return {
    submitted,
    completed,
    title: completed ? "New factory form submitted" : "Assessment submitted — factory form pending",
    submissionKey: `${data?.factory_form_submitted_at || "submitted"}:${completed ? "completed" : "pending"}`,
  };
}

export function shouldNotifyFactorySubmission(previous: AssessmentData, next: AssessmentData) {
  const before = getFactoryFormState(previous);
  const after = getFactoryFormState(next);
  return after.completed && !before.completed;
}
