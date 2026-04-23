import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
} from "recharts";
import { useState, useMemo } from "react";

export default function VendorChart({ data = [] }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const [sortBy, setSortBy] = useState("amount"); // 'amount' or 'vendor'
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' or 'desc'

  /* =====================================================
     PROCESS DATA FOR CHART
  ===================================================== */
  const chartData = useMemo(() => {
    // Filter out invalid entries
    const validData = data.filter(
      item => item.vendor && item.vendor !== "Unknown" && Number(item.amount) > 0
    );

    // Sort data based on current sort settings
    const sorted = [...validData].sort((a, b) => {
      if (sortBy === "amount") {
        const aVal = Number(a.amount) || 0;
        const bVal = Number(b.amount) || 0;
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
      } else {
        const aVal = a.vendor?.toLowerCase() || "";
        const bVal = b.vendor?.toLowerCase() || "";
        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
        return 0;
      }
    });

    return sorted.slice(0, 10); // Show top 10 vendors
  }, [data, sortBy, sortOrder]);

  /* =====================================================
     COLORS FOR BARS
  ===================================================== */
  const COLORS = [
    "#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe",
    "#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5"
  ];

  /* =====================================================
     FORMAT CURRENCY
  ===================================================== */
  const formatCurrency = (value) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  /* =====================================================
     HANDLE BAR CLICK
  ===================================================== */
  const handleBarClick = (data, index) => {
    setActiveIndex(index === activeIndex ? null : index);
  };

  /* =====================================================
     CUSTOM TOOLTIP
  ===================================================== */
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "12px 16px",
          boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)",
        }}>
          <p style={{ 
            margin: "0 0 6px", 
            fontWeight: "600", 
            color: "#0f172a",
            fontSize: "14px",
          }}>
            {data.vendor}
          </p>
          <p style={{ 
            margin: "0", 
            color: "#4f46e5",
            fontWeight: "700",
            fontSize: "16px",
          }}>
            {formatCurrency(data.amount)}
          </p>
          {data.invoiceCount && (
            <p style={{ 
              margin: "4px 0 0", 
              color: "#64748b",
              fontSize: "12px",
            }}>
              {data.invoiceCount} invoice{data.invoiceCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  /* =====================================================
     CUSTOM LABEL
  ===================================================== */
  const CustomLabel = (props) => {
    const { x, y, width, value } = props;
    if (width < 30) return null; // Don't show label if bar is too thin
    
    return (
      <text
        x={x + width / 2}
        y={y - 8}
        fill="#64748b"
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
      >
        {formatCurrency(value)}
      </text>
    );
  };

  /* =====================================================
     EMPTY STATE
  ===================================================== */
  if (chartData.length === 0) {
    return (
      <div className="card" style={{ 
        height: 360,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
      }}>
        <div style={{ fontSize: "48px", color: "#cbd5e1" }}>📊</div>
        <h3 style={{ margin: 0, color: "#1e293b" }}>Vendor Spending</h3>
        <p style={{ color: "#64748b", fontSize: "14px", textAlign: "center" }}>
          No vendor data available<br />
          <span style={{ fontSize: "12px" }}>Upload invoices to see spending patterns</span>
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ 
      height: 420,
      padding: "20px",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header with controls */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "20px",
        flexWrap: "wrap",
        gap: "12px",
      }}>
        <div>
          <h3 style={{ 
            margin: "0 0 4px", 
            color: "#0f172a",
            fontSize: "18px",
            fontWeight: "600",
          }}>
            Vendor Spending
          </h3>
          <p style={{ 
            margin: 0, 
            color: "#64748b", 
            fontSize: "13px",
          }}>
            Top {chartData.length} vendors • Total: {formatCurrency(
              chartData.reduce((sum, item) => sum + Number(item.amount), 0)
            )}
          </p>
        </div>

        {/* Sort Controls */}
        <div style={{
          display: "flex",
          gap: "8px",
          background: "#f8fafc",
          padding: "4px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
        }}>
          <button
            onClick={() => {
              if (sortBy === "amount") {
                setSortOrder(order => order === "desc" ? "asc" : "desc");
              } else {
                setSortBy("amount");
                setSortOrder("desc");
              }
            }}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              background: sortBy === "amount" ? "#4f46e5" : "transparent",
              color: sortBy === "amount" ? "white" : "#64748b",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: "500",
              transition: "all 0.2s ease",
            }}
          >
            Amount {sortBy === "amount" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
          <button
            onClick={() => {
              if (sortBy === "vendor") {
                setSortOrder(order => order === "asc" ? "desc" : "asc");
              } else {
                setSortBy("vendor");
                setSortOrder("asc");
              }
            }}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              background: sortBy === "vendor" ? "#4f46e5" : "transparent",
              color: sortBy === "vendor" ? "white" : "#64748b",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: "500",
              transition: "all 0.2s ease",
            }}
          >
            Vendor {sortBy === "vendor" && (sortOrder === "asc" ? "↑" : "↓")}
          </button>
        </div>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
            onClick={() => setActiveIndex(null)}
          >
            {/* Grid with light theme */}
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="#e2e8f0" 
              vertical={false}
            />

            {/* Axis styling - light theme */}
            <XAxis
              dataKey="vendor"
              stroke="#94a3b8"
              tick={{ 
                fontSize: 12,
                fill: "#64748b",
              }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={{ stroke: "#e2e8f0" }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={60}
            />

            <YAxis
              stroke="#94a3b8"
              tick={{ 
                fontSize: 12,
                fill: "#64748b",
              }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={{ stroke: "#e2e8f0" }}
              tickFormatter={(value) => `₹${(value / 1000)}k`}
            />

            {/* Professional tooltip - light theme */}
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "#f1f5f9" }}
            />

            {/* Legend */}
            <Legend
              wrapperStyle={{
                fontSize: "12px",
                color: "#64748b",
              }}
              iconType="circle"
              iconSize={8}
            />

            {/* SaaS style bars with gradient effect */}
            <Bar
              dataKey="amount"
              name="Spending Amount"
              radius={[8, 8, 0, 0]}
              onClick={handleBarClick}
              animationDuration={800}
              animationEasing="ease"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                  fillOpacity={activeIndex === index ? 1 : 0.8}
                  stroke={activeIndex === index ? COLORS[index % COLORS.length] : "none"}
                  strokeWidth={2}
                />
              ))}
              <LabelList
                dataKey="amount"
                position="top"
                content={<CustomLabel />}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer with insights */}
      {chartData.length > 0 && (
        <div style={{
          marginTop: "16px",
          padding: "12px",
          background: "#f8fafc",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          fontSize: "13px",
          color: "#475569",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>
            💡 <strong>Insight:</strong> Highest spending vendor is{" "}
            <span style={{ color: "#4f46e5", fontWeight: "600" }}>
              {chartData[0]?.vendor}
            </span>{" "}
            at {formatCurrency(chartData[0]?.amount)}
          </span>
          {activeIndex !== null && (
            <button
              onClick={() => setActiveIndex(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#4f46e5",
                cursor: "pointer",
                fontSize: "12px",
                textDecoration: "underline",
              }}
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}