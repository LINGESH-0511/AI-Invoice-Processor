import { useEffect, useState, useCallback, useMemo } from "react";
import API from "../services/api";
import { useNavigate } from "react-router-dom";

/* ─────────────────────────────────────────────
   ANIMATED COUNTER
───────────────────────────────────────────── */
function Counter({ value, prefix = "" }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const end = Number(value || 0);
    if (end <= 0) { setDisplay(0); return; }
    let cur = 0;
    const step  = end / 45;
    const timer = setInterval(() => {
      cur += step;
      if (cur >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(cur);
    }, 14);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{Math.round(display).toLocaleString("en-IN")}</>;
}

/* ─────────────────────────────────────────────
   MAIN DASHBOARD
───────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── Fetch with retry logic ── */
  const fetchData = useCallback(async (retryCount = 0) => {
    try {
      setLoading(true);
      setError(null);
      const res = await API.get("/invoices");
      const fetchedData = res?.data?.data || [];
      setInvoices(fetchedData);
      
      console.log(`✅ Loaded ${fetchedData.length} invoices`);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      
      if (retryCount < 3 && (err.code === 'ECONNABORTED' || err.message?.includes('network'))) {
        setTimeout(() => fetchData(retryCount + 1), 2000 * (retryCount + 1));
        setError(`Retrying connection... (Attempt ${retryCount + 1}/3)`);
      } else {
        setError("Failed to load invoices. Make sure the backend is running.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    const handleInvoiceUpdate = () => {
      console.log("🔄 Invoice updated, refreshing...");
      fetchData();
    };
    
    window.addEventListener("invoice-updated", handleInvoiceUpdate);
    window.addEventListener("invoice-reset", handleInvoiceUpdate);
    
    return () => {
      window.removeEventListener("invoice-updated", handleInvoiceUpdate);
      window.removeEventListener("invoice-reset", handleInvoiceUpdate);
    };
  }, [fetchData]);

  /* ── KPIs (using all invoices, no filtering) ── */
  const kpi = useMemo(() => {
    const totalSpend = invoices.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const vendors = new Set(
      invoices.map(i => i.vendor_name).filter(v => v && v !== "Not Found")
    ).size;
    const withGST = invoices.filter(
      i => i.vendor_gst && String(i.vendor_gst).trim() !== "" && i.vendor_gst !== "Not Found"
    ).length;
    
    const avgConfidence = invoices.reduce((acc, inv) => {
      let conf = Number(inv.gst_confidence || 0);
      if (conf > 1) conf /= 100;
      return acc + conf;
    }, 0) / (invoices.length || 1);
    
    const highValueInvoices = invoices.filter(i => Number(i.total) > 1000).length;
    
    return {
      count: invoices.length,
      totalSpend,
      vendors,
      avgSpend: invoices.length ? totalSpend / invoices.length : 0,
      withGST,
      avgConfidence: avgConfidence * 100,
      highValueInvoices,
      totalRecords: invoices.length,
    };
  }, [invoices]);

  /* ── Navigate to invoice records page ── */
  const goToInvoiceRecords = () => {
    navigate("/invoice-records");
  };

  /* ── Navigate to upload page ── */
  const goToUpload = () => {
    navigate("/upload");
  };

  /* ── Styles ── */
  const S = {
    root: {
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
      color: "#1e293b",
      paddingBottom: 40,
      height: "100%",
      display: "flex",
      flexDirection: "column",
    },
    pageTitle: {
      fontSize: 32,
      fontWeight: 700,
      color: "#0f172a",
      margin: "0 0 4px",
      letterSpacing: "-0.5px",
    },
    pageSub: {
      fontSize: 14,
      color: "#64748b",
      margin: "0 0 24px",
    },
    kpiGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(7, 1fr)",
      gap: 12,
      marginBottom: 24,
    },
    kpiCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      padding: "16px",
      position: "relative",
      overflow: "hidden",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.02)",
    },
    kpiGlow: (c) => ({
      position: "absolute",
      top: 0,
      right: 0,
      width: 60,
      height: 60,
      borderRadius: "0 16px 0 60px",
      background: c,
      opacity: 0.08,
    }),
    kpiLabel: {
      fontSize: 10,
      fontWeight: 600,
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: "0.3px",
      marginBottom: 6,
    },
    kpiValue: {
      fontSize: 22,
      fontWeight: 700,
      color: "#0f172a",
      lineHeight: 1.2,
    },
    kpiSubtext: {
      fontSize: 10,
      color: "#94a3b8",
      marginTop: 4,
    },
    quickActions: {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 16,
      marginTop: 24,
    },
    actionCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      padding: "20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      cursor: "pointer",
      transition: "all 0.2s ease",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.02)",
    },
    actionCardLeft: {
      display: "flex",
      alignItems: "center",
      gap: 16,
    },
    actionIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 24,
    },
    actionTitle: {
      fontSize: 16,
      fontWeight: 600,
      color: "#0f172a",
      marginBottom: 4,
    },
    actionDesc: {
      fontSize: 13,
      color: "#64748b",
    },
    actionArrow: {
      fontSize: 20,
      color: "#94a3b8",
    },
    errorBox: {
      background: "#fef2f2",
      border: "1px solid #fee2e2",
      borderRadius: 12,
      padding: "14px 18px",
      marginBottom: 20,
      color: "#b91c1c",
      fontSize: 14,
    },
    loadWrap: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      flexDirection: "column",
      gap: 16,
      color: "#64748b",
    },
    summaryRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
      padding: "0 4px",
    },
    totalRecords: {
      fontSize: 14,
      color: "#64748b",
      background: "#f8fafc",
      padding: "6px 16px",
      borderRadius: 30,
      border: "1px solid #e2e8f0",
    },
  };

  const KPI_COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#ec4899"];
  const kpiItems = [
    { label: "Total Invoices", value: kpi.count, prefix: "", color: KPI_COLORS[0], subtext: `of ${kpi.totalRecords} total` },
    { label: "Total Spend", value: kpi.totalSpend, prefix: "₹ ", color: KPI_COLORS[1], subtext: "Sum of all invoices" },
    { label: "Unique Vendors", value: kpi.vendors, prefix: "", color: KPI_COLORS[2], subtext: "Active suppliers" },
    { label: "Avg. Spend", value: kpi.avgSpend, prefix: "₹ ", color: KPI_COLORS[3], subtext: "Per invoice" },
    { label: "GST Verified", value: kpi.withGST, prefix: "", color: KPI_COLORS[4], subtext: "Valid GST numbers" },
    { label: "Avg Confidence", value: kpi.avgConfidence, prefix: "", suffix: "%", color: KPI_COLORS[5], subtext: "Overall accuracy" },
    { label: "High Value", value: kpi.highValueInvoices, prefix: "", color: KPI_COLORS[6], subtext: "Invoices > ₹1000" },
  ];

  if (loading && invoices.length === 0) {
    return (
      <div style={S.loadWrap}>
        <div style={{ fontSize: 32, color: "#4f46e5", animation: "spin 1s linear infinite" }}>⟳</div>
        <p style={{ color: "#64748b" }}>Loading dashboard...</p>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <div style={S.summaryRow}>
        <h1 style={S.pageTitle}>Invoice Dashboard</h1>
        <span style={S.totalRecords}>{invoices.length} total records</span>
      </div>
      
      <p style={S.pageSub}>
        KPIs update in real-time as you search or filter
      </p>

      {error && <div style={S.errorBox}>⚠ {error}</div>}

      {/* KPI Cards - 7 Cards */}
      <div style={S.kpiGrid}>
        {kpiItems.map((k, i) => (
          <div key={i} style={S.kpiCard}>
            <div style={S.kpiGlow(k.color)} />
            <div style={S.kpiLabel}>{k.label}</div>
            <div style={S.kpiValue}>
              <Counter value={k.value} prefix={k.prefix || ""} />
              {k.suffix && k.suffix}
            </div>
            <div style={S.kpiSubtext}>{k.subtext}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions - 2 Cards */}
      <div style={S.quickActions}>
        <div 
          style={S.actionCard}
          onClick={goToInvoiceRecords}
          onMouseEnter={e => { 
            e.currentTarget.style.borderColor = "#4f46e5"; 
            e.currentTarget.style.boxShadow = "0 8px 24px rgba(79, 70, 229, 0.1)"; 
          }}
          onMouseLeave={e => { 
            e.currentTarget.style.borderColor = "#e2e8f0"; 
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.02)"; 
          }}
        >
          <div style={S.actionCardLeft}>
            <div style={{ ...S.actionIcon, background: "rgba(79, 70, 229, 0.1)", color: "#4f46e5" }}>📋</div>
            <div>
              <div style={S.actionTitle}>View All Invoice Records</div>
              <div style={S.actionDesc}>Browse, search, and manage all invoices</div>
            </div>
          </div>
          <span style={S.actionArrow}>→</span>
        </div>

        <div 
          style={S.actionCard}
          onClick={goToUpload}
          onMouseEnter={e => { 
            e.currentTarget.style.borderColor = "#10b981"; 
            e.currentTarget.style.boxShadow = "0 8px 24px rgba(16, 185, 129, 0.1)"; 
          }}
          onMouseLeave={e => { 
            e.currentTarget.style.borderColor = "#e2e8f0"; 
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.02)"; 
          }}
        >
          <div style={S.actionCardLeft}>
            <div style={{ ...S.actionIcon, background: "rgba(16, 185, 129, 0.1)", color: "#10b981" }}>📤</div>
            <div>
              <div style={S.actionTitle}>Upload New Invoice</div>
              <div style={S.actionDesc}>Add new invoices to the system</div>
            </div>
          </div>
          <span style={S.actionArrow}>→</span>
        </div>
      </div>
    </div>
  );
}