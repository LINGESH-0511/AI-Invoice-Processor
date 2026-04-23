import { useState, useContext, useEffect, useRef, useCallback } from "react";
import API from "../services/api";
import { InvoiceContext } from "../context/InvoiceContext";
import InvoicePreviewWithHighlights from "../components/InvoicePreviewWithHighlights";
import * as XLSX from "xlsx";

export default function Upload() {
  const {
    processedInvoice,
    setProcessedInvoice,
    previewUrl,
    setPreviewUrl,
    invoiceImage: contextInvoiceImage,
    setInvoiceImage: setContextInvoiceImage,
    uploadedFile: contextUploadedFile,
    setUploadedFile: setContextUploadedFile,
    hasActiveSession,
    isValidSession,
    resetInvoice,
  } = useContext(InvoiceContext);
  const { textractResponse, setTextractResponse, activeField, setActiveField, clearActiveField } = useContext(InvoiceContext);

  const [file, setFile] = useState(null);
  const [editableData, setEditableData] = useState(null);
  const [invoiceImage, setInvoiceImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [expandedField, setExpandedField] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotateAngle, setRotateAngle] = useState(0);
  const [fieldHistory, setFieldHistory] = useState({});
  const [selectedFields, setSelectedFields] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [showAllFields, setShowAllFields] = useState(false);
  const [hasValidUpload, setHasValidUpload] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const previewContainerRef = useRef(null);
  const fieldRefs = useRef({});

  /* =====================================================
     CHECK FOR VALID SESSION ON MOUNT
  ===================================================== */
  useEffect(() => {
    const sessionValid = isValidSession ? isValidSession() : false;
    
    if (sessionValid && processedInvoice && contextUploadedFile) {
      setEditableData(processedInvoice);
      setHasValidUpload(true);
      setIsSaved(false);
      if (contextInvoiceImage) {
        setInvoiceImage(contextInvoiceImage);
      }
    } else {
      setEditableData(null);
      setInvoiceImage(null);
      setHasValidUpload(false);
      setFile(null);
      setIsSaved(false);
    }
  }, [processedInvoice, contextInvoiceImage, contextUploadedFile, isValidSession]);

  /* =====================================================
     CLEAN PREVIEW URL (MEMORY SAFE)
  ===================================================== */
  useEffect(() => {
    return () => {
      if (previewUrl && !contextInvoiceImage) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl, contextInvoiceImage]);

  /* =====================================================
     UPLOAD & PROCESS - NO AUTO-SAVE
  ===================================================== */
  const handleUpload = async () => {
    if (!file) {
      alert("Please select a file");
      return;
    }

    try {
      setLoading(true);
      setImageError(false);
      setValidationErrors({});
      setShowAllFields(false);
      setIsSaved(false);

      const formData = new FormData();
      formData.append("file", file);

      // Use the API helper which uses the shared axios instance timeout
      const res = await API.postFormData("/process-invoice", formData, null);

      if (res?.data?.status !== "success") {
        throw new Error("Processing failed");
      }

      const extracted = res?.data?.data || {};
      
      const processedData = {};
      Object.entries(extracted).forEach(([key, value]) => {
        const confidence = value?.confidence || 0;
        processedData[key] = {
          value: value?.value || value || "",
          confidence: confidence,
          originalValue: value?.value || value || "",
          edited: false,
          validationRules: getValidationRules(key),
        };
      });

      const fileInfo = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      };
      setContextUploadedFile(fileInfo);
      
      setProcessedInvoice(processedData);
      setEditableData(processedData);
      setHasValidUpload(true);
      
      const imageUrl = res?.data?.invoice_image || null;
      setInvoiceImage(imageUrl);
      setContextInvoiceImage(imageUrl);
      // Try to capture full Textract response if backend returned it under any common key
      const maybeTextract = res?.data?.textract_response || res?.data?.textract || res?.data?.raw_textract || res?.data?.metadata?.textract || null;
      if (maybeTextract) {
        try {
          // Merge any explicit field_bounding_boxes returned at top-level into the stored textractResponse
          const merged = {
            ...(maybeTextract || {}),
            field_bounding_boxes: res?.data?.field_bounding_boxes || (maybeTextract.field_bounding_boxes || {})
          };
          console.debug("Upload.jsx: received textract response:", merged);
          setTextractResponse(merged);
        } catch (err) {
          console.warn("Could not set textract response in context:", err);
        }
      } else {
        // Clear previous textract if none returned
        setTextractResponse(null);
      }
      
      setZoomLevel(1);
      setRotateAngle(0);

    } catch (err) {
      console.error("Upload Error:", err);
      alert(err?.friendlyMessage || "Error processing invoice. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* =====================================================
     GET VALIDATION RULES FOR FIELD
  ===================================================== */
  const getValidationRules = (fieldName) => {
    const rules = {
      vendor_gst: { pattern: /^[0-9A-Z]{15}$/, message: "GST should be 15 characters" },
      vendor_phone: { pattern: /^[0-9+\-\s]{10,}$/, message: "Invalid phone number" },
      date: { pattern: /^\d{2}\/\d{2}\/\d{2,4}$/, message: "Use DD/MM/YY format" },
      total: { pattern: /^\d+(\.\d{1,2})?$/, message: "Enter valid amount" },
    };
    return rules[fieldName] || null;
  };

  /* =====================================================
     VALIDATE FIELD
  ===================================================== */
  const validateField = (key, value) => {
    const rule = getValidationRules(key);
    if (!rule) return true;
    
    const isValid = rule.pattern.test(String(value).trim());
    setValidationErrors(prev => ({
      ...prev,
      [key]: isValid ? null : rule.message
    }));
    return isValid;
  };

  /* =====================================================
     EDIT FIELD
  ===================================================== */
  const handleChange = (key, newValue) => {
    if (!editableData) return;

    validateField(key, newValue);

    const oldValue = editableData[key]?.value;
    setFieldHistory(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), { value: oldValue, timestamp: new Date() }]
    }));

    const updated = {
      ...editableData,
      [key]: {
        ...editableData[key],
        value: newValue,
        edited: true,
        lastEdited: new Date().toISOString(),
      },
    };

    setEditableData(updated);
    setProcessedInvoice(updated);
  };

  /* =====================================================
     REVERT FIELD TO ORIGINAL
  ===================================================== */
  const revertField = (key) => {
    if (!editableData) return;
    
    const updated = {
      ...editableData,
      [key]: {
        ...editableData[key],
        value: editableData[key]?.originalValue || "",
        edited: false,
      },
    };
    
    setEditableData(updated);
    setProcessedInvoice(updated);
    setValidationErrors(prev => ({ ...prev, [key]: null }));
  };

  /* =====================================================
     SAVE TO DATABASE - FIXED FOR BACKEND
  ===================================================== */
  const handleSave = async () => {
    try {
      const hasErrors = Object.values(validationErrors).some(error => error !== null);
      if (hasErrors) {
        alert("Please fix validation errors before saving");
        return;
      }

      if (!editableData) {
        alert("No data to save");
        return;
      }

      setSaving(true);
      
      // Format data for backend - MATCHING BACKEND EXPECTATIONS
      const saveData = {
        data: editableData,  // Send the full editableData object
        invoice_image: invoiceImage || previewUrl || ""  // Add image URL
      };

      console.log("Saving data:", saveData); // Debug log

      // Call the correct endpoint
      const response = await API.post("/invoices", saveData);
      
      if (response?.data?.status === "success") {
        setIsSaved(true);
        window.dispatchEvent(new Event("invoice-updated"));
        alert("Invoice confirmed and saved successfully!");
      } else {
        throw new Error("Save failed");
      }
      
    } catch (err) {
      console.error("Save error:", err);
      console.error("Error details:", err.response?.data); // Log server response
      alert("Error saving invoice. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* =====================================================
     EXCEL DOWNLOAD WITH ENHANCED DATA
  ===================================================== */
  const handleDownloadExcel = () => {
    if (!editableData) return;

    const rows = Object.entries(editableData).map(([key, value]) => {
      let confidence = Number(value?.confidence || 0);
      if (confidence <= 1) confidence *= 100;

      return {
        "Field Name": key.replace(/_/g, " ").toUpperCase(),
        "Extracted Value": value?.originalValue || "",
        "Edited Value": value?.value || "",
        "Confidence (%)": Number(confidence.toFixed(2)),
        "Status": value?.edited ? "Edited" : "Original",
        "Validation": validationErrors[key] ? "❌ Invalid" : "✅ Valid",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    
    worksheet["!cols"] = [
      { wch: 30 },
      { wch: 40 },
      { wch: 40 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Data");
    
    const fileName = `Invoice_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  /* =====================================================
     CONFIDENCE COLOR
  ===================================================== */
  const getConfidenceColor = (c) => {
    if (c > 0.85) return "#10b981";
    if (c > 0.6) return "#f59e0b";
    return "#ef4444";
  };

  /* =====================================================
     RESET FORM
  ===================================================== */
  const handleReset = () => {
    setFile(null);
    setEditableData(null);
    setInvoiceImage(null);
    setContextInvoiceImage(null);
    setContextUploadedFile(null);
    setImageError(false);
    setExpandedField(null);
    setZoomLevel(1);
    setRotateAngle(0);
    setValidationErrors({});
    setFieldHistory({});
    setSelectedFields([]);
    setShowAllFields(false);
    setHasValidUpload(false);
    setIsSaved(false);
    
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    
    if (resetInvoice) {
      resetInvoice();
    }
  };

  /* =====================================================
     TOGGLE FIELD EXPANSION
  ===================================================== */
  const toggleField = (key) => {
    setExpandedField(expandedField === key ? null : key);
  };

  // Helper: map snake_case key -> Display Name (e.g., bill_number -> Bill Number)
  const displayNameFromKey = (key) => {
    if (!key) return "";
    return key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  // Helper: map Display Name -> snake_case key (first match in editableData)
  const keyFromDisplayName = (display) => {
    if (!display || !editableData) return null;
    const normalized = display.toLowerCase().replace(/\s+/g, "_");
    if (editableData[normalized]) return normalized;
    const found = Object.keys(editableData).find(k => displayNameFromKey(k) === display);
    return found || null;
  };

  // When activeField (display name) changes, expand corresponding left field
  useEffect(() => {
    if (!activeField) return;
    const k = keyFromDisplayName(activeField);
    if (k) setExpandedField(k);
    // Scroll left column to the active field if present
    try {
      if (k && fieldRefs.current && fieldRefs.current[k]) {
        fieldRefs.current[k].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (err) {
      console.warn('Could not scroll to active field:', err);
    }
  }, [activeField]);

  /* =====================================================
     TOGGLE FIELD SELECTION FOR BATCH EDIT
  ===================================================== */
  const toggleFieldSelection = (key, e) => {
    e.stopPropagation();
    setSelectedFields(prev => 
      prev.includes(key) 
        ? prev.filter(f => f !== key)
        : [...prev, key]
    );
  };

  /* =====================================================
     IMAGE CONTROLS
  ===================================================== */
  const zoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const zoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const rotateLeft = () => setRotateAngle(prev => prev - 90);
  const rotateRight = () => setRotateAngle(prev => prev + 90);
  const resetImage = () => {
    setZoomLevel(1);
    setRotateAngle(0);
  };

  const downloadImage = () => {
    if (!invoiceImage && !previewUrl) return;
    
    const link = document.createElement('a');
    link.href = invoiceImage || previewUrl;
    link.download = file?.name || 'invoice-image.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* =====================================================
     BATCH EDIT SELECTED FIELDS
  ===================================================== */
  const batchEditFields = (newValue) => {
    if (!editableData || selectedFields.length === 0) return;
    
    const updated = { ...editableData };
    selectedFields.forEach(key => {
      updated[key] = {
        ...updated[key],
        value: newValue,
        edited: true,
        lastEdited: new Date().toISOString(),
      };
    });
    
    setEditableData(updated);
    setProcessedInvoice(updated);
  };

  /* =====================================================
     GET FIELD STATISTICS
  ===================================================== */
  const getFieldStats = () => {
    if (!editableData || !hasValidUpload) return null;
    
    const fields = Object.values(editableData);
    const avgConfidence = fields.reduce((acc, field) => {
      let conf = Number(field.confidence || 0);
      if (conf > 1) conf /= 100;
      return acc + conf;
    }, 0) / (fields.length || 1);
    
    const highConfidence = fields.filter(f => {
      let conf = Number(f.confidence || 0);
      if (conf > 1) conf /= 100;
      return conf > 0.85;
    }).length;
    
    const editedCount = fields.filter(f => f.edited).length;
    const validCount = fields.filter((f, idx) => {
      const key = Object.keys(editableData)[idx];
      return !validationErrors[key];
    }).length;
    
    return {
      totalFields: fields.length,
      avgConfidence: (avgConfidence * 100).toFixed(1),
      highConfidence,
      editedCount,
      validCount,
    };
  };

  const stats = getFieldStats();

  /* =====================================================
     PRIORITY FIELDS
  ===================================================== */
  const getPriorityFields = () => {
    if (!editableData) return { priority: [], other: [] };
    
    const priorityOrder = ['bill_number', 'vendor_name', 'vendor_address', 'date'];
    const otherFields = [];
    const priorityFields = [];
    
    Object.keys(editableData).forEach(key => {
      if (priorityOrder.includes(key)) {
        priorityFields.push(key);
      } else {
        otherFields.push(key);
      }
    });
    
    return {
      priority: priorityFields.sort((a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b)),
      other: otherFields
    };
  };

  const fieldGroups = getPriorityFields();

  /* =====================================================
     STYLES
  ===================================================== */
  const styles = {
    container: {
      height: "100%",
      display: "flex",
      flexDirection: "column",
      paddingBottom: "20px",
    },
    uploadCard: {
      marginBottom: "24px",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "16px",
      padding: "24px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.02)",
    },
    resetButton: {
      background: "transparent",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "8px 16px",
      color: "#64748b",
      fontSize: "13px",
      cursor: "pointer",
      transition: "all 0.2s ease",
    },
    statsBar: {
      display: "flex",
      gap: "16px",
      padding: "12px 16px",
      background: "#f8fafc",
      borderRadius: "10px",
      marginBottom: "16px",
      fontSize: "13px",
      color: "#475569",
      flexWrap: "wrap",
    },
    uploadGrid: {
      display: "grid",
      gridTemplateColumns: "1.2fr 0.8fr",
      gap: "24px",
      height: "calc(100vh - 280px)",
      minHeight: "600px",
      overflow: "hidden",
    },
    scrollSection: {
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      paddingRight: "8px",
      scrollbarWidth: "thin",
      scrollbarColor: "#4f46e5 #f1f5f9",
    },
    fieldItem: {
      marginBottom: "16px",
      padding: "16px",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "12px",
      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      cursor: "pointer",
      position: "relative",
      userSelect: "none",
    },
    fieldHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "8px",
    },
    fieldLabel: {
      fontSize: "13px",
      fontWeight: "600",
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: "0.3px",
    },
    fieldValue: {
      fontSize: "16px",
      fontWeight: "500",
      color: "#0f172a",
      marginBottom: "8px",
      wordBreak: "break-word",
    },
    fieldInput: {
      width: "100%",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "12px",
      color: "#1e293b",
      fontSize: "14px",
      outline: "none",
      transition: "all 0.2s ease",
      marginTop: "8px",
    },
    confidenceBar: {
      flex: 1,
      height: "4px",
      background: "#f1f5f9",
      borderRadius: "2px",
      overflow: "hidden",
    },
    confidenceFill: (color, width) => ({
      width: `${width}%`,
      height: "100%",
      background: color,
      borderRadius: "2px",
      transition: "width 0.3s ease",
    }),
    confidenceBadge: {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: "20px",
      fontSize: "11px",
      fontWeight: "600",
      background: "#f8fafc",
    },
    previewImage: {
      width: "100%",
      height: "auto",
      minWidth: "100%",
      objectFit: "cover",
      borderRadius: "12px",
      border: "1px solid #e2e8f0",
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
      background: "#f8fafc",
      transform: `scale(${zoomLevel}) rotate(${rotateAngle}deg)`,
      transition: "transform 0.3s ease",
      display: "block",
    },
    imageContainer: {
      position: "relative",
      width: "100%",
      height: "calc(100% - 50px)",
      minHeight: "400px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      background: "#f8fafc",
      borderRadius: "12px",
      border: "1px solid #e2e8f0",
      overflow: "auto",
      padding: "0",
    },
    imageLoader: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      color: "#4f46e5",
      fontSize: "24px",
    },
    emptyPreview: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "500px",
      background: "#f8fafc",
      border: "2px dashed #e2e8f0",
      borderRadius: "12px",
      color: "#94a3b8",
      fontSize: "14px",
      flexDirection: "column",
      gap: "12px",
    },
    imageInfo: {
      marginTop: "12px",
      padding: "10px 12px",
      background: "#f8fafc",
      borderRadius: "8px",
      fontSize: "13px",
      color: "#475569",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "8px",
    },
    validationError: {
      marginTop: "4px",
      fontSize: "11px",
      color: "#ef4444",
    },
    revertBtn: {
      fontSize: "11px",
      color: "#4f46e5",
      background: "none",
      border: "none",
      cursor: "pointer",
      textDecoration: "underline",
      marginLeft: "8px",
    },
    batchEditBar: {
      padding: "12px",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      marginBottom: "16px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flexWrap: "wrap",
    },
    showMoreBtn: {
      width: "100%",
      padding: "12px",
      background: "#f8fafc",
      border: "1px dashed #4f46e5",
      borderRadius: "8px",
      color: "#4f46e5",
      fontSize: "13px",
      fontWeight: "500",
      cursor: "pointer",
      marginTop: "8px",
      marginBottom: "16px",
      transition: "all 0.2s ease",
    },
    buttonGroup: {
      display: "flex",
      gap: "12px",
      marginTop: "24px",
      padding: "16px 0 8px",
      borderTop: "1px solid #e2e8f0",
    },
    savedBadge: {
      display: "inline-block",
      padding: "4px 12px",
      background: "rgba(16, 185, 129, 0.1)",
      color: "#10b981",
      borderRadius: "20px",
      fontSize: "12px",
      fontWeight: "600",
      marginLeft: "12px",
    },
  };

  /* =====================================================
     CUSTOM SCROLLBAR STYLES
  ===================================================== */
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .upload-scroll-section::-webkit-scrollbar {
        width: 6px;
      }
      .upload-scroll-section::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 8px;
      }
      .upload-scroll-section::-webkit-scrollbar-thumb {
        background: #4f46e5;
        border-radius: 8px;
      }
      .upload-scroll-section::-webkit-scrollbar-thumb:hover {
        background: #6366f1;
      }
      .image-scroll-container::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      .image-scroll-container::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 8px;
      }
      .image-scroll-container::-webkit-scrollbar-thumb {
        background: #4f46e5;
        border-radius: 8px;
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  /* =====================================================
     EXTRACT KEY INFO FROM INVOICE FOR PREVIEW
  ===================================================== */
  const getExtractedInfo = () => {
    if (!editableData || !hasValidUpload) return null;
    
    return {
      vendorName: editableData.vendor_name?.value || "N/A",
      vendorAddress: editableData.vendor_address?.value || "N/A",
      date: editableData.date?.value || "N/A",
      billNumber: editableData.bill_number?.value || "N/A",
      total: editableData.total?.value || "N/A",
      gst: editableData.vendor_gst?.value || "N/A",
      phone: editableData.vendor_phone?.value || "N/A",
    };
  };

  const extractedInfo = getExtractedInfo();

  /* =====================================================
     UI
  ===================================================== */
  return (
    <div style={styles.container}>
      <h1 className="page-title">Upload & Process Invoice</h1>

      {/* UPLOAD SECTION */}
      <div style={styles.uploadCard}>
        <h3 style={{ fontSize: "18px", fontWeight: "600", color: "#0f172a", marginBottom: "16px" }}>
          Upload Invoice
        </h3>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "300px" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (!selected) return;

                setFile(selected);
                setImageError(false);

                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(URL.createObjectURL(selected));
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "14px",
              }}
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={loading || !file || isSaved}
            style={{
              background: (loading || !file || isSaved) ? "#cbd5e1" : "#4f46e5",
              border: "none",
              borderRadius: "8px",
              padding: "10px 24px",
              color: "white",
              fontSize: "14px",
              fontWeight: "500",
              cursor: (loading || !file || isSaved) ? "not-allowed" : "pointer",
              minWidth: "160px",
              position: "relative",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? (
              <>
                <span style={{ opacity: 0.7 }}>Processing...</span>
                <span style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  animation: "spin 1s linear infinite",
                }}>⟳</span>
              </>
            ) : isSaved ? (
              "Already Saved"
            ) : (
              "Process Invoice"
            )}
          </button>

          {(file || invoiceImage) && (
            <button
              onClick={handleReset}
              style={styles.resetButton}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f1f5f9";
                e.currentTarget.style.borderColor = "#cbd5e1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "#e2e8f0";
              }}
            >
              ✕ Clear All
            </button>
          )}
        </div>

        {file && (
          <div style={{
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "13px",
            color: "#64748b",
          }}>
            <span>📄 {file.name}</span>
            <span style={{
              background: "#f1f5f9",
              padding: "2px 8px",
              borderRadius: "12px",
              color: "#475569",
            }}>
              {(file.size / 1024).toFixed(1)} KB
            </span>
            {isSaved && (
              <span style={styles.savedBadge}>✓ Saved to Database</span>
            )}
          </div>
        )}
      </div>

      {/* RESULTS - Only show if valid upload exists */}
      {hasValidUpload && editableData && (
        <>
          {/* Enhanced Stats Bar */}
          {stats && (
            <div style={styles.statsBar}>
              <span>📊 <strong>{stats.totalFields}</strong> fields</span>
              <span>🎯 Avg. Confidence: <strong>{stats.avgConfidence}%</strong></span>
              <span>✅ High Confidence: <strong>{stats.highConfidence}</strong></span>
              <span>✏️ Edited: <strong>{stats.editedCount}</strong></span>
              <span>✓ Valid: <strong>{stats.validCount}/{stats.totalFields}</strong></span>
              {isSaved && <span style={{ color: "#10b981" }}>✓ Saved</span>}
            </div>
          )}

          {/* Batch Edit Bar (when fields selected) */}
          {selectedFields.length > 0 && !isSaved && (
            <div style={styles.batchEditBar}>
              <span><strong>{selectedFields.length}</strong> fields selected</span>
              <input
                type="text"
                placeholder="Batch edit value..."
                onChange={(e) => batchEditFields(e.target.value)}
                style={{
                  padding: "6px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  flex: 1,
                  minWidth: "200px",
                }}
              />
              <button
                onClick={() => setSelectedFields([])}
                style={{
                  background: "none",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          )}

          <div style={styles.uploadGrid}>

            {/* LEFT - Extracted Fields */}
            <div className="upload-scroll-section" style={styles.scrollSection}>
              <div style={{ ...styles.uploadCard, padding: "20px", marginBottom: 0 }}>
                <h3 style={{ 
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#0f172a",
                  marginBottom: "20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  Extracted Fields
                  <span style={{
                    fontSize: "13px",
                    fontWeight: "400",
                    color: "#64748b",
                    background: "#f1f5f9",
                    padding: "4px 10px",
                    borderRadius: "20px",
                  }}>
                    {Object.keys(editableData).length} fields
                  </span>
                </h3>

                {/* Priority Fields */}
                {fieldGroups.priority.map((key) => {
                  const value = editableData[key];
                  let confidence = Number(value?.confidence || 0);
                  if (confidence > 1) confidence /= 100;
                  const confidenceColor = getConfidenceColor(confidence);
                  const hasError = validationErrors[key];
                  const isSelected = selectedFields.includes(key);
                  const display = displayNameFromKey(key);
                  const isActiveField = activeField === display;

                  return (
                    <div
                      key={key}
                      ref={el => fieldRefs.current[key] = el}
                      style={{
                        ...styles.fieldItem,
                        borderColor: hasError ? "#ef4444" : (isActiveField ? confidenceColor : "#e2e8f0"),
                        background: isSelected ? "#f0f9ff" : (isActiveField ? `${confidenceColor}08` : "#ffffff"),
                        boxShadow: isActiveField ? `0 4px 12px ${confidenceColor}20` : "none",
                      }}
                      onClick={() => {
                        if (isSaved) return;
                        setActiveField(display);
                        toggleField(key);
                      }}
                      onMouseEnter={(e) => {
                        if (!isSaved && !isActiveField) {
                          e.currentTarget.style.borderColor = confidenceColor;
                          e.currentTarget.style.background = `${confidenceColor}04`;
                          e.currentTarget.style.transform = "translateX(4px)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateX(0)";
                        if (!isActiveField) {
                          e.currentTarget.style.borderColor = hasError ? "#ef4444" : "#e2e8f0";
                          e.currentTarget.style.background = isSelected ? "#f0f9ff" : "#ffffff";
                        }
                      }}
                    >
                      {!isSaved && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleFieldSelection(key, e)}
                          style={{
                            position: "absolute",
                            top: "12px",
                            right: "12px",
                            width: "16px",
                            height: "16px",
                            cursor: "pointer",
                          }}
                        />
                      )}

                      <div style={styles.fieldHeader}>
                        <span style={styles.fieldLabel}>
                          {display}
                          {value?.edited && <span style={{ marginLeft: "4px", color: "#4f46e5" }}>✎</span>}
                        </span>
                        <span style={{
                          ...styles.confidenceBadge,
                          color: confidenceColor,
                          background: `${confidenceColor}10`,
                        }}>
                          {(confidence * 100).toFixed(1)}%
                        </span>
                      </div>

                      <div style={styles.fieldValue}>
                        {value?.value || "—"}
                      </div>

                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginTop: "8px",
                      }}>
                        <div style={styles.confidenceBar}>
                          <div style={styles.confidenceFill(confidenceColor, confidence * 100)} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Show More Button */}
                {fieldGroups.other.length > 0 && !showAllFields && !isSaved && (
                  <button
                    onClick={() => setShowAllFields(true)}
                    style={styles.showMoreBtn}
                  >
                    + Show {fieldGroups.other.length} More Fields
                  </button>
                )}

                {/* Additional Fields */}
                {(showAllFields || expandedField) && fieldGroups.other.map((key) => {
                  const value = editableData[key];
                  let confidence = Number(value?.confidence || 0);
                  if (confidence > 1) confidence /= 100;
                  const isExpanded = expandedField === key;
                  const confidenceColor = getConfidenceColor(confidence);
                  const hasError = validationErrors[key];
                  const isSelected = selectedFields.includes(key);
                  const display = displayNameFromKey(key);
                  const isActiveField = activeField === display;

                  return (
                    <div
                      key={key}
                      ref={el => fieldRefs.current[key] = el}
                      style={{
                        ...styles.fieldItem,
                        borderColor: hasError ? "#ef4444" : (isActiveField ? confidenceColor : (isExpanded ? "#4f46e5" : "#e2e8f0")),
                        background: isSelected ? "#f0f9ff" : (isActiveField ? `${confidenceColor}08` : "#ffffff"),
                        boxShadow: isActiveField ? `0 4px 12px ${confidenceColor}20` : (isExpanded ? "0 4px 12px rgba(79, 70, 229, 0.1)" : "none"),
                      }}
                      onClick={() => {
                        if (isSaved) return;
                        setActiveField(display);
                        toggleField(key);
                      }}
                      onMouseEnter={(e) => {
                        if (!isSaved && !isActiveField) {
                          e.currentTarget.style.borderColor = confidenceColor;
                          e.currentTarget.style.background = `${confidenceColor}04`;
                          e.currentTarget.style.transform = "translateX(4px)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateX(0)";
                        if (!isActiveField) {
                          e.currentTarget.style.borderColor = hasError ? "#ef4444" : (isExpanded ? "#4f46e5" : "#e2e8f0");
                          e.currentTarget.style.background = isSelected ? "#f0f9ff" : "#ffffff";
                        }
                      }}
                    >
                      {!isSaved && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleFieldSelection(key, e)}
                          style={{
                            position: "absolute",
                            top: "12px",
                            right: "12px",
                            width: "16px",
                            height: "16px",
                            cursor: "pointer",
                          }}
                        />
                      )}

                      <div style={styles.fieldHeader}>
                        <span style={styles.fieldLabel}>
                          {display}
                          {value?.edited && <span style={{ marginLeft: "4px", color: "#4f46e5" }}>✎</span>}
                        </span>
                        <span style={{
                          ...styles.confidenceBadge,
                          color: confidenceColor,
                          background: `${confidenceColor}10`,
                        }}>
                          {(confidence * 100).toFixed(1)}%
                        </span>
                      </div>

                      {!isExpanded ? (
                        <div style={styles.fieldValue}>
                          {value?.value || "—"}
                        </div>
                      ) : (
                        <>
                          <input
                            style={{
                              ...styles.fieldInput,
                              borderColor: hasError ? "#ef4444" : "#e2e8f0",
                            }}
                            value={value?.value || ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => !isSaved && handleChange(key, e.target.value)}
                            disabled={isSaved}
                          />
                          
                          {value?.edited && (
                            <div style={{ marginTop: "4px", fontSize: "11px", color: "#64748b" }}>
                              Original: {value.originalValue}
                              {!isSaved && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    revertField(key);
                                  }}
                                  style={styles.revertBtn}
                                >
                                  Revert
                                </button>
                              )}
                            </div>
                          )}

                          {hasError && (
                            <div style={styles.validationError}>
                              ⚠ {validationErrors[key]}
                            </div>
                          )}
                        </>
                      )}

                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginTop: "8px",
                      }}>
                        <div style={styles.confidenceBar}>
                          <div style={styles.confidenceFill(confidenceColor, confidence * 100)} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div style={styles.buttonGroup}>
                  <button
                    onClick={handleSave}
                    disabled={saving || isSaved || Object.values(validationErrors).some(e => e !== null)}
                    style={{
                      flex: 1,
                      background: (saving || isSaved || Object.values(validationErrors).some(e => e !== null)) ? "#cbd5e1" : "#10b981",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px",
                      color: "white",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: (saving || isSaved || Object.values(validationErrors).some(e => e !== null)) ? "not-allowed" : "pointer",
                    }}
                  >
                    {saving ? "Saving..." : isSaved ? "✓ Already Saved" : "✓ Confirm & Save"}
                  </button>

                  <button
                    onClick={handleDownloadExcel}
                    disabled={!editableData}
                    style={{
                      flex: 1,
                      background: "#4f46e5",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px",
                      color: "white",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                      opacity: !editableData ? 0.5 : 1,
                    }}
                  >
                    📥 Download Excel
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT - Invoice Preview */}
            <div className="upload-scroll-section" style={styles.scrollSection}>
              <div style={{ ...styles.uploadCard, padding: "20px", marginBottom: 0, height: "100%", display: "flex", flexDirection: "column" }}>
                <h3 style={{ 
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#0f172a",
                  marginBottom: "16px",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  Invoice Preview
                  {isSaved && (
                    <span style={styles.savedBadge}>✓ Saved</span>
                  )}
                </h3>

                {invoiceImage || previewUrl ? (
                  <>
                    <div 
                      ref={previewContainerRef}
                      className="image-scroll-container"
                      style={{
                        ...styles.imageContainer,
                        height: "calc(100% - 50px)",
                        minHeight: "400px",
                      }}
                    >
                      {imageLoading && (
                        <div style={styles.imageLoader}>⟳</div>
                      )}
                      <InvoicePreviewWithHighlights
                        imageUrl={invoiceImage || previewUrl}
                        textractResponse={textractResponse}
                        activeField={activeField}
                        onFieldClick={(fieldName) => {
                          if (fieldName) {
                            setActiveField(fieldName);
                            const mappedKey = keyFromDisplayName(fieldName);
                            if (mappedKey) setExpandedField(mappedKey);
                          } else {
                            clearActiveField();
                            setExpandedField(null);
                          }
                        }}
                        zoomLevel={zoomLevel}
                        rotateAngle={rotateAngle}
                        showAllBoxes={showAllFields}
                      />
                    </div>

                    <div style={styles.imageInfo}>
                      <span>📏 Zoom: {zoomLevel * 100}% | Rotate: {rotateAngle}°</span>
                      <span>📋 {file?.name || "Invoice image"}</span>
                    </div>
                  </>
                ) : (
                  <div style={styles.emptyPreview}>
                    <span style={{ fontSize: "48px", marginBottom: "16px" }}>🖼️</span>
                    <p>No preview available</p>
                    <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Upload an invoice to see preview
                    </p>
                  </div>
                )}

                {imageError && (
                  <div style={{
                    marginTop: "12px",
                    padding: "8px 12px",
                    background: "#fef2f2",
                    border: "1px solid #fee2e2",
                    borderRadius: "8px",
                    color: "#b91c1c",
                    fontSize: "13px",
                    flexShrink: 0,
                  }}>
                    ⚠ Failed to load image
                  </div>
                )}
              </div>
            </div>

          </div>
        </>
      )}

      {/* Empty State */}
      {!hasValidUpload && !loading && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "400px",
          background: "#ffffff",
          border: "2px dashed #e2e8f0",
          borderRadius: "16px",
          marginTop: "20px",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "64px", marginBottom: "20px", color: "#cbd5e1" }}>📄</div>
            <h3 style={{ color: "#1e293b", marginBottom: "8px", fontSize: "20px" }}>
              No Invoice Processed
            </h3>
            <p style={{ color: "#64748b", fontSize: "14px", maxWidth: "400px" }}>
              Upload an invoice above to extract data and see preview
            </p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && !editableData && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "400px",
          flexDirection: "column",
          gap: "20px",
        }}>
          <div style={{ fontSize: "48px", color: "#4f46e5", animation: "spin 1s linear infinite" }}>
            ⟳
          </div>
          <p style={{ color: "#64748b" }}>Processing your invoice...</p>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}