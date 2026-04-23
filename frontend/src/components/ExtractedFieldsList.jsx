// components/ExtractedFieldsList.jsx

import React, { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// INDIA-SPECIFIC FIELD CLEANING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean GST Number - Remove W.E.F., date suffixes, and extract only 15-character GSTIN
 */
const cleanGSTNumber = (text) => {
  if (!text || text === "—") return text;
  
  let cleaned = String(text);
  
  // Remove W.E.F., WEF, effective from and date patterns
  cleaned = cleaned.replace(/W\.?\s*E\.?\s*F\.?\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/WEF\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/effective\s*from\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/w\.e\.f\.\s*/gi, '');
  
  // Remove extra spaces and special characters
  cleaned = cleaned.replace(/[-\s]/g, '');
  
  // Extract 15-character GST pattern
  const gstMatch = cleaned.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}/i);
  if (gstMatch) {
    return gstMatch[0].toUpperCase();
  }
  
  // Fallback: extract any 15-character alphanumeric string
  const anyMatch = cleaned.match(/[A-Z0-9]{15}/i);
  if (anyMatch) {
    return anyMatch[0].toUpperCase();
  }
  
  // If nothing found, return first 15 chars of cleaned text
  return cleaned.substring(0, 15);
};

/**
 * Format Address - Add proper line breaks and structure for display
 */
