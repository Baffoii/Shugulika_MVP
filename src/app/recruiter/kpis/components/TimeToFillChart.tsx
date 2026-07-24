"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TimeToFillTrendPoint } from "@/lib/data/recruiter-kpis";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

export function TimeToFillChart({ data }: { data: TimeToFillTrendPoint[] }) {
  const chartData = data.map((d) => ({
    ...d,
    avgDays: d.avgDays ?? undefined,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time-to-fill trend</CardTitle>
      </CardHeader>
      <CardBody>
        <div
          className="h-56 w-full"
          role="img"
          aria-label="Average time to fill over the last 8 weeks"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="d" width={36} />
              <Tooltip
                formatter={(value) => [`${value} days`, "Avg time to fill"]}
                labelFormatter={(label) => `Week of ${label}`}
              />
              <Line
                type="monotone"
                dataKey="avgDays"
                stroke="#0f766e"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                name="Avg days"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
