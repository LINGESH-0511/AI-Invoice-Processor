import React, { useEffect, useState, useCallback, useMemo } from "react";
import API from "../services/api";
import { useNavigate } from "react-router-dom";
import { normalizeDate, dateMatchesSearch, formatDisplayDate } from "../utils/dateUtils";

/* ─────────────────────────────────────────────
   GST BADGE
───────────────────────────────────────────── */
function GSTBadge({ value, confidence }) {
  const ok = value && String(value).trim() !== "" && value !== "Not Found";
  let conf = Number(confidence || 0);
  if (conf > 1) conf /= 100;
  
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: "20px",
        fontSize: "11px",
        fontWeight: 700,
        background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
        color: ok ? "#16a34a" : "#dc2626",
        border: `1px solid ${ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
      }}>
        {ok ? "✓ Verified" : "✗ Missing"}
      </span>
      {ok && confidence && (
        <span style={{ fontSize: "10px", color: "#64748b" }}>
          {(conf * 100).toFixed(0)}% confidence
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SORT ICON
───────────────────────────────────────────── */
function SortIcon({ active, dir }) {
  if (!active) return <span style={{ opacity: 0.3, marginLeft: 4, color: "#94a3b8" }}>⇅</span>;
  return <span style={{ color: "#4f46e5", marginLeft: 4 }}>{dir === "asc" ? "↑" : "↓"}</span>;
}

/* ─────────────────────────────────────────────
   TABLE CELL WITH TOOLTIP
───────────────────────────────────────────── */
function Cell({ value, mono = false, bold = false, tooltip = null }) {
  const empty = !value || String(value).trim() === "" || value === "Not Found";
  const displayValue = empty ? "—" : String(value);
  
  return (
    <div style={{ position: "relative" }}>
      <span
        title={tooltip || (!empty ? String(value) : "")}
        style={{
          color: empty ? "#94a3b8" : bold ? "#0f172a" : "#475569",
          fontStyle: empty ? "italic" : "normal",
          fontFamily: mono ? "'Courier New', monospace" : "inherit",
          fontSize: mono ? "12px" : "13px",
          fontWeight: bold ? 600 : 400,
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayValue}
      </span>
      {!empty && value && value.length > 30 && (
        <span style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px", display: "block" }}>
          Hover to see full
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PAGE BUTTONS COMPONENT
───────────────────────────────────────────── */
function PageButtons({ currentPage, totalPages, onPageChange }) {
  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    let l;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }

    range.forEach((i) => {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(i);
      l = i;
    });

    return rangeWithDots;
  };

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      <button
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
        style={{
          padding: "6px 10px",
          border: "1px solid #e2e8f0",
          background: currentPage === 1 ? "#f1f5f9" : "#ffffff",
          borderRadius: "6px",
          cursor: currentPage === 1 ? "not-allowed" : "pointer",
          color: currentPage === 1 ? "#94a3b8" : "#4f46e5",
          fontSize: "13px",
        }}
      >«</button>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        style={{
          padding: "6px 10px",
          border: "1px solid #e2e8f0",
          background: currentPage === 1 ? "#f1f5f9" : "#ffffff",
          borderRadius: "6px",
          cursor: currentPage === 1 ? "not-allowed" : "pointer",
          color: currentPage === 1 ? "#94a3b8" : "#4f46e5",
          fontSize: "13px",
        }}
      >‹</button>
      
      {getPageNumbers().map((page, index) => (
        page === "..." ? (
          <span key={`dots-${index}`} style={{ padding: "6px 8px", color: "#94a3b8" }}>...</span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            style={{
              padding: "6px 12px",
              border: "1px solid",
              borderColor: currentPage === page ? "#4f46e5" : "#e2e8f0",
              background: currentPage === page ? "#4f46e5" : "#ffffff",
              borderRadius: "6px",
              cursor: "pointer",
              color: currentPage === page ? "#ffffff" : "#64748b",
              fontSize: "13px",
              fontWeight: currentPage === page ? "600" : "400",
            }}
          >{page}</button>
        )
      ))}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        style={{
          padding: "6px 10px",
          border: "1px solid #e2e8f0",
          background: currentPage === totalPages ? "#f1f5f9" : "#ffffff",
          borderRadius: "6px",
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          color: currentPage === totalPages ? "#94a3b8" : "#4f46e5",
          fontSize: "13px",
        }}
      >›</button>
      <button
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage === totalPages}
        style={{
          padding: "6px 10px",
          border: "1px solid #e2e8f0",
          background: currentPage === totalPages ? "#f1f5f9" : "#ffffff",
          borderRadius: "6px",
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          color: currentPage === totalPages ? "#94a3b8" : "#4f46e5",
          fontSize: "13px",
        }}
      >»</button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN INVOICE RECORDS PAGE
───────────────────────────────────────────── */
export default function InvoiceRecords() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [sortField, setSortField] = useState("id");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [expandedRow, setExpandedRow] = useState(null);

  const PER_PAGE = itemsPerPage;

  /* ── Fetch with retry logic ── */
  const fetchData = useCallback(async (retryCount = 0) => {
    try {
      setLoading(true);
      setError(null);
      const res = await API.get("/invoices");
      const fetchedData = res?.data?.data || [];
      setInvoices(fetchedData);
      
      console.log(`✅ Loaded ${fetchedData.length} invoices for Invoice Records`);
    } catch (err) {
      console.error("Invoice Records fetch error:", err);
      
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

  /* ── Vendor dropdown options ── */
  const vendorOptions = useMemo(
    () => [...new Set(
      invoices
        .map(i => i.vendor_name)
        .filter(v => v && v.trim() !== "" && v !== "Not Found")
    )].sort(),
    [invoices]
  );

  /* ── FILTERING LOGIC with enhanced date search ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return invoices.filter(inv => {
      let matchSearch = true;
      
      if (q) {
        const textMatch = (
          String(inv.vendor_name || "").toLowerCase().includes(q) ||
          String(inv.vendor_address || "").toLowerCase().includes(q) ||
          String(inv.bill_number || "").toLowerCase().includes(q) ||
          String(inv.vendor_gst || "").toLowerCase().includes(q) ||
          String(inv.vendor_phone || "").toLowerCase().includes(q)
        );

        const dateMatch = dateMatchesSearch(inv.date || "", q);
        
        let partialDateMatch = false;
        if (inv.date) {
          const normalizedInvDate = normalizeDate(inv.date);
          const parts = normalizedInvDate.split('/');
          if (parts.length === 3) {
            const dayMonth = `${parts[0]}/${parts[1]}`;
            if (dayMonth.includes(q) || q.includes(dayMonth)) {
              partialDateMatch = true;
            }
          }
        }

        matchSearch = textMatch || dateMatch || partialDateMatch;
      }

      const matchVendor = !vendorFilter || inv.vendor_name === vendorFilter;

      return matchSearch && matchVendor;
    });
  }, [invoices, search, vendorFilter]);

  /* ── Sort ── */
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortField] ?? "";
      let bv = b[sortField] ?? "";
      
      if (sortField === "total" || sortField === "id") {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      } else if (sortField === "date") {
        const aDate = normalizeDate(av);
        const bDate = normalizeDate(bv);
        av = aDate ? new Date(aDate.split('/').reverse().join('-')).getTime() : 0;
        bv = bDate ? new Date(bDate.split('/').reverse().join('-')).getTime() : 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDir]);

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  /* ── Sort toggle ── */
  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  /* ── Clear all filters ── */
  const clearFilters = () => {
    setSearch("");
    setVendorFilter("");
    setPage(1);
  };

  /* ── Clear only search ── */
  const clearSearch = () => {
    setSearch("");
    setPage(1);
  };

  /* ── Clear only vendor filter ── */
  const clearVendor = () => {
    setVendorFilter("");
    setPage(1);
  };

  /* ── Handle row click to view details ── */
  const handleRowClick = (invoiceId) => {
    navigate(`/invoice/${invoiceId}`);
  };

  /* ── Handle row expand for more details ── */
  const handleRowExpand = (invoiceId, e) => {
    e.stopPropagation();
    setExpandedRow(expandedRow === invoiceId ? null : invoiceId);
  };

  /* ── Items per page change ── */
  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(Number(e.target.value));
    setPage(1);
  };

  /* ── Page change handler ── */
  const handlePageChange = (newPage) => {
    setPage(newPage);
    document.querySelector('.table-container')?.scrollTo({ top: 0, behavior: 'smooth' });
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
    filterBar: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      padding: "16px 20px",
      marginBottom: 24,
      flexWrap: "wrap",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
    },
    searchWrap: {
      position: "relative",
      flex: 2,
      minWidth: 300,
    },
    searchIcon: {
      position: "absolute",
      left: 12,
      top: "50%",
      transform: "translateY(-50%)",
      color: "#94a3b8",
      fontSize: 14,
      pointerEvents: "none",
    },
    searchInput: {
      width: "100%",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      padding: "10px 36px 10px 38px",
      color: "#1e293b",
      fontSize: 14,
      outline: "none",
      boxSizing: "border-box",
      transition: "all 0.2s ease",
    },
    searchClear: {
      position: "absolute",
      right: 10,
      top: "50%",
      transform: "translateY(-50%)",
      background: "transparent",
      border: "none",
      color: "#94a3b8",
      cursor: "pointer",
      fontSize: 16,
      padding: "4px",
      display: "flex",
      alignItems: "center",
      borderRadius: "50%",
    },
    vendorWrap: {
      position: "relative",
      minWidth: 220,
      flex: 1,
    },
    select: {
      width: "100%",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      padding: "10px 36px 10px 12px",
      color: "#1e293b",
      fontSize: 14,
      outline: "none",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      transition: "all 0.2s ease",
    },
    vendorClear: {
      position: "absolute",
      right: 8,
      top: "50%",
      transform: "translateY(-50%)",
      background: "transparent",
      border: "none",
      color: "#94a3b8",
      cursor: "pointer",
      fontSize: 16,
      padding: "4px",
      display: "flex",
      alignItems: "center",
      borderRadius: "50%",
    },
    itemsPerPage: {
      padding: "10px 12px",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 8,
      fontSize: 13,
      color: "#1e293b",
      cursor: "pointer",
    },
    filterTags: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      alignItems: "center",
    },
    filterTag: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 30,
      padding: "4px 12px",
      fontSize: 13,
      color: "#475569",
    },
    tagClose: {
      background: "transparent",
      border: "none",
      color: "#94a3b8",
      cursor: "pointer",
      fontSize: 14,
      padding: "2px",
      lineHeight: 1,
      borderRadius: "50%",
      width: 18,
      height: 18,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    clearAllBtn: {
      background: "transparent",
      border: "1px solid #e2e8f0",
      borderRadius: 8,
      padding: "8px 16px",
      color: "#64748b",
      fontSize: 13,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.2s ease",
    },
    resultCount: {
      fontSize: 13,
      color: "#64748b",
      whiteSpace: "nowrap",
      background: "#f8fafc",
      padding: "6px 12px",
      borderRadius: 30,
      border: "1px solid #e2e8f0",
    },
    tableCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
      flex: 1,
      display: "flex",
      flexDirection: "column",
      height: "calc(100vh - 280px)",
    },
    tableTopBar: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 20px",
      borderBottom: "1px solid #e2e8f0",
    },
    tableCardTitle: {
      fontSize: 16,
      fontWeight: 600,
      color: "#0f172a",
    },
    showingBadge: {
      fontSize: 12,
      color: "#64748b",
      background: "#f8fafc",
      padding: "4px 14px",
      borderRadius: 30,
      border: "1px solid #e2e8f0",
    },
    tableContainer: {
      overflowX: "auto",
      overflowY: "auto",
      flex: 1,
      position: "relative",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 13,
      minWidth: 1200,
    },
    th: {
      padding: "12px 16px",
      textAlign: "left",
      fontSize: 11,
      fontWeight: 600,
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: "0.3px",
      background: "#f8fafc",
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
      borderBottom: "1px solid #e2e8f0",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },
    td: {
      padding: "14px 16px",
      borderBottom: "1px solid #f1f5f9",
      verticalAlign: "middle",
      maxWidth: 200,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: "#475569",
      cursor: "pointer",
    },
    expandedRow: {
      background: "#f8fafc",
      borderBottom: "1px solid #e2e8f0",
    },
    expandedContent: {
      padding: "20px",
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "16px",
    },
    detailCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "10px",
      padding: "12px",
    },
    detailLabel: {
      fontSize: "11px",
      fontWeight: "600",
      color: "#64748b",
      textTransform: "uppercase",
      marginBottom: "4px",
    },
    detailValue: {
      fontSize: "13px",
      color: "#0f172a",
      wordBreak: "break-word",
    },
    pagination: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "14px 20px",
      borderTop: "1px solid #e2e8f0",
      background: "#ffffff",
    },
    pageInfo: {
      fontSize: 13,
      color: "#64748b",
    },
    pageButtonsContainer: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
    },
    empty: {
      textAlign: "center",
      padding: "60px 20px",
      color: "#64748b",
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
  };

  const COLUMNS = [
    { label: "#", field: "id", width: 60 },
    { label: "Bill No.", field: "bill_number", width: 130 },
    { label: "Vendor Name", field: "vendor_name", width: 180 },
    { label: "Vendor Address", field: "vendor_address", width: 250 },
    { label: "Phone", field: "vendor_phone", width: 140 },
    { label: "GST Number", field: "vendor_gst", width: 170 },
    { label: "Invoice Date", field: "date", width: 120 },
    { label: "Total (₹)", field: "total", width: 120 },
    { label: "GST Status", field: null, width: 120 },
  ];

  const hasFilters = search.trim() !== "" || vendorFilter !== "";

  if (loading && invoices.length === 0) {
    return (
      <div style={S.loadWrap}>
        <div style={{ fontSize: 32, color: "#4f46e5", animation: "spin 1s linear infinite" }}>⟳</div>
        <p style={{ color: "#64748b" }}>Loading invoice records...</p>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const startRow = sorted.length === 0 ? 0 : (safePage - 1) * PER_PAGE + 1;
  const endRow = Math.min(safePage * PER_PAGE, sorted.length);

  return (
    <div style={S.root}>
      <h1 style={S.pageTitle}>Invoice Records</h1>
      <p style={S.pageSub}>
        {invoices.length} total invoice{invoices.length !== 1 ? "s" : ""} in database ·
        View, search, and manage all your invoices
      </p>

      {error && <div style={S.errorBox}>⚠ {error}</div>}

      <div style={S.filterBar}>
        <div style={S.searchWrap}>
          <span style={S.searchIcon}>🔍</span>
          <input
            style={S.searchInput}
            placeholder="Search vendor, address, bill no., GST, date (DD/MM/YY)..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button style={S.searchClear} onClick={clearSearch}>✕</button>
          )}
        </div>

        <div style={S.vendorWrap}>
          <select style={S.select} value={vendorFilter} onChange={e => { setVendorFilter(e.target.value); setPage(1); }}>
            <option value="">All Vendors</option>
            {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {vendorFilter && <button style={S.vendorClear} onClick={clearVendor}>✕</button>}
        </div>

        <select style={S.itemsPerPage} value={itemsPerPage} onChange={handleItemsPerPageChange}>
          <option value={10}>10 per page</option>
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
          <option value={100}>100 per page</option>
        </select>

        {hasFilters && (
          <div style={S.filterTags}>
            {search.trim() && (
              <span style={S.filterTag}>
                🔍 "{search.trim()}" <button style={S.tagClose} onClick={clearSearch}>✕</button>
              </span>
            )}
            {vendorFilter && (
              <span style={S.filterTag}>
                🏪 {vendorFilter} <button style={S.tagClose} onClick={clearVendor}>✕</button>
              </span>
            )}
            <button style={S.clearAllBtn} onClick={clearFilters}>Clear All</button>
          </div>
        )}

        <span style={S.resultCount}>
          {hasFilters ? `${filtered.length} of ${invoices.length} records` : `${invoices.length} records`}
        </span>
      </div>

      <div style={S.tableCard}>
        <div style={S.tableTopBar}>
          <span style={S.tableCardTitle}>All Invoice Records</span>
          {sorted.length > 0 && (
            <span style={S.showingBadge}>Showing {startRow}–{endRow} of {sorted.length} records</span>
          )}
        </div>

        {paginated.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 40, marginBottom: 16, color: "#cbd5e1" }}>📭</div>
            <p style={{ fontSize: 15, color: "#475569", margin: "0 0 8px", fontWeight: 500 }}>No invoices found</p>
            {hasFilters ? (
              <div>
                <p style={{ fontSize: 13, marginBottom: 16, color: "#64748b" }}>Your current filters returned no results</p>
                <button style={{ background: "#4f46e5", border: "none", borderRadius: 8, padding: "10px 20px", color: "white", fontSize: 13, cursor: "pointer", fontWeight: 500 }} onClick={clearFilters}>Clear All Filters</button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#64748b" }}>Upload your first invoice to get started</p>
            )}
          </div>
        ) : (
          <div className="table-container" style={S.tableContainer}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, width: 30 }}>👁️</th>
                  {COLUMNS.map((col, ci) => (
                    <th key={ci} style={{ ...S.th, width: col.width }} onClick={() => col.field && handleSort(col.field)}>
                      {col.label} {col.field && <SortIcon active={sortField === col.field} dir={sortDir} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv, ri) => {
                  const total = Number(inv.total) || 0;
                  const rowBg = ri % 2 === 0 ? "#fafafa" : "#ffffff";
                  const isExpanded = expandedRow === inv.id;
                  
                  return (
                    <React.Fragment key={inv.id ?? ri}>
                      <tr style={{ background: rowBg, cursor: "pointer", borderBottom: isExpanded ? "none" : "1px solid #f1f5f9" }} onClick={() => handleRowClick(inv.id)}>
                        <td style={{ ...S.td, width: 30, textAlign: "center" }}>
                          <button onClick={(e) => handleRowExpand(inv.id, e)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#4f46e5" }}>
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>
                        <td style={{ ...S.td, width: 60, color: "#94a3b8" }}>{inv.id}</td>
                        <td style={{ ...S.td, width: 130 }}><Cell value={inv.bill_number} bold tooltip={`Bill Number: ${inv.bill_number}`} /></td>
                        <td style={{ ...S.td, width: 180 }}><Cell value={inv.vendor_name} bold tooltip={`Vendor: ${inv.vendor_name}`} /></td>
                        <td style={{ ...S.td, width: 250 }}><Cell value={inv.vendor_address} tooltip={inv.vendor_address} /></td>
                        <td style={{ ...S.td, width: 140 }}><Cell value={inv.vendor_phone} tooltip={`Phone: ${inv.vendor_phone}`} /></td>
                        <td style={{ ...S.td, width: 170 }}><Cell value={inv.vendor_gst} mono tooltip={`GST: ${inv.vendor_gst}`} /></td>
                        <td style={{ ...S.td, width: 120 }}><Cell value={formatDisplayDate(inv.date)} tooltip={`Date: ${inv.date}`} /></td>
                        <td style={{ ...S.td, width: 120 }}>
                          {total > 0 ? (
                            <div>
                              <span style={{ color: "#059669", fontWeight: 600, fontFamily: "monospace", fontSize: 13 }}>₹ {total.toLocaleString("en-IN")}</span>
                              <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>{total > 1000 ? "High value" : "Normal"}</span>
                            </div>
                          ) : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>—</span>}
                        </td>
                        <td style={{ ...S.td, width: 120 }}><GSTBadge value={inv.vendor_gst} confidence={inv.gst_confidence} /></td>
                      </tr>
                      {isExpanded && (
                        <tr style={S.expandedRow}>
                          <td colSpan="10" style={{ padding: 0 }}>
                            <div style={S.expandedContent}>
                              <div style={S.detailCard}>
                                <div style={S.detailLabel}>Vendor Details</div>
                                <div style={S.detailValue}>{inv.vendor_name || "N/A"}</div>
                                <div style={S.detailValue}>{inv.vendor_address || "N/A"}</div>
                                <div style={S.detailValue}>Phone: {inv.vendor_phone || "N/A"}</div>
                              </div>
                              <div style={S.detailCard}>
                                <div style={S.detailLabel}>Invoice Details</div>
                                <div style={S.detailValue}>Bill No: {inv.bill_number || "N/A"}</div>
                                <div style={S.detailValue}>Date: {formatDisplayDate(inv.date)}</div>
                                <div style={S.detailValue}>Total: ₹ {total.toLocaleString("en-IN")}</div>
                              </div>
                              <div style={S.detailCard}>
                                <div style={S.detailLabel}>Tax Information</div>
                                <div style={S.detailValue}>GST: {inv.vendor_gst || "N/A"}</div>
                                {inv.items_count && <div style={S.detailValue}>Items: {inv.items_count}</div>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={S.pagination}>
            <span style={S.pageInfo}>Showing {startRow}–{endRow} of {sorted.length} records</span>
            <div style={S.pageButtonsContainer}>
              <PageButtons currentPage={safePage} totalPages={totalPages} onPageChange={handlePageChange} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}