const formatAddressForDisplay = (address) => {
  if (!address || address === "—") return address;
  
  let formatted = String(address);
  
  // Add line breaks after common address patterns
  formatted = formatted.replace(/(PLOT\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/(SHOP\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/(FLAT\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/([A-Z]{2,}\s+\d{6})/, '\n$1'); // PIN code on new line
  formatted = formatted.replace(/(\d{6})/, '\n$1'); // PIN code alone
  formatted = formatted.replace(/(GHATKOPAR|INDIRAPURAM|GHAZIABAD|MUMBAI|DELHI|BANGALORE|CHENNAI|KOLKATA|PUNE|HYDERABAD|NOIDA|GURGAON)/gi, '\n$1');
  
  // Remove duplicate line breaks
  formatted = formatted.replace(/\n+/g, '\n');
  
  return formatted.trim();
};

/**
 * Clean Phone Number - Filter out helpline numbers
 */
const cleanPhoneNumber = (phone) => {
  if (!phone || phone === "—") return phone;
  
  const phoneStr = String(phone);
  
  // Check if this is a helpline number (should show as not detected)
  const isHelpline = /helpline|toll\s*free|customer\s*care|support|1800|1860|tollfree/i.test(phoneStr);
  
  if (isHelpline) {
    return "Not detected (helpline ignored)";
  }
  
  // Extract phone number pattern
  const phoneMatch = phoneStr.match(/[0-9\-\(\)\s+]{8,15}/);
  if (phoneMatch) {
    return phoneMatch[0].trim();
  }
  
  return phoneStr;
};

/**
 * Get field color mapping
 */
const getFieldColor = (fieldName) => {
  const colors = {
    "Bill Number": "#6366f1",
    "Vendor Name": "#0ea5e9",
    "Vendor Address": "#10b981",
    "Vendor Phone Number": "#f59e0b",
    "Vendor GST Number": "#ec4899",
    "Invoice Date": "#8b5cf6",
    "Total Amount": "#ef4444",
  };
  return colors[fieldName] || "#94a3b8";
};

const ExtractedFieldsList = ({
  extractedData,
  activeField,
  onFieldClick,
  validationErrors = {},
  isSaved = false,
  showConfidence = true,
  showValidation = true,
  maxHeight = "100%",
}) => {
  const [expandedField, setExpandedField] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredFields, setFilteredFields] = useState([]);
  const [sortBy, setSortBy] = useState("priority"); // priority, confidence, name
  const fieldRefs = useRef({});

  /* =====================================================
     Priority order for fields
  ===================================================== */
  const priorityOrder = [
    "Vendor Name",
    "Bill Number",
    "Invoice Date",
    "Total Amount",
    "Vendor GST Number",
    "Vendor Phone Number",
    "Vendor Address"
  ];

  /* =====================================================
     Process and filter fields with India-specific cleaning
  ===================================================== */
  useEffect(() => {
    if (!extractedData) {
      setFilteredFields([]);
      return;
    }

    let fields = Object.entries(extractedData).map(([key, value]) => {
      let displayValue = value?.value || "—";
      let cleanedValue = displayValue;
      
      // Apply India-specific cleaning based on field type
      if (key === "Vendor GST Number" || key === "gst" || key === "vendor_gst") {
        cleanedValue = cleanGSTNumber(displayValue);
      } else if (key === "Vendor Address" || key === "address" || key === "vendor_address") {
        cleanedValue = formatAddressForDisplay(displayValue);
      } else if (key === "Vendor Phone Number" || key === "phone" || key === "vendor_phone") {
        cleanedValue = cleanPhoneNumber(displayValue);
      }
      
      return {
        name: key,
        displayName: key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        value: cleanedValue,
        originalValue: displayValue,
        confidence: value?.confidence || 0,
        edited: value?.edited || false,
        validationRules: value?.validationRules || null,
        color: getFieldColor(key),
      };
    });

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      fields = fields.filter(field => 
        field.displayName.toLowerCase().includes(term) ||
        field.value.toLowerCase().includes(term)
      );
    }

    // Apply sorting
    switch (sortBy) {
      case "priority":
        fields.sort((a, b) => {
          const aIndex = priorityOrder.indexOf(a.displayName);
          const bIndex = priorityOrder.indexOf(b.displayName);
          if (aIndex === -1 && bIndex === -1) return a.displayName.localeCompare(b.displayName);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
        break;
      case "confidence":
        fields.sort((a, b) => b.confidence - a.confidence);
        break;
      case "name":
        fields.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
      default:
        break;
    }

    setFilteredFields(fields);
  }, [extractedData, searchTerm, sortBy]);

  /* =====================================================
     Scroll to active field when it changes
  ===================================================== */
  useEffect(() => {
    if (activeField && fieldRefs.current[activeField]) {
      fieldRefs.current[activeField].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeField]);

  /* =====================================================
     Handle field click
  ===================================================== */
  const handleFieldClick = (fieldName) => {
    if (onFieldClick && !isSaved) {
      onFieldClick(fieldName);
    }
    setExpandedField(expandedField === fieldName ? null : fieldName);
  };

  /* =====================================================
     Get confidence color
  ===================================================== */
  const getConfidenceColor = (confidence) => {
    const confNum = confidence > 1 ? confidence / 100 : confidence;
    if (confNum >= 0.9) return "#10b981"; // Green
    if (confNum >= 0.7) return "#f59e0b"; // Amber
    if (confNum >= 0.5) return "#f97316"; // Orange
    return "#ef4444"; // Red
  };

  /* =====================================================
     Get confidence icon
  ===================================================== */
  const getConfidenceIcon = (confidence) => {
    const confNum = confidence > 1 ? confidence / 100 : confidence;
    if (confNum >= 0.9) return "🟢";
    if (confNum >= 0.7) return "🟡";
    if (confNum >= 0.5) return "🟠";
    return "🔴";
  };

  /* =====================================================
     Styles
  ===================================================== */
  const styles = {
    container: {
      height: maxHeight,
      display: "flex",
      flexDirection: "column",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "16px",
      overflow: "hidden",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.02)",
    },
    header: {
      padding: "16px 20px",
      borderBottom: "1px solid #e2e8f0",
      background: "#f8fafc",
    },
    headerTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "12px",
    },
    title: {
      fontSize: "16px",
      fontWeight: 600,
      color: "#0f172a",
    },
    badge: {
      background: "#e2e8f0",
      color: "#475569",
      padding: "4px 10px",
      borderRadius: "20px",
      fontSize: "12px",
      fontWeight: 500,
    },
    searchBar: {
      display: "flex",
      gap: "8px",
      marginBottom: "12px",
    },
    searchInput: {
      flex: 1,
      padding: "8px 12px",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      fontSize: "13px",
      outline: "none",
      transition: "all 0.2s ease",
      background: "#ffffff",
    },
    sortSelect: {
      padding: "8px 12px",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      fontSize: "13px",
      outline: "none",
      background: "#ffffff",
      cursor: "pointer",
      color: "#475569",
    },
    statsRow: {
      display: "flex",
      gap: "16px",
      fontSize: "12px",
      color: "#64748b",
      flexWrap: "wrap",
    },
    statItem: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
    },
    list: {
      flex: 1,
      overflowY: "auto",
      padding: "16px",
      scrollbarWidth: "thin",
      scrollbarColor: "#4f46e5 #f1f5f9",
    },
    fieldItem: (isActive, isExpanded, hasError, color) => ({
      marginBottom: "12px",
      padding: "12px",
      background: isActive ? `${color}08` : "#ffffff",
      border: `1px solid ${
        hasError ? "#ef4444" : 
        isActive ? color : 
        isExpanded ? "#4f46e5" : 
        "#e2e8f0"
      }`,
      borderRadius: "10px",
      cursor: "pointer",
      transition: "all 0.2s ease",
      position: "relative",
      boxShadow: isActive ? `0 4px 12px ${color}20` : "none",
    }),
    fieldHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "8px",
    },
    fieldName: {
      fontSize: "13px",
      fontWeight: 600,
      color: "#0f172a",
      textTransform: "uppercase",
      letterSpacing: "0.3px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
    },
    editedBadge: {
      fontSize: "10px",
      color: "#4f46e5",
      background: "rgba(79, 70, 229, 0.1)",
      padding: "2px 6px",
      borderRadius: "12px",
    },
    confidenceBadge: (confidence) => ({
      fontSize: "11px",
      fontWeight: 600,
      color: getConfidenceColor(confidence),
      background: `${getConfidenceColor(confidence)}10`,
      padding: "4px 8px",
      borderRadius: "20px",
      display: "flex",
      alignItems: "center",
      gap: "4px",
    }),
    fieldValue: {
      fontSize: "14px",
      fontWeight: 500,
      color: "#1e293b",
      marginBottom: "8px",
      wordBreak: "break-word",
      whiteSpace: "pre-wrap", // Preserve line breaks for addresses
    },
    fieldMeta: {
      display: "flex",
      gap: "12px",
      fontSize: "11px",
      color: "#64748b",
      marginTop: "4px",
    },
    confidenceBar: {
      flex: 1,
      height: "4px",
      background: "#f1f5f9",
      borderRadius: "2px",
      overflow: "hidden",
      marginTop: "8px",
    },
    confidenceFill: (color, width) => ({
      width: `${width}%`,
      height: "100%",
      background: color,
      borderRadius: "2px",
      transition: "width 0.3s ease",
    }),
    validationError: {
      marginTop: "8px",
      padding: "6px 10px",
      background: "#fef2f2",
      border: "1px solid #fee2e2",
      borderRadius: "6px",
      fontSize: "11px",
      color: "#b91c1c",
    },
    expandedContent: {
      marginTop: "12px",
      padding: "12px",
      background: "#f8fafc",
      borderRadius: "8px",
      border: "1px solid #e2e8f0",
    },
    expandedRow: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: "8px",
      fontSize: "12px",
    },
    expandedLabel: {
      color: "#64748b",
      fontWeight: 500,
    },
    expandedValue: {
      color: "#0f172a",
      fontWeight: 600,
      wordBreak: "break-word",
      whiteSpace: "pre-wrap",
    },
    emptyState: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
      color: "#94a3b8",
      textAlign: "center",
    },
    emptyIcon: {
      fontSize: "48px",
      marginBottom: "16px",
      color: "#cbd5e1",
    },
    loadingSpinner: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px",
      color: "#4f46e5",
      fontSize: "24px",
      animation: "spin 1s linear infinite",
    },
  };

  /* =====================================================
     Add scrollbar styles
  ===================================================== */
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .fields-list::-webkit-scrollbar {
        width: 6px;
      }
      .fields-list::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 8px;
      }
      .fields-list::-webkit-scrollbar-thumb {
        background: #4f46e5;
        border-radius: 8px;
      }
      .fields-list::-webkit-scrollbar-thumb:hover {
        background: #6366f1;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  /* =====================================================
     Calculate stats
  ===================================================== */
  const getStats = () => {
    if (!filteredFields.length) return null;

    const totalFields = filteredFields.length;
    const avgConfidence = filteredFields.reduce((acc, field) => {
      const conf = field.confidence > 1 ? field.confidence / 100 : field.confidence;
      return acc + conf;
    }, 0) / totalFields * 100;
    
    const highConfidence = filteredFields.filter(f => {
      const conf = f.confidence > 1 ? f.confidence / 100 : f.confidence;
      return conf > 0.85;
    }).length;
    
    const editedCount = filteredFields.filter(f => f.edited).length;
    const validCount = filteredFields.filter(f => !validationErrors[f.name]).length;

    return {
      totalFields,
      avgConfidence: avgConfidence.toFixed(1),
      highConfidence,
      editedCount,
      validCount,
    };
  };

  const stats = getStats();

  /* =====================================================
     Render
  ===================================================== */
  if (!extractedData) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📋</div>
          <h3 style={{ fontSize: "16px", color: "#475569", marginBottom: "4px" }}>
            No Fields Extracted
          </h3>
          <p style={{ fontSize: "13px", color: "#94a3b8" }}>
            Upload an invoice to see extracted fields
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <span style={styles.title}>Extracted Fields</span>
          <span style={styles.badge}>{filteredFields.length} fields</span>
        </div>

        {/* Search and Sort */}
        <div style={styles.searchBar}>
          <input
            type="text"
            placeholder="Search fields..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
            onFocus={(e) => e.target.style.borderColor = "#4f46e5"}
            onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.sortSelect}
          >
            <option value="priority">Sort by Priority</option>
            <option value="confidence">Sort by Confidence</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>

        {/* Stats */}
        {stats && (
          <div style={styles.statsRow}>
            <span style={styles.statItem}>📊 <strong>{stats.totalFields}</strong> fields</span>
            <span style={styles.statItem}>🎯 <strong>{stats.avgConfidence}%</strong> avg</span>
            <span style={styles.statItem}>✅ <strong>{stats.highConfidence}</strong> high</span>
            <span style={styles.statItem}>✏️ <strong>{stats.editedCount}</strong> edited</span>
            <span style={styles.statItem}>✓ <strong>{stats.validCount}/{stats.totalFields}</strong> valid</span>
          </div>
        )}
      </div>

      {/* Fields List */}
      <div className="fields-list" style={styles.list}>
        {filteredFields.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🔍</div>
            <h3 style={{ fontSize: "16px", color: "#475569", marginBottom: "4px" }}>
              No Fields Found
            </h3>
            <p style={{ fontSize: "13px", color: "#94a3b8" }}>
              Try adjusting your search
            </p>
          </div>
        ) : (
          filteredFields.map((field) => {
            const isActive = activeField === field.name;
            const isExpanded = expandedField === field.name;
            const hasError = validationErrors[field.name];
            const confidenceNum = field.confidence > 1 ? field.confidence / 100 : field.confidence;
            const confidencePercent = (confidenceNum * 100).toFixed(1);

            return (
              <div
                key={field.name}
                ref={el => fieldRefs.current[field.name] = el}
                style={styles.fieldItem(isActive, isExpanded, hasError, field.color)}
                onClick={() => handleFieldClick(field.name)}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = "translateX(4px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateX(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {/* Header */}
                <div style={styles.fieldHeader}>
                  <div style={styles.fieldName}>
                    {field.displayName}
                    {field.edited && <span style={styles.editedBadge}>Edited</span>}
                  </div>
                  {showConfidence && field.confidence > 0 && (
                    <span style={styles.confidenceBadge(confidenceNum)}>
                      {getConfidenceIcon(confidenceNum)} {confidencePercent}%
                    </span>
                  )}
                </div>

                {/* Value - with proper line breaks for address */}
                <div style={styles.fieldValue}>
                  {typeof field.value === 'string' && field.value.includes('\n') 
                    ? field.value.split('\n').map((line, i) => (
                        <React.Fragment key={i}>
                          {line}
                          <br />
                        </React.Fragment>
                      ))
                    : field.value
                  }
                </div>

                {/* Confidence Bar */}
                {showConfidence && field.confidence > 0 && (
                  <div style={styles.confidenceBar}>
                    <div style={styles.confidenceFill(
                      getConfidenceColor(confidenceNum),
                      confidencePercent
                    )} />
                  </div>
                )}

                {/* Meta Info - Show original if different from cleaned */}
                {field.originalValue !== field.value && field.originalValue !== "—" && field.originalValue !== field.value && (
                  <div style={styles.fieldMeta}>
                    <span>📄 Original: {field.originalValue}</span>
                  </div>
                )}

                {/* Validation Error */}
                {hasError && showValidation && (
                  <div style={styles.validationError}>
                    ⚠️ {validationErrors[field.name]}
                  </div>
                )}

                {/* Expanded Content */}
                {isExpanded && (
                  <div style={styles.expandedContent}>
                    <div style={styles.expandedRow}>
                      <span style={styles.expandedLabel}>Field Name:</span>
                      <span style={styles.expandedValue}>{field.displayName}</span>
                    </div>
                    <div style={styles.expandedRow}>
                      <span style={styles.expandedLabel}>Current Value:</span>
                      <span style={styles.expandedValue}>
                        {typeof field.value === 'string' && field.value.includes('\n')
                          ? field.value.split('\n').map((line, i) => (
                              <React.Fragment key={i}>
                                {line}
                                <br />
                              </React.Fragment>
                            ))
                          : field.value
                        }
                      </span>
                    </div>
                    {field.originalValue !== field.value && field.originalValue !== "—" && (
                      <div style={styles.expandedRow}>
                        <span style={styles.expandedLabel}>Original Value:</span>
                        <span style={styles.expandedValue}>{field.originalValue}</span>
                      </div>
                    )}
                    {field.confidence > 0 && (
                      <div style={styles.expandedRow}>
                        <span style={styles.expandedLabel}>Confidence:</span>
                        <span style={{ 
                          ...styles.expandedValue,
                          color: getConfidenceColor(confidenceNum)
                        }}>
                          {confidencePercent}% {getConfidenceIcon(confidenceNum)}
                        </span>
                      </div>
                    )}
                    {field.edited && (
                      <div style={styles.expandedRow}>
                        <span style={styles.expandedLabel}>Status:</span>
                        <span style={{ ...styles.expandedValue, color: "#4f46e5" }}>
                          ✎ Edited
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Active Indicator */}
                {isActive && (
                  <div style={{
                    position: "absolute",
                    left: "-4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "4px",
                    height: "70%",
                    background: field.color,
                    borderRadius: "0 4px 4px 0",
                    boxShadow: `0 0 8px ${field.color}`,
                  }} />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer with instructions */}
      {filteredFields.length > 0 && (
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid #e2e8f0",
          background: "#f8fafc",
          fontSize: "11px",
          color: "#64748b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>👆 Click field to expand</span>
          <span>🔍 Hover over image to highlight</span>
        </div>
      )}
    </div>
  );
};

export default ExtractedFieldsList;