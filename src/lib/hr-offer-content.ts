import type { OfferSnapshot } from "./hr";

export type OfferBlock = { text: string; indent?: number; heading?: boolean; gap?: number };
export type OfferPage = { title?: string; blocks: OfferBlock[] };
export const offerDate = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export const offerAmount = (value: number) =>
  `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
const block = (text: string, indent = 0, gap = 7): OfferBlock => ({ text, indent, gap });

export function offerContent(snapshot: OfferSnapshot): OfferPage[] {
  const { employee: e, term: t, fields: f, template } = snapshot;
  const intern = t.employment_type === "internship";
  const period = intern ? "internship" : "employment";
  const role = e.designation;
  const intro = block(
    `You shall be governed by the following terms and condition of service during your ${period} with LimelightIT, and those may be amended from time to time.`,
    0,
    15,
  );
  const intellectual =
    "All the work that you will produce at or in relation to LimelightIT will be the intellectual property of LimelightIT. You are not allowed to store, copy, sell, share, and distribute it to a third party under any circumstances. Similarly, you are expected to refrain from talking about your work in public domains (both online such as blogging, social networking site and offline among your friends, college etc.) without prior discussion and approval with your mentor.";
  const privacy = `We take data privacy and security very seriously and to maintain confidentiality of any students, customers, clients, and companies’ data and contact details that you may get access to during your ${period} will be your responsibility. LimelightIT operates on zero tolerance principle with regards to any breach of data security guidelines.`;
  const otherWork =
    "During the appointment period you shall not engage yourselves directly or indirectly or in any capacity in any other organization (other than your college). In the event of breach of this condition, this appointment is liable to be terminated forthwith by the company. In addition, you shall be liable to pay liquidated damages to the Company of an extent estimated by the Company.";
  const professional =
    "You are expected to conduct yourself with utmost professionalism in dealing with your mentor, team members, colleagues, clients, and customers, and treat everyone with due respect.";
  const startup =
    "LimelightIT is a start-up and we love people who like to go beyond the normal call of the duty and can think out of the box. Surprise us with your passion, intelligence, creativity, and handwork – and expect appreciation & rewards to follow.";
  const feedback =
    "Expect constant and continuous objective feedback from your mentor and other team members and we encourage you to ask for and provide feedback at every possible opportunity. It is your right to receive and give feedback – this is the ONLY way we all can continuously push ourselves to do better.";
  const fun =
    "Have fun at what you do and do the right thing – both the principles are core of what LimelightIT stands for and we expect you to imbibe them in your day-to-day actions and continuously challenge us if we are falling short of expectations on either of them.";
  const evaluation =
    "Your performance will be reviewed periodically based on criteria determined by the company, including general criteria like task completion, skill development, and professionalism. The decision to provide a stipend and the amount will be subject to this review.";
  const accept = block(
    `I have negotiated, agreed, read, and understood all the terms and conditions of this ${intern ? "Internship" : "Employment"} letter as well as Annexure here to and affix my signature in complete acceptance of the terms of the letter.`,
    0,
    9,
  );
  const deadline = block(
    `**NOTE: If we do not receive your acceptance within ${f.acceptance_days} days, this offer will be considered invalid.**`,
    0,
    12,
  );
  const stipend: OfferBlock[] = intern
    ? [
        {
          text: `${template === "field_associate" ? "Stipend" : "Internship Stipend"} and Performance Evaluation Clause`,
          heading: true,
          gap: 14,
        },
        block(
          `1.  **Internship Duration:** The internship will be for a period of **${t.internship_months} months**, starting from **${offerDate(t.effective_from)}** and ending on **${offerDate(t.internship_end!)}**.`,
        ),
        block("2.  **Stipend:**", 0, 2),
        block(
          `a.  For the first **${f.initial_stipend_months} ${f.initial_stipend_months === 1 ? "month" : "months"}** of the internship, **${offerAmount(t.monthly_amount)} per month** will be provided.`,
          15,
          3,
        ),
        block(
          `b.  After the completion of the first **${f.initial_stipend_months} ${f.initial_stipend_months === 1 ? "month" : "months"}**, a stipend may be provided for the remaining duration based on your performance during the internship. The amount, if any, will be determined solely at the company’s discretion following a performance evaluation.`,
          15,
        ),
        block(
          `3.  **Performance Evaluation:** ${evaluation}${template === "field_associate" ? " Payroll and incentive structure will be reviewed after the probation period based on performance." : ""}`,
        ),
        block(
          `4.  **Acknowledgment:** By accepting this offer, you agree to the terms outlined above and ${template === "firmware" ? "acknowledge that stipend payments are conditional and not guaranteed." : "acknowledge with the payments structure."}`,
        ),
      ]
    : [
        { text: "Compensation and Performance Evaluation Clause", heading: true, gap: 14 },
        block(
          `1.  **Employment:** Your full-time employment begins on **${offerDate(t.effective_from)}**.`,
        ),
        block(
          `2.  **Compensation:** Your annual CTC/package is **${offerAmount(t.annual_ctc!)}**. Your monthly gross salary is **${offerAmount(t.monthly_amount)}**.`,
        ),
        block(
          "3.  **Performance Evaluation:** Your performance will be reviewed periodically based on task completion, skill development, professionalism, and criteria determined by the company.",
        ),
        block(
          "4.  **Acknowledgment:** By accepting this offer, you agree to the terms and compensation structure outlined above.",
        ),
      ];
  if (template === "field_associate") {
    const responsibilities = [
      "Visit assigned factories/manufacturing units.",
      "Explain LimelightIT's hardware and software solution and its benefits.",
      "Convince clients and obtain approval for demo installation on a selected machine.",
      "Collect contact details of the Plant Head, Mechanical, Electrical, or Maintenance team.",
      "Coordinate between the client and LimelightIT team throughout the installation process.",
      "Ensure hardware shipment reaches the factory on time.",
      "Schedule and manage installation activities.",
      "Supervise the installation process at the client site.",
      "Collect installation photos and required documentation.",
      "Verify that sensors, hardware, dashboard, and data flow are working properly after installation.",
      "Assist in commissioning and issue resolution with the technical team.",
      "Monitor dashboard performance and observe machine data trends.",
      "Generate operational insights, observations, and performance reports from dashboard data.",
      "Identify and communicate key metrics such as runtime, downtime, utilization, and productivity improvements.",
      "Train factory representatives on dashboard usage and key features.",
      "Explain machine runtime, downtime, alerts, notifications, and performance insights.",
      "Obtain a signed Installation Completion Certificate from the client.",
      "Submit all installation documents, reports, and observations to the company.",
      "Successfully close assigned installations and maintain client relationships.",
      "Support business growth by creating opportunities for future deployments and upselling.",
    ];
    return [
      {
        title: "Annexure A",
        blocks: [
          intro,
          block(
            `1.  You are being hired as a **${role}** and **${e.mentor_name}** would be your mentor during the tenure. As a ${role}, you would be responsible for`,
            0,
            5,
          ),
          ...responsibilities.map((text, i) =>
            block(`${String.fromCharCode(97 + i)}.  ${text}`, 15, 2),
          ),
          block(
            `2.  Your date of joining is **${offerDate(e.joining_date)}**. During the period of engagement with LimelightIT, you are expected to devote your professional time, effort, and attention to the responsibilities assigned to you. Any planned leave, examinations, personal commitments, or events that may affect your availability must be communicated to your reporting manager in advance.`,
          ),
          block(
            "3.  This role primarily involves field visits to customer locations, manufacturing units, industrial sites, and other assigned locations. You are expected to be available for assigned visits and represent LimelightIT professionally during all client interactions.",
          ),
          block(
            "4.  You shall coordinate with customers, plant heads, maintenance teams, and internal stakeholders to ensure smooth execution of assigned demonstrations, installations, commissioning activities, and related operations.",
          ),
          block(
            "5.  All work products, reports, documents, data, photographs, customer information, installation records, insights, and other materials created, collected, or generated during your engagement shall remain the sole property of LimelightIT. Such information shall not be copied, stored, shared, distributed, or disclosed to any third party without prior written approval from the company.",
          ),
        ],
      },
      {
        blocks: [
          block(
            "6.  You are responsible for maintaining the privacy and security of all customer, company, and partner data accessed during your work. Any unauthorized disclosure, misuse, or mishandling of confidential information may result in immediate termination of the engagement.",
          ),
          block(
            "7.  During the term of your appointment, you shall not directly or indirectly engage in any employment, consultancy, freelancing, internship, or professional assignment that may create a conflict of interest with your responsibilities at LimelightIT without prior written approval from the company.",
          ),
          block(
            "8.  You are expected to maintain the highest standards of professionalism, integrity, honesty, and ethical conduct while dealing with customers, factory personnel, vendors, colleagues, and company representatives.",
          ),
          block(
            "9.  All assigned site visits, demonstrations, installations, follow-ups, documentation, and customer coordination activities must be completed within the timelines communicated by the company.",
          ),
          block(
            "10.  Installation completion will be considered valid only upon submission of all required documentation, photographs, reports, and a duly signed Installation Completion Certificate from the customer.",
          ),
          block(
            "11.  Either party may terminate this association by providing 30 days' written notice. However, LimelightIT reserves the right to terminate the engagement with immediate effect in cases of misconduct, breach of confidentiality, negligence, falsification of records, non-performance, or any action detrimental to the company's interests.",
          ),
          block(
            "12.  As a growing organization, LimelightIT encourages ownership, initiative, problem-solving, and a proactive approach toward achieving business objectives. Outstanding performance may be recognized through incentives, additional responsibilities, and growth opportunities.",
          ),
          block(
            "13.  Regular feedback, performance reviews, and discussions may be conducted to assess work quality, customer satisfaction, operational effectiveness, and overall contribution to the organization.",
          ),
          block(
            "14.  Since this is a field-based role, you are expected to remain reasonably available for assigned visits, customer interactions, coordination activities, and operational requirements as communicated by the company.",
          ),
          block(
            "15.  Employees are expected to comply with all company policies, operational guidelines, safety procedures, and instructions communicated by LimelightIT from time to time.",
          ),
          block(
            "16.  Any company assets, documents, devices, access credentials, or materials provided during the engagement must be returned immediately upon request or upon termination of the association.",
          ),
        ],
      },
      {
        blocks: [
          ...stipend,
          block(
            `5.  **Incentive:** ${offerAmount(f.incentive_per_installation)} per successful factory installation completed.`,
          ),
          block(
            `6.  **Travel Allowance:** ${offerAmount(f.travel_per_km)} per kilometer for official travel.`,
          ),
          block(
            `7.  **Performance Requirement:** Minimum ${f.installation_target} assigned installations to be completed during the ${f.probation_months}-month probation period.`,
          ),
          block(
            `8.  **Payment Cycle:** Salary and incentives will be credited on day ${f.payment_day} of each month. Installations with Completion Certificates submitted by day ${f.payroll_cutoff_day} of the month will be included in the current payroll cycle; otherwise, they will be carried forward to the next month's payroll.`,
          ),
          accept,
          deadline,
        ],
      },
    ];
  }
  const firmware = template === "firmware";
  const softwareResponsibilities = [
    "Research web technologies, frameworks, databases, APIs, cloud platforms, development tools, and software solutions. Compare libraries, architectures, technologies, and implementation approaches for different application requirements.",
    "Prepare technical documentation, API documents, project reports, workflow diagrams, presentations, and development notes. Convert technical discussions into clean, structured, and maintainable documentation.",
    "Assist in developing, testing, debugging, and deploying web applications. Support frontend, backend, APIs, databases, authentication modules, and application integration while documenting observations.",
    "Help the development team with day-to-day technical and project tasks. Coordinate between frontend, backend, UI/UX, testing, and DevOps teams. Track project progress and prepare follow-up points.",
    "Work on databases, APIs, JSON files, CSV files, application data, and cloud services. Help clean, format, analyze, and summarize technical and business data.",
    "Support during requirement discussions, sprint planning, client demonstrations, testing sessions, and deployment activities. Prepare meeting minutes, implementation notes, and action points after discussions.",
    "Help prepare software modules, technical proposals, feature documentation, deployment plans, application workflows, and business requirement documents. Contribute to development, optimization, testing, and maintenance activities.",
  ];
  const first = [
    intro,
    block(
      `1.  You are being hired as a **${role}** and **${e.mentor_name}** would be your mentor during the ${intern ? "internship" : "tenure"}. As a ${role}, you would be responsible for${firmware ? " designing, developing, maintaining the Embedded Hardware and Firmware, and contributing according to team requirement." : ""}`,
    ),
    ...(firmware
      ? []
      : softwareResponsibilities.map((text, i) =>
          block(`${String.fromCharCode(97 + i)}.  ${text}`, 15, 4),
        )),
    block(
      `2.  Your date of joining is **${offerDate(e.joining_date)}**${intern && firmware ? `, and the duration of the internship would be **${t.internship_months} months**` : ""}. During this tenure, you are expected to devote your time and efforts solely to LimelightIT. You are also required to let your mentor know about forthcoming events (if there are any) in advance so that your work can be planned accordingly.`,
    ),
    block(
      `3.  You will work in office for the duration of the ${period}. There will be catch ups scheduled with your mentor to discuss work progress and overall experience at regular intervals.`,
    ),
    block(`4.  ${intellectual}`),
    block(
      `5.  ${privacy}${firmware ? ` At the completion of the ${period}, you are expected to hand over all LimelightIT innovation work/data stored on your Personal Computer to your mentor and delete the same from your machine.` : ""}`,
    ),
    block(`6.  ${otherWork}`),
  ];
  const termination = firmware
    ? "Under normal circumstances either the company may terminate you from this association by providing a notice of **1 week** OR You may leave this association by providing a notice of **30 days**, without assigning any reason. However, the company may terminate this agreement forthwith under situations of in-disciplinary behaviors."
    : "Under normal circumstances either the company or you may terminate this association by providing a notice of **30 days** without assigning any reason. However, the company may terminate this agreement forthwith under situations of in-disciplinary behaviors or any similar states.";
  if (firmware) first.push(block(`7.  ${termination}`), block(`8.  ${professional}`));
  return [
    { title: "Annexure A", blocks: first },
    {
      blocks: [
        ...(firmware ? [] : [block(`7.  ${termination}`), block(`8.  ${professional}`)]),
        block(`9.  ${startup}`),
        block(`10.  ${feedback}`),
        block(`11.  ${fun}`),
        block(`**12.  Office Timings: ${f.office_timings}**`, 0, 16),
        ...stipend,
        accept,
        deadline,
      ],
    },
  ];
}
