"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { FunnelCounts } from "@/lib/data/recruiter-kpis";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

const COLORS = ["#94a3b8", "#38bdf8", "#818cf8", "#10b981"];

export function FunnelChart({ data }: { data: FunnelCounts }) {
  const rows = [
    { stage: "Applied", count: data.applied },
    { stage: "Past CV review", count: data.shortlisted },
    { stage: "Interviewed", count: data.interviewed },
    { stage: "Hired", count: data.hired },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Placement funnel</CardTitle>
      </CardHeader>
      <CardBody>
        <div
          className="h-56 w-full"
          role="img"
          aria-label={`Funnel: ${rows.map((r) => `${r.stage} ${r.count}`).join(", ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="stage" width={88} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Candidates" radius={[0, 4, 4, 0]}>
                {rows.map((row, i) => (
                  <Cell key={row.stage} fill={COLORS[i] ?? COLORS[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
