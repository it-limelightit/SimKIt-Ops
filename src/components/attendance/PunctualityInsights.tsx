import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui-kit";
import { attendanceSummary, formatAttendanceDuration } from "@/lib/attendance-analytics";
import { dateLabel, timeLabel } from "@/lib/device-attendance";
import type { EmployeeDay } from "./attendance-history";

export function PunctualityInsights({
  days,
  onSelect,
}: {
  days: EmployeeDay[];
  onSelect: (date: string) => void;
}) {
  const rows = useMemo(
    () =>
      days
        .filter((day) => day.row?.entry_at)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => ({
          date: day.date,
          delay: day.row!.late_minutes,
          arrival: day.row!.entry_at,
        })),
    [days],
  );
  const summary = attendanceSummary(days.flatMap((day) => (day.row ? [day.row] : [])));
  const measured = summary.onTime + summary.late;
  const worst = rows
    .filter((row) => row.delay !== null)
    .reduce<(typeof rows)[number] | null>(
      (max, row) => (!max || (row.delay ?? 0) > (max.delay ?? 0) ? row : max),
      null,
    );
  return (
    <Card className="min-w-0 rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Punctuality insights</h3>
          <p className="mt-1 text-xs text-text-secondary">
            How consistently the employee arrived on time in the selected period.
          </p>
        </div>
        <span className="text-xs text-text-secondary">{measured} assessed scans</span>
      </div>
      <div className="my-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
        {[
          {
            label: "On-time arrivals",
            value: `${summary.onTime} of ${measured}`,
            detail: measured
              ? `${Math.round((summary.onTime / measured) * 100)}% on time`
              : "No assessed scans",
            tone: "text-mint",
          },
          {
            label: "Late arrivals",
            value: String(summary.late),
            detail: "Days with a measured delay",
            tone: "text-warning",
          },
          {
            label: "Average delay on late days",
            value: formatAttendanceDuration(summary.averageDelay),
            detail: summary.late
              ? `Based on ${summary.late} late ${summary.late === 1 ? "day" : "days"}`
              : "No late days recorded",
            tone: "text-text-primary",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border bg-surface-raised/30 p-3"
          >
            <p className="text-xs text-text-secondary">{item.label}</p>
            <p className={`mt-1 text-xl font-semibold ${item.tone}`}>{item.value}</p>
            <p className="mt-1 text-[11px] text-text-secondary">{item.detail}</p>
          </div>
        ))}
      </div>
      {worst && worst.delay !== null && worst.delay > 0 && (
        <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-text-secondary">
          <strong className="text-warning">
            Largest recorded delay: {formatAttendanceDuration(worst.delay)}
          </strong>{" "}
          on {dateLabel(worst.date)} · First scan {timeLabel(worst.arrival)} IST. Select that date
          to inspect the record.
        </p>
      )}
      <h4 className="text-xs font-semibold text-text-primary">Delay by date</h4>
      <p className="mt-1 text-[11px] text-text-secondary">
        Zero means on time. Higher points mean a longer delay. Hover for details, or click to open a
        date.
      </p>
      {measured ? (
        <div className="mt-3 h-52" aria-label="Measured arrival delays by date">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 15, right: 10, left: 0, bottom: 5 }}
              onClick={(event) => {
                if (typeof event?.activeLabel === "string") onSelect(event.activeLabel);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(date) =>
                  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })
                }
                tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                minTickGap={25}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tickFormatter={(value) => formatAttendanceDuration(value)}
                tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                width={58}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(value) => dateLabel(String(value))}
                formatter={(value) => [formatAttendanceDuration(Number(value)), "Delay"]}
                contentStyle={{
                  borderRadius: 10,
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                  fontSize: 12,
                }}
              />
              <Line
                dataKey="delay"
                name="Delay"
                type="linear"
                stroke="var(--lime)"
                strokeWidth={2}
                connectNulls={false}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  return (
                    <circle
                      key={payload.date}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={payload.delay > 0 ? "var(--warning)" : "var(--mint)"}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-surface-raised px-4 py-5 text-center text-sm text-text-secondary">
          No scans with a measured arrival delay in this period.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-secondary">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-mint" />
          On time
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />
          Late
        </span>
        {rows.length > measured && (
          <span>{rows.length - measured} scans have no timing assessment and are excluded.</span>
        )}
      </div>
    </Card>
  );
}
