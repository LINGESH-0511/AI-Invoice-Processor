// components/InvoicePreviewWithHighlights.jsx
//
// FIXED: Correctly integrates with processor.py's get_field_bounding_boxes() output.
// ADDED: India-specific field cleaning for GST, Phone numbers, and Address formatting
// ADDED: Helpline number filtering and prioritization

import React, { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// INDIA-SPECIFIC FIELD CLEANING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean GST Number - Remove W.E.F., date suffixes, and extract only 15-character GSTIN
 */
const cleanGSTNumber = (text) => {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove W.E.F., WEF, effective from and date patterns
  cleaned = cleaned.replace(/W\.?\s*E\.?\s*F\.?\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/WEF\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/effective\s*from\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/w\.e\.f\.\s*/gi, '');
  
  // Remove extra spaces and special characters
  cleaned = cleaned.replace(/[-\s]/g, '');
  
  // Extract 15-character GST pattern (2 digits + 10 alphanumeric + 1 alphanumeric + 1 alphanumeric + 1 alphanumeric)
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
 * Extract Vendor Phone - Prioritize Tel/Phone over Helpline/Toll Free numbers
 */
const extractVendorPhoneNumber = (text, fieldType) => {
  if (!text) return { text: '', isHelpline: false };
  
  const lowerText = text.toLowerCase();
  
  // Check if this is a helpline number (should be ignored)
  const isHelpline = /helpline|toll\s*free|customer\s*care|support|1800/i.test(lowerText);
  
  // Extract phone number pattern
  const phoneMatch = text.match(/[0-9\-\(\)\s+]{8,15}/g);
  const phoneNumber = phoneMatch ? phoneMatch[0].trim() : text;
  
  return {
    text: isHelpline ? '' : phoneNumber,
    isHelpline: isHelpline
  };
};

/**
 * Format Address - Add proper line breaks and structure
 */
const formatAddressText = (address) => {
  if (!address) return '';
  
  let formatted = address;
  
  // Add line breaks after common address patterns
  formatted = formatted.replace(/(PLOT\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/(SHOP\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/(FLAT\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/([A-Z]{2,}\s+\d{6})/, '\n$1'); // PIN code on new line
  formatted = formatted.replace(/(\d{6})/, '\n$1'); // PIN code alone
  formatted = formatted.replace(/(GHATKOPAR|INDIRAPURAM|GHAZIABAD|MUMBAI|DELHI|BANGALORE|CHENNAI|KOLKATA|PUNE|HYDERABAD)/gi, '\n$1');
  
  // Remove duplicate line breaks
  formatted = formatted.replace(/\n+/g, '\n');
  
  return formatted.trim();
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — must match processor.py TYPE_TO_DISPLAY values exactly
// ─────────────────────────────────────────────────────────────────────────────

const DISPLAY_FIELD_NAMES = [
  "Bill Number",
  "Vendor Name",
  "Vendor Address",
  "Vendor Phone Number",
  "Vendor GST Number",
  "Invoice Date",
  "Total Amount",
];

// Distinct, accessible colour per field (matches a legend shown to the user)
const FIELD_COLORS = {
  "Bill Number":        "#6366f1", // indigo
  "Vendor Name":        "#0ea5e9", // sky blue
  "Vendor Address":     "#10b981", // emerald
  "Vendor Phone Number":"#f59e0b", // amber
  "Vendor GST Number":  "#ec4899", // pink
  "Invoice Date":       "#8b5cf6", // violet
  "Total Amount":       "#ef4444", // red
};

const DEFAULT_COLOR = "#94a3b8";

function getFieldColor(fieldName) {
  return FIELD_COLORS[fieldName] ?? DEFAULT_COLOR;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOUNDING BOX EXTRACTION
// Mirrors processor.py get_field_bounding_boxes() logic on the JS side.
// Accepts the full Textract response (may also have .fieldBoundingBoxes injected
// by the backend so we don't have to re-parse ExpenseDocuments in JS).
// ─────────────────────────────────────────────────────────────────────────────

// TYPE_TO_DISPLAY mapping — copied from processor.py so JS can decode raw responses
const TYPE_TO_DISPLAY = {
  INVOICE_RECEIPT_ID: "Bill Number",
  RECEIPT_ID: "Bill Number",
  INVOICE_ID: "Bill Number",
  BILL_NUMBER: "Bill Number",
  BILL_NO: "Bill Number",
  INVOICE_NUMBER: "Bill Number",
  INVOICE_NO: "Bill Number",
  RECEIPT_NUMBER: "Bill Number",
  ORDER_NUMBER: "Bill Number",
  DOCUMENT_ID: "Bill Number",
  VENDOR_NAME: "Vendor Name",
  MERCHANT_NAME: "Vendor Name",
  STORE_NAME: "Vendor Name",
  SUPPLIER_NAME: "Vendor Name",
  SELLER_NAME: "Vendor Name",
  BILL_FROM: "Vendor Name",
  COMPANY_NAME: "Vendor Name",
  BUSINESS_NAME: "Vendor Name",
  SHOP_NAME: "Vendor Name",
  RESTAURANT_NAME: "Vendor Name",
  HOTEL_NAME: "Vendor Name",
  VENDOR_ADDRESS: "Vendor Address",
  ADDRESS: "Vendor Address",
  MERCHANT_ADDRESS: "Vendor Address",
  BILL_FROM_ADDRESS: "Vendor Address",
  SUPPLIER_ADDRESS: "Vendor Address",
  COMPANY_ADDRESS: "Vendor Address",
  BUSINESS_ADDRESS: "Vendor Address",
  LOCATION: "Vendor Address",
  VENDOR_PHONE: "Vendor Phone Number",
  PHONE: "Vendor Phone Number",
  TELEPHONE: "Vendor Phone Number",
  TEL: "Vendor Phone Number",
  MOBILE: "Vendor Phone Number",
  MOBILE_NUMBER: "Vendor Phone Number",
  CONTACT: "Vendor Phone Number",
  CONTACT_NUMBER: "Vendor Phone Number",
  PHONE_NUMBER: "Vendor Phone Number",
  GST_NUMBER: "Vendor GST Number",
  GST: "Vendor GST Number",
  GSTIN: "Vendor GST Number",
  TAX_ID: "Vendor GST Number",
  VAT_NUMBER: "Vendor GST Number",
  VAT: "Vendor GST Number",
  CST_NUMBER: "Vendor GST Number",
  TAX_NUMBER: "Vendor GST Number",
  INVOICE_RECEIPT_DATE: "Invoice Date",
  INVOICE_DATE: "Invoice Date",
  TRANSACTION_DATE: "Invoice Date",
  DATE: "Invoice Date",
  BILL_DATE: "Invoice Date",
  RECEIPT_DATE: "Invoice Date",
  DOCUMENT_DATE: "Invoice Date",
  ISSUE_DATE: "Invoice Date",
  TOTAL: "Total Amount",
  AMOUNT_DUE: "Total Amount",
  GRAND_TOTAL: "Total Amount",
  NET_AMOUNT: "Total Amount",
  TOTAL_AMOUNT: "Total Amount",
  BILL_AMOUNT: "Total Amount",
  INVOICE_TOTAL: "Total Amount",
  AMOUNT_PAYABLE: "Total Amount",
  TOTAL_DUE: "Total Amount",
  BALANCE_DUE: "Total Amount",
  NET_TOTAL: "Total Amount",
  FINAL_TOTAL: "Total Amount",
};

// Track processed phone numbers to avoid duplicates
const processedPhones = new Set();

/**
 * Normalise a bounding box object so it always has capitalised keys
 * { Left, Top, Width, Height } regardless of what the source used.
 */
function normaliseBB(bb) {
  if (!bb) return null;
  const L = bb.Left  ?? bb.left  ?? null;
  const T = bb.Top   ?? bb.top   ?? null;
  const W = bb.Width ?? bb.width ?? null;
  const H = bb.Height?? bb.height?? null;
  if (L === null || T === null || W === null || H === null) return null;
  if (W <= 0 || H <= 0) return null;
  return { Left: L, Top: T, Width: W, Height: H };
}

/**
 * Extract field bounding boxes from the Textract response.
 *
 * Returns an array of box descriptors:
 *   { id, fieldName, text, confidence, cleanedText, bb: { Left, Top, Width, Height } }
 *
 * Priority:
 *   1. response.fieldBoundingBoxes  — pre-computed by Python backend
 *   2. response.ExpenseDocuments    — raw Textract analyse_expense output
 */
function extractFieldBoxes(textractResponse) {
  if (!textractResponse) return [];

  const boxes = [];
  processedPhones.clear();

  // ── Priority 1: pre-computed by processor.py get_field_bounding_boxes() ──
  const precomputed = textractResponse.fieldBoundingBoxes;
  if (precomputed && typeof precomputed === "object" && Object.keys(precomputed).length > 0) {
    console.debug("[InvoicePreview] Using pre-computed fieldBoundingBoxes from backend");
    Object.entries(precomputed).forEach(([displayName, entry]) => {
      // Phone numbers arrive as an array; everything else is a plain object
      const entries = Array.isArray(entry) ? entry : [entry];
      entries.forEach((e, idx) => {
        const bb = normaliseBB(e);
        if (!bb) return;
        
        let cleanedText = e.text ?? "";
        let finalFieldName = displayName;
        let finalConfidence = e.confidence ?? 0;
        
        // Apply India-specific cleaning based on field type
        if (displayName === "Vendor GST Number") {
          cleanedText = cleanGSTNumber(e.text ?? "");
          // Skip if GST is invalid after cleaning
          if (!cleanedText || cleanedText.length < 14) return;
        } else if (displayName === "Vendor Phone Number") {
          const { text: cleanedPhone, isHelpline } = extractVendorPhoneNumber(e.text ?? "", displayName);
          if (isHelpline || !cleanedPhone) return; // Skip helpline numbers
          if (processedPhones.has(cleanedPhone)) return; // Skip duplicates
          cleanedText = cleanedPhone;
          processedPhones.add(cleanedPhone);
        } else if (displayName === "Vendor Address") {
          cleanedText = formatAddressText(e.text ?? "");
        }
        
        boxes.push({
          id: `precomputed-${displayName}-${idx}`,
          fieldName: finalFieldName,
          text: e.text ?? "",
          cleanedText: cleanedText,
          confidence: finalConfidence,
          bb,
        });
      });
    });
    if (boxes.length > 0) return boxes;
  }

  // ── Priority 2: parse ExpenseDocuments directly (mirrors processor.py) ──
  console.debug("[InvoicePreview] Parsing ExpenseDocuments for bounding boxes");
  const expenseDocs = textractResponse.ExpenseDocuments ?? [];

  expenseDocs.forEach((doc, docIdx) => {
    const summaryFields = doc.SummaryFields ?? [];

    summaryFields.forEach((fld, fldIdx) => {
      const fieldType = (fld?.Type?.Text ?? "").toUpperCase();
      const displayName = TYPE_TO_DISPLAY[fieldType];
      if (!displayName) return;

      const vd = fld.ValueDetection ?? {};
      let text = (vd.Text ?? "").trim();
      const confidence = vd.Confidence ?? 0;
      const geomBB = vd.Geometry?.BoundingBox;
      const bb = normaliseBB(geomBB);
      if (!bb || !text) return;

      let cleanedText = text;
      
      // Apply India-specific cleaning
      if (displayName === "Vendor GST Number") {
        cleanedText = cleanGSTNumber(text);
        // Skip invalid GST entries
        if (!cleanedText || cleanedText.length < 14) return;
        // Additional validation for GST format
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i;
        if (!gstRegex.test(cleanedText)) return;
      } else if (displayName === "Vendor Phone Number") {
        const { text: cleanedPhone, isHelpline } = extractVendorPhoneNumber(text, displayName);
        if (isHelpline || !cleanedPhone) return;
        if (processedPhones.has(cleanedPhone)) return;
        cleanedText = cleanedPhone;
        processedPhones.add(cleanedPhone);
      } else if (displayName === "Vendor Address") {
        cleanedText = formatAddressText(text);
      }

      boxes.push({
        id: `expense-${docIdx}-${fldIdx}`,
        fieldName: displayName,
        text: text,
        cleanedText: cleanedText,
        confidence,
        bb,
      });
    });

    // Also scan LineItemGroups → SummaryFields
    (doc.LineItemGroups ?? []).forEach((lig, ligIdx) => {
      (lig.SummaryFields ?? []).forEach((sf, sfIdx) => {
        const fieldType = (sf?.Type?.Text ?? "").toUpperCase();
        const displayName = TYPE_TO_DISPLAY[fieldType];
        if (!displayName) return;
        // Skip if we already have this display name
        if (boxes.some((b) => b.fieldName === displayName)) return;

        const vd = sf.ValueDetection ?? {};
        let text = (vd.Text ?? "").trim();
        const confidence = vd.Confidence ?? 0;
        const bb = normaliseBB(vd.Geometry?.BoundingBox);
        if (!bb || !text) return;

        let cleanedText = text;
        
        if (displayName === "Vendor GST Number") {
          cleanedText = cleanGSTNumber(text);
          if (!cleanedText || cleanedText.length < 14) return;
        } else if (displayName === "Vendor Phone Number") {
          const { text: cleanedPhone, isHelpline } = extractVendorPhoneNumber(text, displayName);
          if (isHelpline || !cleanedPhone) return;
          if (processedPhones.has(cleanedPhone)) return;
          cleanedText = cleanedPhone;
          processedPhones.add(cleanedPhone);
        } else if (displayName === "Vendor Address") {
          cleanedText = formatAddressText(text);
        }

        boxes.push({
          id: `lig-${ligIdx}-${sfIdx}`,
          fieldName: displayName,
          text: text,
          cleanedText: cleanedText,
          confidence,
          bb,
        });
      });
    });
  });

  // ── Fallback: scan raw Blocks for GST if not found above ──
  if (!boxes.some((b) => b.fieldName === "Vendor GST Number")) {
    (textractResponse.Blocks ?? []).forEach((block, idx) => {
      const text = (block.Text ?? "").trim();
      if (!text) return;
      const cleanedGST = cleanGSTNumber(text);
      if (cleanedGST && cleanedGST.length === 15) {
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i;
        if (gstRegex.test(cleanedGST)) {
          const bb = normaliseBB(block.Geometry?.BoundingBox);
          if (!bb) return;
          boxes.push({
            id: `block-gst-${idx}`,
            fieldName: "Vendor GST Number",
            text: text,
            cleanedText: cleanedGST,
            confidence: block.Confidence ?? 0,
            bb,
          });
        }
      }
    });
  }

  console.debug(`[InvoicePreview] Extracted ${boxes.length} field bounding boxes`);
  return boxes;
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TESTING
// Bounding boxes from Textract are in NORMALISED coordinates (0–1 relative to
// image dimensions). We convert to pixels for hit testing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a normalised Textract BB to pixel coords within the natural image.
 */
function bbToPixels(bb, naturalWidth, naturalHeight) {
  return {
    x: bb.Left * naturalWidth,
    y: bb.Top * naturalHeight,
    w: bb.Width * naturalWidth,
    h: bb.Height * naturalHeight,
  };
}

/**
 * Find the field whose bounding box contains (px, py), or the closest one
 * within `threshold` pixels. Returns null if nothing is close enough.
 */
function hitTest(boxes, px, py, naturalWidth, naturalHeight, threshold = 20) {
  let best = null;
  let bestDist = Infinity;

  boxes.forEach((box) => {
    const { x, y, w, h } = bbToPixels(box.bb, naturalWidth, naturalHeight);

    // Exact hit
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      const dist = 0;
      if (dist < bestDist) { bestDist = dist; best = box; }
      return;
    }

    // Distance to rectangle edge
    const dx = Math.max(x - px, 0, px - (x + w));
    const dy = Math.max(y - py, 0, py - (y + h));
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold && dist < bestDist) {
      bestDist = dist;
      best = box;
    }
  });

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS DRAWING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw all bounding boxes onto the canvas.
 * The canvas is positioned absolutely over the <img> element and shares its
 * exact CSS dimensions — so we just map normalised coords → canvas pixels.
 */
function drawBoxes({ ctx, canvasW, canvasH, boxes, activeField, hoveredField, showAllBoxes }) {
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Determine which boxes to draw
  let toDraw = [];
  if (activeField) {
    // Always draw the active field; also show all others faded when showAllBoxes
    toDraw = boxes;
  } else if (showAllBoxes) {
    toDraw = boxes;
  }
  // If neither, draw nothing (clean image)

  toDraw.forEach((box) => {
    const isActive  = box.fieldName === activeField;
    const isHovered = box.fieldName === hoveredField && !isActive;
    const color     = getFieldColor(box.fieldName);

    // Pixel rect — normalised coords map directly to canvas size
    const rx = box.bb.Left   * canvasW;
    const ry = box.bb.Top    * canvasH;
    const rw = box.bb.Width  * canvasW;
    const rh = box.bb.Height * canvasH;

    let fillAlpha  = 0.12;
    let strokeAlpha = 0.6;
    let lineWidth  = 1.5;

    if (isActive) {
      fillAlpha   = 0.30;
      strokeAlpha = 1.0;
      lineWidth   = 3;
    } else if (isHovered) {
      fillAlpha   = 0.20;
      strokeAlpha = 0.85;
      lineWidth   = 2;
    } else if (activeField) {
      // Non-active boxes when an active field exists — draw very faint
      fillAlpha   = 0.05;
      strokeAlpha = 0.25;
      lineWidth   = 1;
    }

    // Fill
    ctx.save();
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();

    // Stroke
    ctx.save();
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (isActive) {
      // Dashed outline for active field so it really pops
      ctx.setLineDash([6, 3]);
    }
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();

    // Label pill for active / hovered boxes
    if (isActive || isHovered) {
      const label = `${box.fieldName}${box.confidence ? ` · ${Math.round(box.confidence)}%` : ""}`;
      const fontSize = Math.max(10, Math.min(13, rw / 8));
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      const textW = ctx.measureText(label).width;
      const pillH = fontSize + 8;
      const pillW = textW + 16;
      const pillX = rx;
      const pillY = ry - pillH - 4 < 0 ? ry + rh + 4 : ry - pillH - 4;

      // Pill background
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.restore();

      // Pill text
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.fillText(label, pillX + 8, pillY + fontSize + 2);
      ctx.restore();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const InvoicePreviewWithHighlights = ({
  imageUrl,
  textractResponse,
  activeField,           // display-name string, e.g. "Bill Number"
  onFieldClick,          // (displayName: string) => void
  zoomLevel = 1,
  rotateAngle = 0,
  showAllBoxes = false,
  highlightColor = "#4f46e5",
  borderWidth = 2,
}) => {
  const [naturalSize, setNaturalSize]   = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize]   = useState({ w: 0, h: 0 });
  const [boxes, setBoxes]               = useState([]);
  const [hoveredField, setHoveredField] = useState(null);
  const [imageLoaded, setImageLoaded]   = useState(false);

  const imageRef    = useRef(null);
  const canvasRef   = useRef(null);
  const containerRef = useRef(null);
  const boxesRef    = useRef([]);          // sync ref so event handlers see latest

  // ── Extract boxes whenever response changes ──────────────────────────────
  useEffect(() => {
    if (!textractResponse) { setBoxes([]); boxesRef.current = []; return; }
    const extracted = extractFieldBoxes(textractResponse);
    setBoxes(extracted);
    boxesRef.current = extracted;
    console.debug("[InvoicePreview] Boxes set:", extracted);
  }, [textractResponse]);

  // ── Capture image natural + display dimensions on load ───────────────────
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setDisplaySize({ w: img.clientWidth,  h: img.clientHeight  });
    setImageLoaded(true);
  }, []);

  // Update display size on window resize
  useEffect(() => {
    const onResize = () => {
      const img = imageRef.current;
      if (img && imageLoaded) setDisplaySize({ w: img.clientWidth, h: img.clientHeight });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [imageLoaded]);

  // ── Sync canvas size to image display size ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displaySize.w) return;
    canvas.width  = displaySize.w;
    canvas.height = displaySize.h;
  }, [displaySize]);

  // ── Draw bounding boxes ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded || !displaySize.w) return;
    const ctx = canvas.getContext("2d");
    drawBoxes({
      ctx,
      canvasW: displaySize.w,
      canvasH: displaySize.h,
      boxes,
      activeField,
      hoveredField,
      showAllBoxes,
    });
  }, [boxes, displaySize, activeField, hoveredField, showAllBoxes, imageLoaded]);

  // ── Auto-scroll to active field ──────────────────────────────────────────
  useEffect(() => {
    if (!activeField || !imageLoaded || !containerRef.current || !displaySize.w) return;
    const activeBoxes = boxesRef.current.filter((b) => b.fieldName === activeField);
    if (!activeBoxes.length) return;
    const box = activeBoxes[0];
    const rx = box.bb.Left  * displaySize.w;
    const ry = box.bb.Top   * displaySize.h;
    const rw = box.bb.Width * displaySize.w;
    const rh = box.bb.Height* displaySize.h;
    const container = containerRef.current;
    container.scrollTo({
      left: Math.max(0, rx + rw / 2 - container.clientWidth  / 2),
      top:  Math.max(0, ry + rh / 2 - container.clientHeight / 2),
      behavior: "smooth",
    });
  }, [activeField, imageLoaded, displaySize]);

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleImageClick = useCallback((e) => {
    if (!imageRef.current || !onFieldClick || !naturalSize.w) return;
    const rect = imageRef.current.getBoundingClientRect();
    // Click position relative to displayed image
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Convert to normalised coords (0–1) to match Textract bounding boxes
    const nx = cx / rect.width;
    const ny = cy / rect.height;
    // Convert normalised → natural pixels for hit test
    const px = nx * naturalSize.w;
    const py = ny * naturalSize.h;

    const hit = hitTest(boxesRef.current, px, py, naturalSize.w, naturalSize.h, 30);
    if (hit) {
      console.debug("[InvoicePreview] Clicked field:", hit.fieldName);
      onFieldClick(hit.fieldName);
    }
  }, [naturalSize, onFieldClick]);

  // ── Hover handler ─────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!imageRef.current || !naturalSize.w) return;
    const rect = imageRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top)  / rect.height;
    const px = nx * naturalSize.w;
    const py = ny * naturalSize.h;
    const hit = hitTest(boxesRef.current, px, py, naturalSize.w, naturalSize.h, 20);
    setHoveredField(hit?.fieldName ?? null);
  }, [naturalSize]);

  const handleMouseLeave = useCallback(() => setHoveredField(null), []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const fieldCount = [...new Set(boxes.map((b) => b.fieldName))].length;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "auto",
        background: "#f8fafc",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        boxSizing: "border-box",
      }}
    >
      {/* ── Image + canvas wrapper ─────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          display: "inline-block",
          minWidth: "100%",
          transform: `scale(${zoomLevel}) rotate(${rotateAngle}deg)`,
          transformOrigin: "top left",
          transition: "transform 0.25s ease",
        }}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Invoice"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            cursor: hoveredField ? "pointer" : "crosshair",
          }}
          onLoad={handleImageLoad}
          onClick={handleImageClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          draggable={false}
        />

        {/* Canvas overlaid exactly on top of the image */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />

        {/* Loading spinner */}
        {!imageLoaded && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(248,250,252,0.85)",
              fontSize: 28, color: "#4f46e5",
            }}
          >
            <span style={{ animation: "ipSpin 1s linear infinite", display: "inline-block" }}>⟳</span>
          </div>
        )}
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, padding: "8px 4px 4px", flexWrap: "wrap" }}>
        <span
          style={{
            background: "#fff", border: "1px solid #e2e8f0",
            borderRadius: 20, padding: "4px 12px", fontSize: 11, color: "#475569",
          }}
        >
          {fieldCount} field{fieldCount !== 1 ? "s" : ""} detected
          {activeField && <> &nbsp;·&nbsp; <strong style={{ color: getFieldColor(activeField) }}>{activeField}</strong></>}
        </span>

        {/* Colour legend */}
        {boxes.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[...new Set(boxes.map((b) => b.fieldName))].map((name) => (
              <span
                key={name}
                title={name}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "#fff", border: `1px solid ${getFieldColor(name)}`,
                  borderRadius: 20, padding: "3px 8px", fontSize: 10, color: "#334155",
                  cursor: "pointer",
                  fontWeight: activeField === name ? 700 : 400,
                  boxShadow: activeField === name ? `0 0 0 2px ${getFieldColor(name)}40` : "none",
                }}
                onClick={() => onFieldClick?.(name)}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: getFieldColor(name), flexShrink: 0,
                  }}
                />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes ipSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default InvoicePreviewWithHighlights;