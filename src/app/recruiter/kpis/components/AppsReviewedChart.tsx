"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AppsReviewedTrendPoint } from "@/lib/data/recruiter-kpis";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

export function AppsReviewedChart({ data }: { data: AppsReviewedTrendPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Applications reviewed</CardTitle>
      </CardHeader>
      <CardBody>
        <div
          className="h-56 w-full"
          role="img"
          aria-label="Applications reviewed per week over the last 8 weeks"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <Tooltip formatter={(value: number) => [value, "Reviews"]} />
              <Bar dataKey="count" fill="#0f766e" radius={[4, 4, 0, 0]} name="Reviews" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
