import {
  createContext,
  useState,
  useMemo,
  useCallback,
  useContext,
  useEffect,
} from "react";

/* =========================================================
   CONTEXT
========================================================= */

export const InvoiceContext = createContext(null);

/* =========================================================
   PROVIDER (ENTERPRISE VERSION)
========================================================= */

export const InvoiceProvider = ({ children }) => {
  /* ---------------- MAIN STATE ---------------- */
  const [processedInvoice, setProcessedInvoiceState] = useState(null);
  const [previewUrl, setPreviewUrlState] = useState(null);
  const [invoiceImage, setInvoiceImageState] = useState(null);
  const [uploadedFile, setUploadedFileState] = useState(null);
  const [processingHistory, setProcessingHistory] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [sessionTimestamp, setSessionTimestamp] = useState(null);
  
  // NEW: Store full Textract response for bounding boxes
  const [textractResponse, setTextractResponseState] = useState(null);
  
  // NEW: Track active field for bidirectional highlighting
  const [activeField, setActiveFieldState] = useState(null);

  /* =====================================================
     SESSION TIMEOUT (30 minutes)
  ===================================================== */
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

  /* =====================================================
     LOAD FROM LOCALSTORAGE ONLY IF SESSION IS VALID
     ⚠️ NOTE: This is for TEMPORARY storage only, not database
  ===================================================== */
  useEffect(() => {
    try {
      // Check if there was an active session
      const sessionActive = localStorage.getItem("invoiceSessionActive") === "true";
      const savedTimestamp = localStorage.getItem("sessionTimestamp");
      
      // Check if session has expired
      if (sessionActive && savedTimestamp) {
        const timestamp = parseInt(savedTimestamp, 10);
        const now = Date.now();
        
        if (now - timestamp > SESSION_TIMEOUT) {
          // Session expired - clear everything
          localStorage.removeItem("savedInvoice");
          localStorage.removeItem("savedInvoiceImage");
          localStorage.removeItem("savedFile");
          localStorage.removeItem("savedTextractResponse");
          localStorage.removeItem("savedActiveField");
          localStorage.removeItem("invoiceSessionActive");
          localStorage.removeItem("sessionTimestamp");
          setHasActiveSession(false);
          return;
        }
        
        // Session is still valid, load data
        const savedInvoice = localStorage.getItem("savedInvoice");
        const savedImage = localStorage.getItem("savedInvoiceImage");
        const savedFile = localStorage.getItem("savedFile");
        const savedTextract = localStorage.getItem("savedTextractResponse");
        const savedActiveField = localStorage.getItem("savedActiveField");
        
        if (savedInvoice) {
          setProcessedInvoiceState(JSON.parse(savedInvoice));
          setHasActiveSession(true);
          setSessionTimestamp(timestamp);
        }
        
        if (savedImage) {
          setInvoiceImageState(savedImage);
        }
        
        if (savedFile) {
          setUploadedFileState(JSON.parse(savedFile));
        }
        
        if (savedTextract) {
          setTextractResponseState(JSON.parse(savedTextract));
        }
        
        if (savedActiveField) {
          setActiveFieldState(savedActiveField);
        }
      } else {
        // Clear any stale data if no active session
        localStorage.removeItem("savedInvoice");
        localStorage.removeItem("savedInvoiceImage");
        localStorage.removeItem("savedFile");
        localStorage.removeItem("savedTextractResponse");
        localStorage.removeItem("savedActiveField");
        setHasActiveSession(false);
      }
    } catch (error) {
      console.error("Error loading from localStorage:", error);
      // On error, clear everything to be safe
      localStorage.removeItem("savedInvoice");
      localStorage.removeItem("savedInvoiceImage");
      localStorage.removeItem("savedFile");
      localStorage.removeItem("savedTextractResponse");
      localStorage.removeItem("savedActiveField");
      localStorage.removeItem("invoiceSessionActive");
      localStorage.removeItem("sessionTimestamp");
      setHasActiveSession(false);
    }
  }, [SESSION_TIMEOUT]);

  /* =====================================================
     SAVE TO LOCALSTORAGE WHEN STATE CHANGES
     ⚠️ NOTE: This is TEMPORARY storage, NOT database
     The actual database save only happens when Confirm & Save is clicked
  ===================================================== */
  useEffect(() => {
    if (processedInvoice && hasActiveSession) {
      localStorage.setItem("savedInvoice", JSON.stringify(processedInvoice));
      localStorage.setItem("invoiceSessionActive", "true");
      localStorage.setItem("sessionTimestamp", Date.now().toString());
    } else {
      localStorage.removeItem("savedInvoice");
    }
  }, [processedInvoice, hasActiveSession]);

  useEffect(() => {
    if (invoiceImage && hasActiveSession) {
      localStorage.setItem("savedInvoiceImage", invoiceImage);
      localStorage.setItem("sessionTimestamp", Date.now().toString());
    } else {
      localStorage.removeItem("savedInvoiceImage");
    }
  }, [invoiceImage, hasActiveSession]);

  useEffect(() => {
    if (uploadedFile && hasActiveSession) {
      localStorage.setItem("savedFile", JSON.stringify(uploadedFile));
      localStorage.setItem("sessionTimestamp", Date.now().toString());
    } else {
      localStorage.removeItem("savedFile");
    }
  }, [uploadedFile, hasActiveSession]);

  // NEW: Save Textract response to localStorage
  useEffect(() => {
    if (textractResponse && hasActiveSession) {
      localStorage.setItem("savedTextractResponse", JSON.stringify(textractResponse));
      localStorage.setItem("sessionTimestamp", Date.now().toString());
    } else {
      localStorage.removeItem("savedTextractResponse");
    }
  }, [textractResponse, hasActiveSession]);

  // NEW: Save active field to localStorage
  useEffect(() => {
    if (activeField && hasActiveSession) {
      localStorage.setItem("savedActiveField", activeField);
      localStorage.setItem("sessionTimestamp", Date.now().toString());
    } else {
      localStorage.removeItem("savedActiveField");
    }
  }, [activeField, hasActiveSession]);

  /* =====================================================
     SAFE SETTERS
  ===================================================== */

  const setProcessedInvoice = useCallback((data) => {
    setProcessedInvoiceState(data);
    
    if (data) {
      setHasActiveSession(true);
      setSessionTimestamp(Date.now());
      setLastUpdated(new Date().toISOString());

      // Add to history
      setProcessingHistory(prev => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          action: "invoice_processed",
          fieldCount: Object.keys(data).length,
        }
      ].slice(-10)); // Keep last 10 entries
    }

    // SAFE EVENT TRIGGER
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("invoice-updated"));
    }
  }, []);

  const setPreviewUrl = useCallback((url) => {
    // Clean up previous preview URL to prevent memory leaks
    setPreviewUrlState((prevUrl) => {
      if (prevUrl && typeof window !== "undefined" && prevUrl !== url) {
        URL.revokeObjectURL(prevUrl);
      }
      return url;
    });
  }, []);

  const setInvoiceImage = useCallback((imageUrl) => {
    setInvoiceImageState(imageUrl);
    if (imageUrl) {
      setSessionTimestamp(Date.now());
    }
  }, []);

  const setUploadedFile = useCallback((file) => {
    setUploadedFileState(file);
    if (file) {
      setSessionTimestamp(Date.now());
    }
  }, []);

  // NEW: Set Textract response
  const setTextractResponse = useCallback((response) => {
    setTextractResponseState(response);
    if (response) {
      setSessionTimestamp(Date.now());
    }
  }, []);

  // NEW: Set active field for highlighting
  const setActiveField = useCallback((fieldName) => {
    setActiveFieldState(fieldName);
    if (fieldName) {
      setSessionTimestamp(Date.now());
    }
  }, []);

  // NEW: Clear active field
  const clearActiveField = useCallback(() => {
    setActiveFieldState(null);
  }, []);

  /* =====================================================
     RESET STATE (PRO UX)
  ===================================================== */
  const resetInvoice = useCallback(() => {
    // cleanup preview URL (important memory fix)
    if (previewUrl && typeof window !== "undefined") {
      URL.revokeObjectURL(previewUrl);
    }

    setProcessedInvoiceState(null);
    setPreviewUrlState(null);
    setInvoiceImageState(null);
    setUploadedFileState(null);
    setTextractResponseState(null);
    setActiveFieldState(null);
    setHasActiveSession(false);
    setSessionTimestamp(null);
    
    // Clear localStorage
    localStorage.removeItem("savedInvoice");
    localStorage.removeItem("savedInvoiceImage");
    localStorage.removeItem("savedFile");
    localStorage.removeItem("savedTextractResponse");
    localStorage.removeItem("savedActiveField");
    localStorage.removeItem("invoiceSessionActive");
    localStorage.removeItem("sessionTimestamp");
    
    // Add to history
    setProcessingHistory(prev => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        action: "invoice_reset",
      }
    ].slice(-10));
    
    // Trigger update event
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("invoice-reset"));
    }
  }, [previewUrl]);

  /* =====================================================
     UPDATE FIELD HELPER
     ⚠️ Updates local state ONLY, NOT database
  ===================================================== */
  const updateInvoiceField = useCallback((fieldName, newValue, confidence = null) => {
    setProcessedInvoiceState((prev) => {
      if (!prev) return prev;
      
      const updated = {
        ...prev,
        [fieldName]: {
          ...prev[fieldName],
          value: newValue,
          ...(confidence !== null && { confidence }),
          edited: true,
          lastEdited: new Date().toISOString(),
        },
      };
      
      // Update localStorage only if session is active (TEMPORARY storage)
      if (hasActiveSession) {
        localStorage.setItem("savedInvoice", JSON.stringify(updated));
        localStorage.setItem("sessionTimestamp", Date.now().toString());
      }
      
      return updated;
    });
  }, [hasActiveSession]);

  /* =====================================================
     BATCH UPDATE FIELDS
     ⚠️ Updates local state ONLY, NOT database
  ===================================================== */
  const batchUpdateInvoice = useCallback((updates) => {
    setProcessedInvoiceState((prev) => {
      if (!prev) return prev;
      
      const updated = { ...prev };
      Object.entries(updates).forEach(([fieldName, fieldData]) => {
        updated[fieldName] = {
          ...prev[fieldName],
          ...fieldData,
          edited: true,
          lastEdited: new Date().toISOString(),
        };
      });
      
      // Update localStorage only if session is active (TEMPORARY storage)
      if (hasActiveSession) {
        localStorage.setItem("savedInvoice", JSON.stringify(updated));
        localStorage.setItem("sessionTimestamp", Date.now().toString());
      }
      
      return updated;
    });
  }, [hasActiveSession]);

  /* =====================================================
     GET FIELD VALUE
  ===================================================== */
  const getFieldValue = useCallback((fieldName) => {
    return processedInvoice?.[fieldName]?.value || "";
  }, [processedInvoice]);

  /* =====================================================
     GET FIELD CONFIDENCE
  ===================================================== */
  const getFieldConfidence = useCallback((fieldName) => {
    return processedInvoice?.[fieldName]?.confidence || 0;
  }, [processedInvoice]);

  /* =====================================================
     CHECK IF INVOICE EXISTS (REQUIRES ACTIVE SESSION AND VALID FILE)
  ===================================================== */
  const hasInvoice = useCallback(() => {
    return hasActiveSession && 
           processedInvoice !== null && 
           Object.keys(processedInvoice || {}).length > 0 &&
           (uploadedFile !== null || invoiceImage !== null);
  }, [processedInvoice, hasActiveSession, uploadedFile, invoiceImage]);

  /* =====================================================
     GET ALL FIELD NAMES
  ===================================================== */
  const getFieldNames = useCallback(() => {
    return processedInvoice ? Object.keys(processedInvoice) : [];
  }, [processedInvoice]);

  /* =====================================================
     GET INVOICE SUMMARY (ONLY IF ACTIVE SESSION AND FILE EXISTS)
  ===================================================== */
  const getInvoiceSummary = useCallback(() => {
    if (!hasActiveSession || !processedInvoice || (!uploadedFile && !invoiceImage)) return null;
    
    const fields = Object.entries(processedInvoice).map(([key, value]) => ({
      field: key,
      value: value?.value || "",
      confidence: value?.confidence || 0,
      edited: value?.edited || false,
      lastEdited: value?.lastEdited || null,
    }));
    
    const avgConfidence = fields.reduce((acc, field) => {
      let conf = field.confidence;
      if (conf > 1) conf /= 100;
      return acc + conf;
    }, 0) / (fields.length || 1);
    
    const editedCount = fields.filter(f => f.edited).length;
    
    return {
      fieldCount: fields.length,
      avgConfidence: avgConfidence * 100,
      editedCount,
      fields,
      lastUpdated,
    };
  }, [processedInvoice, lastUpdated, hasActiveSession, uploadedFile, invoiceImage]);

  /* =====================================================
     EXPORT INVOICE DATA
  ===================================================== */
  const exportInvoiceData = useCallback((format = "json") => {
    if (!hasActiveSession || !processedInvoice || (!uploadedFile && !invoiceImage)) return null;
    
    if (format === "json") {
      return JSON.stringify({
        data: processedInvoice,
        textractResponse: textractResponse, // Include Textract response for debugging
        exportedAt: new Date().toISOString(),
        summary: getInvoiceSummary(),
      }, null, 2);
    }
    
    if (format === "csv") {
      const headers = ["Field", "Value", "Confidence", "Edited", "Last Edited"];
      const rows = Object.entries(processedInvoice).map(([key, value]) => {
        let confidence = value?.confidence || 0;
        if (confidence > 1) confidence /= 100;
        return [
          key,
          value?.value || "",
          `${(confidence * 100).toFixed(1)}%`,
          value?.edited ? "Yes" : "No",
          value?.lastEdited ? new Date(value.lastEdited).toLocaleString() : "",
        ];
      });
      
      return [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(","))
        .join("\n");
    }
    
    return processedInvoice;
  }, [processedInvoice, textractResponse, getInvoiceSummary, hasActiveSession, uploadedFile, invoiceImage]);

  /* =====================================================
     GET TEXTRACT RESPONSE
  ===================================================== */
  const getTextractResponse = useCallback(() => {
    return hasActiveSession ? textractResponse : null;
  }, [textractResponse, hasActiveSession]);

  /* =====================================================
     GET ACTIVE FIELD
  ===================================================== */
  const getActiveField = useCallback(() => {
    return hasActiveSession ? activeField : null;
  }, [activeField, hasActiveSession]);

  /* =====================================================
     CLEAR HISTORY
  ===================================================== */
  const clearHistory = useCallback(() => {
    setProcessingHistory([]);
  }, []);

  /* =====================================================
     GET PROCESSING HISTORY
  ===================================================== */
  const getProcessingHistory = useCallback(() => {
    return processingHistory;
  }, [processingHistory]);

  /* =====================================================
     CHECK IF IMAGE EXISTS (REQUIRES ACTIVE SESSION)
  ===================================================== */
  const hasImage = useCallback(() => {
    return hasActiveSession && (invoiceImage !== null || previewUrl !== null);
  }, [invoiceImage, previewUrl, hasActiveSession]);

  /* =====================================================
     GET UPLOADED FILE INFO
  ===================================================== */
  const getUploadedFile = useCallback(() => {
    return hasActiveSession ? uploadedFile : null;
  }, [uploadedFile, hasActiveSession]);

  /* =====================================================
     CHECK IF SESSION IS ACTIVE AND HAS VALID FILE
  ===================================================== */
  const isValidSession = useCallback(() => {
    return hasActiveSession && (uploadedFile !== null || invoiceImage !== null);
  }, [hasActiveSession, uploadedFile, invoiceImage]);

  /* =====================================================
     CHECK SESSION EXPIRY
  ===================================================== */
  const checkSessionExpiry = useCallback(() => {
    if (!sessionTimestamp) return false;
    
    const now = Date.now();
    if (now - sessionTimestamp > SESSION_TIMEOUT) {
      // Session expired - auto reset
      resetInvoice();
      return true;
    }
    return false;
  }, [sessionTimestamp, resetInvoice, SESSION_TIMEOUT]);

  /* =====================================================
     PERIODIC SESSION CHECK
  ===================================================== */
  useEffect(() => {
    const interval = setInterval(() => {
      checkSessionExpiry();
    }, 60000); // Check every minute
    
    return () => clearInterval(interval);
  }, [checkSessionExpiry]);

  /* =====================================================
     MEMOIZED VALUE
  ===================================================== */

  const value = useMemo(
    () => ({
      // State
      processedInvoice,
      setProcessedInvoice,
      previewUrl,
      setPreviewUrl,
      invoiceImage,
      setInvoiceImage,
      uploadedFile,
      setUploadedFile,
      resetInvoice,
      processingHistory,
      lastUpdated,
      hasActiveSession,
      sessionTimestamp,
      
      // NEW: Textract response state
      textractResponse,
      setTextractResponse,
      
      // NEW: Active field state for bidirectional highlighting
      activeField,
      setActiveField,
      clearActiveField,
      
      // Helper Methods
      updateInvoiceField,
      batchUpdateInvoice,
      getFieldValue,
      getFieldConfidence,
      hasInvoice,
      hasImage,
      getFieldNames,
      getInvoiceSummary,
      exportInvoiceData,
      clearHistory,
      getProcessingHistory,
      getUploadedFile,
      isValidSession,
      checkSessionExpiry,
      getTextractResponse,
      getActiveField,
    }),
    [
      processedInvoice,
      previewUrl,
      invoiceImage,
      uploadedFile,
      processingHistory,
      lastUpdated,
      hasActiveSession,
      sessionTimestamp,
      textractResponse,
      activeField,
      setProcessedInvoice,
      setPreviewUrl,
      setInvoiceImage,
      setUploadedFile,
      setTextractResponse,
      setActiveField,
      clearActiveField,
      resetInvoice,
      updateInvoiceField,
      batchUpdateInvoice,
      getFieldValue,
      getFieldConfidence,
      hasInvoice,
      hasImage,
      getFieldNames,
      getInvoiceSummary,
      exportInvoiceData,
      clearHistory,
      getProcessingHistory,
      getUploadedFile,
      isValidSession,
      checkSessionExpiry,
      getTextractResponse,
      getActiveField,
    ]
  );

  return (
    <InvoiceContext.Provider value={value}>
      {children}
    </InvoiceContext.Provider>
  );
};

/* =========================================================
   CUSTOM HOOK FOR EASY CONTEXT USAGE
========================================================= */

export const useInvoice = () => {
  const context = useContext(InvoiceContext);
  if (!context) {
    throw new Error("useInvoice must be used within an InvoiceProvider");
  }
  return context;
};