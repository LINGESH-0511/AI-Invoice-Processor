// =============================================================================
// boundingBoxUtils.js  —  v9.3.0
//
// Synced with processor.py v9.3 and textract_service.py v9.1.
//
// CHANGES vs v9.2
// ──────────────────────────────────────────────────────────────────────────────
// v9.3-1  Invoice Date bounding box — always returned even when value includes
//         time (e.g. "29-04-2018 & 09:02:38 PM"). Text is no longer validated
//         against a date-only pattern for bbox purposes; any non-empty value
//         from the date field types is accepted.
//
// v9.3-2  Address bounding box — UNION bounding box computed when the address
//         spans multiple Textract blocks (header + street + city lines).
//         computeUnionBBox(boxes) returns the smallest box enclosing all of them.
//
// v9.3-3  Address bounding box — spatial Top-to-Bottom ordering of address
//         lines is preserved when assembling the composite bbox.
//
// v9.3-4  Bidirectional highlighting — getAllFieldBoundingBoxesForHitTest()
//         returns [{fieldName, boundingBox}] in normalised fractional coords.
//         Use getClosestFieldToClick() with these entries to map image clicks
//         back to field names (image -> field direction).
//
// v9.3-5  Phone — Ph: / Tel: landline detection in raw Blocks fallback.
//         Lines matching /^(?:Ph|Tel|Phone|Mob)[\s:.#]*(0\d{2,4})[\s-]\d/
//         now extract the STD landline number correctly.
//
// v9.3-6  Address — formatAddressForDisplay no longer strips the vendor name
//         from the start (processor.py v9.3 intentionally prepends it).
//         stripVendorNameFromAddress is kept for backward compat but is not
//         called during address display.
//
// ALL AWS TEXTRACT FEATURES USED
// ──────────────────────────────────────────────────────────────────────────────
//  ExpenseDocuments.SummaryFields   — primary field extraction
//  GroupProperties (VENDOR/RECEIVER)— group-aware extraction
//  ValueDetection.Geometry.BoundingBox — field position on page
//  ValueDetection.Geometry.Polygon  — 4-point polygon for skew detection
//  LabelDetection.Text              — label disambiguation (Ph:, GST:, etc.)
//  LineItemGroups                   — secondary bbox source
//  DetectDocumentText Blocks        — tertiary bbox (GST, phone, address lines)
//  TextType (PRINTED/HANDWRITING)   — prefer PRINTED blocks
//  Confidence scores                — displayed per field
//  PageNumber                       — page-1 priority
//  FormKeyValues                    — quaternary bbox source (FORMS layer)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS  (mirrors processor.py MIN_CONFIDENCE)
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_CONFIDENCE = {
  vendor_gst:     80.0,
  total_amount:   70.0,
  invoice_date:   65.0,
  bill_number:    60.0,
  vendor_phone:   55.0,
  vendor_name:    45.0,
  vendor_address: 40.0,
};

export const MAX_CONFIDENCE = 99.0;

// ─────────────────────────────────────────────────────────────────────────────
// GST VALIDATION  (mirrors processor.py GST_STRICT + GST_LOOSE)
// ─────────────────────────────────────────────────────────────────────────────

export const isGstFormat = (text) => {
  if (!text) return false;
  const cleaned = String(text).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 15) return false;
  const state = parseInt(cleaned.slice(0, 2), 10);
  if (isNaN(state) || state < 1 || state > 38) return false;
  const strict = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[0-9A-Z]$/;
  if (strict.test(cleaned)) return true;
  const loose  = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][0-9A-Z]$/;
  return loose.test(cleaned);
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPLINE DETECTION  (mirrors processor.py _is_helpline)
// ─────────────────────────────────────────────────────────────────────────────

export const isHelpline = (text) => {
  if (!text) return false;
  const digits = String(text).replace(/\D/g, "");
  if (digits.length < 7) return true;
  if (
    digits.startsWith("1800") || digits.startsWith("1860") ||
    digits.startsWith("1890") || digits.startsWith("0800") ||
    digits.startsWith("0900")
  ) return true;
  return ["112","100","101","102","104","108","1098","181","1091"].includes(digits);
};

// ─────────────────────────────────────────────────────────────────────────────
// v9.3: DATE — strip time portion (mirrors processor.py extract_date_only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip time from a datetime string, returning only the date part.
 * Handles: "29-04-2018 & 09:02:38 PM", "2024-04-12 21:26:06",
 *          "17/11/2024 14:14", "04/12/2024 @ 09:15"
 */
export const extractDateOnly = (text) => {
  if (!text) return text;
  const t = String(text).trim();

  // "dd-mm-yyyy & HH:MM..."  or  "dd-mm-yyyy @ HH:MM..."
  let m = t.match(/^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*[&@]\s*\d{1,2}:\d{2}/);
  if (m) return m[1];

  // "yyyy-mm-dd HH:MM..."  (ISO)
  m = t.match(/^(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})[T\s]\d{1,2}:\d{2}/);
  if (m) return m[1];

  // "dd-mm-yyyy HH:MM"
  m = t.match(/^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+\d{1,2}:\d{2}/);
  if (m) return m[1];

  return t;
};

// ─────────────────────────────────────────────────────────────────────────────
// GST CLEANING
// ─────────────────────────────────────────────────────────────────────────────

export const cleanGSTNumber = (text) => {
  if (!text) return "";
  let s = String(text)
    .replace(/W\.?\s*E\.?\s*F\.?\s*[\d\.\/\-]+/gi, "")
    .replace(/WEF\s*[\d\.\/\-]+/gi, "")
    .replace(/effective\s*from\s*[\d\.\/\-]+/gi, "");
  const m = s.replace(/[\s\-]/g, "").toUpperCase().match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[A-Z0-9]{1}[0-9A-Z]{1}/);
  if (m) return m[0];
  const m2 = s.replace(/[\s\-]/g, "").toUpperCase().match(/[A-Z0-9]{15}/);
  return m2 ? m2[0] : s.replace(/[\s\-]/g, "").toUpperCase().slice(0, 15);
};

// ─────────────────────────────────────────────────────────────────────────────
// PHONE CLEANING  (v9.3: landline with STD code + internal space)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract phone number from a line that may carry a label prefix
 * (Ph:, Tel:, Mob:, etc.) and may contain landline with spaces.
 * Returns digits only (normalized), or null.
 */
export const extractPhoneFromLabelLine = (text) => {
  if (!text) return null;
  // Strip label prefix
  const rest = text.replace(
    /^(?:Ph|Tel|Tele|Phone|Mob|Mobile|Cell|Contact|Fax|Helpline|Whatsapp)[\s:\.#]*/i,
    ""
  ).trim();
  if (!rest) return null;

  // STD landline with internal space: 044-4855 5525 or 044 4855 5525
  let m = rest.match(/^(0\d{2,4})[\s\-](\d{3,5})[\s\-](\d{3,5})/);
  if (m) {
    const digits = m[1] + m[2] + m[3];
    if (digits.length >= 9 && digits.length <= 12) return digits;
  }
  // STD landline no space: 044-48555525
  m = rest.match(/^(0\d{2,4})[\s\-](\d{6,8})/);
  if (m) {
    const digits = m[1] + m[2];
    if (digits.length >= 9 && digits.length <= 12) return digits;
  }
  // Mobile with +91 or 0 prefix
  m = rest.match(/^(?:\+91[\s\-]?|0)?([6-9]\d{9})/);
  if (m) return m[1];
  // Bare 10-digit
  m = rest.match(/^(\d{10})/);
  if (m) return m[1];

  return null;
};

export const cleanPhoneNumber = (phone) => {
  if (!phone) return "";
  const s = String(phone);
  if (isHelpline(s)) return "";
  const m = s.match(/[0-9\-\(\)\s+]{8,15}/);
  return m ? m[0].trim() : s;
};

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS VENDOR-NAME STRIP  (kept for backward compat — v9.3 prepends name)
// ─────────────────────────────────────────────────────────────────────────────

export const stripVendorNameFromAddress = (address, vendorName) => {
  if (!address || !vendorName) return address;
  const addrClean = String(address).trim();
  const nameClean = String(vendorName).trim();

  if (addrClean.toLowerCase().startsWith(nameClean.toLowerCase())) {
    const rest = addrClean.slice(nameClean.length).replace(/^[\s,\-/]+/, "").trim();
    if (rest && rest.length >= 5) return rest;
  }

  const nameWords = new Set(
    nameClean.toUpperCase().match(/[A-Z0-9]+/g)?.filter((w) => w.length > 2) ?? []
  );
  if (nameWords.size === 0) return addrClean;

  const addrUpper = addrClean.toUpperCase();
  const addrTokens = addrUpper.match(/[A-Z0-9]+/g) ?? [];
  const foundWords = new Set();
  let charPos = 0;

  for (const word of addrTokens) {
    if (nameWords.has(word)) foundWords.add(word);
    const idx = addrUpper.indexOf(word, charPos);
    if (idx >= 0) charPos = idx + word.length;
    if (foundWords.size >= nameWords.size) {
      const rest = addrClean.slice(charPos).replace(/^[\s,\-/]+/, "").trim();
      if (rest && rest.length >= 5) return rest;
      break;
    }
  }

  return addrClean;
};

/**
 * Format address for display.
 * v9.3: vendor name is already prepended by processor.py — do NOT strip it.
 */
export const formatAddressForDisplay = (address, _vendorName = "") => {
  if (!address) return "";
  let s = String(address);
  s = s.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
  return s;
};

// ─────────────────────────────────────────────────────────────────────────────
// v9.3: UNION BOUNDING BOX (covers all address blocks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the smallest bounding box that encloses all provided boxes.
 * All boxes must have Left, Top, Width, Height (fractional page coords).
 */
export const computeUnionBBox = (boxes) => {
  if (!boxes || boxes.length === 0) return null;
  const valid = boxes.filter(
    (b) => b && b.Left != null && b.Top != null && b.Width != null && b.Height != null
  );
  if (valid.length === 0) return null;

  const minLeft   = Math.min(...valid.map((b) => b.Left));
  const minTop    = Math.min(...valid.map((b) => b.Top));
  const maxRight  = Math.max(...valid.map((b) => b.Left + b.Width));
  const maxBottom = Math.max(...valid.map((b) => b.Top  + b.Height));

  return {
    Left:   minLeft,
    Top:    minTop,
    Width:  maxRight  - minLeft,
    Height: maxBottom - minTop,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPE → DISPLAY NAME MAP  (synced with processor.py v9.3 FIELD_MAPPING)
// ─────────────────────────────────────────────────────────────────────────────

export const TYPE_TO_DISPLAY = {
  // Bill Number
  INVOICE_RECEIPT_ID:"Bill Number", RECEIPT_ID:"Bill Number", INVOICE_ID:"Bill Number",
  BILL_NUMBER:"Bill Number", BILL_NO:"Bill Number", INVOICE_NUMBER:"Bill Number",
  INVOICE_NO:"Bill Number", RECEIPT_NUMBER:"Bill Number", RECEIPT_NO:"Bill Number",
  ORDER_NUMBER:"Bill Number", ORDER_ID:"Bill Number", ORDER_NO:"Bill Number",
  DOCUMENT_ID:"Bill Number", DOCUMENT_NUMBER:"Bill Number", DOC_NO:"Bill Number",
  REFERENCE_NUMBER:"Bill Number", REFERENCE_NO:"Bill Number", REF_NO:"Bill Number",
  REF_NUMBER:"Bill Number", REFERENCE_ID:"Bill Number",
  POS_ID:"Bill Number", POS_NUMBER:"Bill Number", POS_NO:"Bill Number",
  TOKEN_NUMBER:"Bill Number", TOKEN_NO:"Bill Number", TOKEN_ID:"Bill Number",
  CHALLAN_NUMBER:"Bill Number", CHALLAN_NO:"Bill Number", CHALLAN_ID:"Bill Number",
  CHALAN_NUMBER:"Bill Number", CHALAN_NO:"Bill Number",
  VOUCHER_NUMBER:"Bill Number", VOUCHER_NO:"Bill Number", VOUCHER_ID:"Bill Number",
  BOOKING_ID:"Bill Number", BOOKING_NUMBER:"Bill Number", BOOKING_NO:"Bill Number",
  TRANSACTION_ID:"Bill Number", TXN_ID:"Bill Number", TXN_NO:"Bill Number",
  TRANSACTION_NUMBER:"Bill Number", TRANSACTION_NO:"Bill Number",
  JOB_NUMBER:"Bill Number", JOB_NO:"Bill Number", JOB_ID:"Bill Number",
  WORK_ORDER:"Bill Number", WORK_ORDER_NO:"Bill Number",
  DELIVERY_NOTE:"Bill Number", DELIVERY_NO:"Bill Number",
  DISPATCH_NO:"Bill Number", DISPATCH_NUMBER:"Bill Number",
  MEMO_NUMBER:"Bill Number", MEMO_NO:"Bill Number",
  PROFORMA_NUMBER:"Bill Number", PROFORMA_NO:"Bill Number", PI_NUMBER:"Bill Number",
  QUOTATION_NUMBER:"Bill Number", QUOTATION_NO:"Bill Number",
  SLIP_NUMBER:"Bill Number", SLIP_NO:"Bill Number",
  TICKET_NUMBER:"Bill Number", TICKET_NO:"Bill Number", TICKET_ID:"Bill Number",
  CASH_MEMO_NO:"Bill Number", CASH_BILL_NO:"Bill Number", CASH_MEMO:"Bill Number",
  SERIAL_NUMBER:"Bill Number", SERIAL_NO:"Bill Number", SR_NO:"Bill Number",
  ESTIMATE_NUMBER:"Bill Number", ESTIMATE_NO:"Bill Number",
  PURCHASE_ORDER:"Bill Number", PO_NUMBER:"Bill Number", PO_NO:"Bill Number",
  DEBIT_NOTE_NO:"Bill Number", CREDIT_NOTE_NO:"Bill Number",
  GRN_NUMBER:"Bill Number", GRN_NO:"Bill Number",
  AWB_NUMBER:"Bill Number", AWB_NO:"Bill Number",
  LR_NUMBER:"Bill Number", LR_NO:"Bill Number",
  KOT_NUMBER:"Bill Number", KOT_NO:"Bill Number", KOT_ID:"Bill Number",
  TABLE_NUMBER:"Bill Number", TABLE_NO:"Bill Number",
  // Vendor Name
  VENDOR_NAME:"Vendor Name", MERCHANT_NAME:"Vendor Name", STORE_NAME:"Vendor Name",
  SUPPLIER_NAME:"Vendor Name", SELLER_NAME:"Vendor Name", BILL_FROM:"Vendor Name",
  COMPANY_NAME:"Vendor Name", BUSINESS_NAME:"Vendor Name", TRADING_NAME:"Vendor Name",
  SHOP_NAME:"Vendor Name", ESTABLISHMENT_NAME:"Vendor Name", RESTAURANT_NAME:"Vendor Name",
  HOTEL_NAME:"Vendor Name", RETAILER_NAME:"Vendor Name", DISTRIBUTOR_NAME:"Vendor Name",
  TRADE_NAME:"Vendor Name", BRAND_NAME:"Vendor Name", PROPRIETOR_NAME:"Vendor Name",
  MANUFACTURER_NAME:"Vendor Name", OPERATOR_NAME:"Vendor Name",
  SERVICE_PROVIDER:"Vendor Name", ISSUED_BY:"Vendor Name", SOLD_BY:"Vendor Name",
  FIRM_NAME:"Vendor Name", AGENCY_NAME:"Vendor Name", OUTLET_NAME:"Vendor Name",
  CLINIC_NAME:"Vendor Name", HOSPITAL_NAME:"Vendor Name", PHARMACY_NAME:"Vendor Name",
  SCHOOL_NAME:"Vendor Name",
  // Vendor Address
  VENDOR_ADDRESS:"Vendor Address", ADDRESS:"Vendor Address",
  MERCHANT_ADDRESS:"Vendor Address", BILL_FROM_ADDRESS:"Vendor Address",
  SUPPLIER_ADDRESS:"Vendor Address", SELLER_ADDRESS:"Vendor Address",
  COMPANY_ADDRESS:"Vendor Address", BUSINESS_ADDRESS:"Vendor Address",
  STREET_ADDRESS:"Vendor Address", LOCATION:"Vendor Address",
  REGISTERED_ADDRESS:"Vendor Address", CORPORATE_ADDRESS:"Vendor Address",
  SHOP_ADDRESS:"Vendor Address", HEAD_OFFICE_ADDRESS:"Vendor Address",
  REGD_ADDRESS:"Vendor Address", BRANCH_ADDRESS:"Vendor Address",
  FACTORY_ADDRESS:"Vendor Address", OFFICE_ADDRESS:"Vendor Address",
  // Vendor Phone
  VENDOR_PHONE:"Vendor Phone Number", PHONE:"Vendor Phone Number",
  TELEPHONE:"Vendor Phone Number", TEL:"Vendor Phone Number",
  TELE_NUMBER:"Vendor Phone Number", MOBILE:"Vendor Phone Number",
  MOBILE_NUMBER:"Vendor Phone Number", CONTACT:"Vendor Phone Number",
  CONTACT_NUMBER:"Vendor Phone Number", CONTACT_NO:"Vendor Phone Number",
  PHONE_NUMBER:"Vendor Phone Number", PHONE_NO:"Vendor Phone Number",
  CELL:"Vendor Phone Number", CELL_PHONE:"Vendor Phone Number",
  LANDLINE:"Vendor Phone Number", OFFICE_PHONE:"Vendor Phone Number",
  WHATSAPP:"Vendor Phone Number", WHATSAPP_NUMBER:"Vendor Phone Number",
  WHATSAPP_NO:"Vendor Phone Number", FAX:"Vendor Phone Number",
  FAX_NUMBER:"Vendor Phone Number", FAX_NO:"Vendor Phone Number",
  HELPLINE:"Vendor Phone Number", HELPDESK:"Vendor Phone Number",
  HELPDESK_NO:"Vendor Phone Number", TOLL_FREE:"Vendor Phone Number",
  TOLLFREE:"Vendor Phone Number", MOB:"Vendor Phone Number",
  MOB_NO:"Vendor Phone Number", MOB_NUMBER:"Vendor Phone Number",
  PH:"Vendor Phone Number", PH_NO:"Vendor Phone Number",
  PH_NUMBER:"Vendor Phone Number", TEL_NO:"Vendor Phone Number",
  TELE_NO:"Vendor Phone Number", OFFICE_NO:"Vendor Phone Number",
  OFFICE_NUMBER:"Vendor Phone Number", DIRECT_LINE:"Vendor Phone Number",
  CUSTOMER_CARE:"Vendor Phone Number", SUPPORT_NUMBER:"Vendor Phone Number",
  ENQUIRY:"Vendor Phone Number", ENQUIRY_NUMBER:"Vendor Phone Number",
  ENQUIRY_NO:"Vendor Phone Number", CALL_US:"Vendor Phone Number",
  REACH_US:"Vendor Phone Number", CONTACT_US:"Vendor Phone Number",
  EMERGENCY:"Vendor Phone Number", EMERGENCY_NO:"Vendor Phone Number",
  // Vendor GST
  GST_NUMBER:"Vendor GST Number", GST:"Vendor GST Number", GSTIN:"Vendor GST Number",
  TAX_ID:"Vendor GST Number", VAT_NUMBER:"Vendor GST Number", VAT:"Vendor GST Number",
  CST_NUMBER:"Vendor GST Number", CST:"Vendor GST Number", TAX_NUMBER:"Vendor GST Number",
  TIN_NUMBER:"Vendor GST Number", TIN:"Vendor GST Number", PAN_NUMBER:"Vendor GST Number",
  REGISTRATION_NUMBER:"Vendor GST Number", GST_NO:"Vendor GST Number",
  GSTIN_NO:"Vendor GST Number", GSTIN_NUMBER:"Vendor GST Number", GSTIN_ID:"Vendor GST Number",
  GST_REG:"Vendor GST Number", GST_REG_NO:"Vendor GST Number",
  GST_REGISTRATION:"Vendor GST Number", GST_REGISTRATION_NUMBER:"Vendor GST Number",
  VENDOR_GST:"Vendor GST Number", SELLER_GSTIN:"Vendor GST Number",
  SUPPLIER_GSTIN:"Vendor GST Number", MERCHANT_GSTIN:"Vendor GST Number",
  TAX_REGISTRATION:"Vendor GST Number", TAX_REG_NO:"Vendor GST Number",
  TAXPAYER_ID:"Vendor GST Number", COMPANY_GST:"Vendor GST Number",
  FIRM_GSTIN:"Vendor GST Number", SHOP_GSTIN:"Vendor GST Number",
  STORE_GSTIN:"Vendor GST Number", VAT_REG_NO:"Vendor GST Number",
  SERVICE_TAX_NO:"Vendor GST Number", EXCISE_NO:"Vendor GST Number",
  PAN:"Vendor GST Number",
  // Invoice Date
  INVOICE_RECEIPT_DATE:"Invoice Date", INVOICE_DATE:"Invoice Date",
  TRANSACTION_DATE:"Invoice Date", DATE:"Invoice Date", BILL_DATE:"Invoice Date",
  RECEIPT_DATE:"Invoice Date", DOCUMENT_DATE:"Invoice Date", ISSUE_DATE:"Invoice Date",
  CREATED_DATE:"Invoice Date", INVOICED_DATE:"Invoice Date", ORDER_DATE:"Invoice Date",
  PURCHASE_DATE:"Invoice Date", SERVICE_DATE:"Invoice Date", DATED:"Invoice Date",
  DATE_OF_INVOICE:"Invoice Date", DATE_OF_BILL:"Invoice Date",
  DATE_OF_RECEIPT:"Invoice Date", TX_DATE:"Invoice Date", TXN_DATE:"Invoice Date",
  TXDATE:"Invoice Date", VALUE_DATE:"Invoice Date", POSTING_DATE:"Invoice Date",
  RAISED_ON:"Invoice Date", PAYMENT_DATE:"Invoice Date", SALE_DATE:"Invoice Date",
  DISPATCH_DATE:"Invoice Date", SUPPLY_DATE:"Invoice Date", CHALLAN_DATE:"Invoice Date",
  VOUCHER_DATE:"Invoice Date", BOOKING_DATE:"Invoice Date", VISIT_DATE:"Invoice Date",
  CHECK_IN:"Invoice Date", BILLING_DATE:"Invoice Date", TAX_DATE:"Invoice Date",
  // Total Amount
  TOTAL:"Total Amount", AMOUNT_DUE:"Total Amount", GRAND_TOTAL:"Total Amount",
  NET_AMOUNT:"Total Amount", TOTAL_AMOUNT:"Total Amount", BILL_AMOUNT:"Total Amount",
  INVOICE_TOTAL:"Total Amount", AMOUNT_PAYABLE:"Total Amount", TOTAL_DUE:"Total Amount",
  BALANCE_DUE:"Total Amount", NET_TOTAL:"Total Amount", TOTAL_BILL:"Total Amount",
  FINAL_TOTAL:"Total Amount", TOTAL_WITH_TAX:"Total Amount", TOTAL_AMOUNT_DUE:"Total Amount",
  NET_PAYABLE:"Total Amount", PAYABLE_AMOUNT:"Total Amount",
  NET_PAYABLE_AMOUNT:"Total Amount", NET_DUE:"Total Amount",
  TOTAL_PAYABLE:"Total Amount", FINAL_AMOUNT:"Total Amount", GROSS_TOTAL:"Total Amount",
  TOTAL_CHARGES:"Total Amount", TAXABLE_VALUE:"Total Amount",
  CHARGEABLE_AMOUNT:"Total Amount", AMOUNT_PAID:"Total Amount", GROSS_AMOUNT:"Total Amount",
  TOTAL_VALUE:"Total Amount", INVOICE_AMOUNT:"Total Amount", PAYABLE:"Total Amount",
  OUTSTANDING:"Total Amount", ROUNDED_TOTAL:"Total Amount", ROUND_OFF_AMOUNT:"Total Amount",
  AMOUNT_RECEIVED:"Total Amount", TOTAL_RECEIVABLE:"Total Amount",
  TOTAL_COST:"Total Amount", TOTAL_PRICE:"Total Amount", TOTAL_SUM:"Total Amount",
  TOTAL_NET:"Total Amount", BALANCE_PAYABLE:"Total Amount", BALANCE_AMOUNT:"Total Amount",
  RECEIPT_AMOUNT:"Total Amount", BILLED_AMOUNT:"Total Amount",
  CHARGED_AMOUNT:"Total Amount", INVOICE_VALUE:"Total Amount",
  TOTAL_INVOICE_VALUE:"Total Amount",
};

// Auto-generate inverse map
export const FIELD_TO_TEXTRACT_TYPES = {};
for (const [type, display] of Object.entries(TYPE_TO_DISPLAY)) {
  if (!FIELD_TO_TEXTRACT_TYPES[display]) FIELD_TO_TEXTRACT_TYPES[display] = [];
  FIELD_TO_TEXTRACT_TYPES[display].push(type);
}

export const getTextractTypesForField = (fieldName) =>
  FIELD_TO_TEXTRACT_TYPES[fieldName] ? [...FIELD_TO_TEXTRACT_TYPES[fieldName]] : [];

// ─────────────────────────────────────────────────────────────────────────────
// BOUNDING BOX PIXEL CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

export const calculateBoundingBoxPixels = (boundingBox, imageWidth, imageHeight) => {
  if (!boundingBox || !imageWidth || !imageHeight) return null;
  try {
    const L = boundingBox.Left  ?? boundingBox.left;
    const T = boundingBox.Top   ?? boundingBox.top;
    const W = boundingBox.Width ?? boundingBox.width;
    const H = boundingBox.Height?? boundingBox.height;
    if (L == null || T == null || W == null || H == null) return null;
    return { left: L*imageWidth, top: T*imageHeight, width: W*imageWidth, height: H*imageHeight };
  } catch (e) { console.error("calculateBoundingBoxPixels:", e); return null; }
};

export const calculateTransformedBoundingBox = (
  boundingBox, imageWidth, imageHeight, zoomLevel = 1, rotateAngle = 0
) => {
  if (!boundingBox || !imageWidth || !imageHeight) return null;
  try {
    const pixels = calculateBoundingBoxPixels(boundingBox, imageWidth, imageHeight);
    if (!pixels) return null;
    const z = { left: pixels.left*zoomLevel, top: pixels.top*zoomLevel,
                 width: pixels.width*zoomLevel, height: pixels.height*zoomLevel };
    const norm = ((rotateAngle % 360) + 360) % 360;
    if (norm === 0) return z;
    const cx = imageWidth*zoomLevel/2, cy = imageHeight*zoomLevel/2;
    switch (norm) {
      case 90:  return { left: cy-(z.top+z.height), top: z.left, width: z.height, height: z.width };
      case 180: return { left: cx*2-(z.left+z.width), top: cy*2-(z.top+z.height), width: z.width, height: z.height };
      case 270: return { left: z.top, top: cx*2-(z.left+z.width), width: z.height, height: z.width };
      default:  return z;
    }
  } catch (e) { console.error("calculateTransformedBoundingBox:", e); return null; }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: normalise bounding-box key casing
// ─────────────────────────────────────────────────────────────────────────────

function normaliseBBKeys(bb) {
  if (!bb || typeof bb !== "object") return null;
  const L = bb.Left??bb.left, T = bb.Top??bb.top, W = bb.Width??bb.width, H = bb.Height??bb.height;
  if (L == null || T == null || W == null || H == null) return null;
  return { Left:L, Top:T, Width:W, Height:H,
           text: bb.text??bb.Text??"",
           confidence: bb.confidence??bb.Confidence??0,
           source: bb.source??"",
           group: bb.group??"",
           polygon: bb.polygon??null };
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP PROPERTIES HELPER
// ─────────────────────────────────────────────────────────────────────────────

const getGroupType = (field) => {
  for (const gp of field?.GroupProperties ?? []) {
    const types = gp?.Types ?? [];
    if (types.length > 0) return types[0].toUpperCase();
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-FIELD BOUNDING BOX
// Uses all 4 Textract sources; special handling per field type
// ─────────────────────────────────────────────────────────────────────────────

export const getFieldBoundingBox = (textractResponse, fieldName, vendorName = "") => {
  try {
    if (!textractResponse) return null;
    const possibleTypes = getTextractTypesForField(fieldName);
    if (!possibleTypes.length) return null;

    const results = [];

    // ── Source 1 & 2: ExpenseDocuments ──────────────────────────────────────
    for (const doc of textractResponse.ExpenseDocuments ?? []) {
      for (const fld of doc.SummaryFields ?? []) {
        if (getGroupType(fld) === "RECEIVER") continue;
        if ((fld?.PageNumber ?? 1) !== 1) continue;

        const rawType = (fld?.Type?.Text ?? "").trim().toUpperCase().replace(/\s+/g, "_");
        if (!possibleTypes.includes(rawType)) continue;

        const vd      = fld.ValueDetection ?? {};
        let   text    = (vd.Text ?? "").trim();
        const conf    = vd.Confidence ?? 0;
        const bb      = vd.Geometry?.BoundingBox;
        const polygon = vd.Geometry?.Polygon ?? null;
        const typeConf = fld?.Type?.Confidence ?? 0;
        const groupType = getGroupType(fld) ?? "";
        if (!bb || !text) continue;

        // v9.3-1: Invoice Date — accept raw text (time will be stripped on display)
        if (fieldName === "Invoice Date") {
          text = extractDateOnly(text);  // strip time for display, but always return bbox
        }
        if (fieldName === "Vendor GST Number") {
          const c = cleanGSTNumber(text);
          if (!isGstFormat(c)) continue;
          text = c;
        }
        if (fieldName === "Vendor Phone Number") {
          const c = cleanPhoneNumber(text);
          if (!c || isHelpline(text)) continue;
          text = c;
        }
        if (fieldName === "Vendor Address") {
          text = formatAddressForDisplay(text, vendorName);
        }

        results.push({ ...bb, confidence: conf, type_confidence: typeConf,
                       text, fieldType: rawType, source: "analyze_expense",
                       group: groupType, polygon });
      }

      // Source 2: LineItemGroups
      for (const lig of doc.LineItemGroups ?? []) {
        for (const li of lig.LineItems ?? []) {
          for (const ef of li.LineItemExpenseFields ?? []) {
            const rawType = (ef?.Type?.Text ?? "").trim().toUpperCase().replace(/\s+/g, "_");
            if (!possibleTypes.includes(rawType)) continue;
            const vd   = ef.ValueDetection ?? {};
            let text   = (vd.Text ?? "").trim();
            const bb   = vd.Geometry?.BoundingBox;
            if (!bb || !text) continue;
            if (fieldName === "Invoice Date") text = extractDateOnly(text);
            if (fieldName === "Vendor GST Number") {
              const c = cleanGSTNumber(text);
              if (!isGstFormat(c)) continue;
              text = c;
            }
            results.push({ ...bb, confidence: vd.Confidence??0, text,
                           fieldType: rawType, source: "analyze_expense_line_item" });
          }
        }
      }
    }

    if (results.length > 0) {
      if (fieldName === "Vendor Phone Number") {
        const seen = new Set();
        const unique = results
          .filter((r) => r.text && !isHelpline(r.text) && !seen.has(r.text) && seen.add(r.text))
          .map(normaliseBBKeys).filter(Boolean);
        return unique.length > 0 ? unique : null;
      }
      // v9.3-2: Address — compute union bbox over all address blocks
      if (fieldName === "Vendor Address" && results.length > 1) {
        const sorted = [...results].sort((a, b) => (a.Top??a.top??0) - (b.Top??b.top??0));
        const union = computeUnionBBox(sorted);
        return union ? normaliseBBKeys({ ...union, text: results.map(r=>r.text).join(", "),
                                         confidence: Math.max(...results.map(r=>r.confidence)),
                                         source: "analyze_expense_union" }) : normaliseBBKeys(results[0]);
      }
      return normaliseBBKeys(results[0]);
    }

    // ── Source 3: DetectDocumentText Blocks (PRINTED, page 1) ───────────────
    const blocks = textractResponse.Blocks ?? [];
    const fallback = [];
    const PHONE_LABEL_RE = /^(?:Ph|Tel|Tele|Phone|Mob|Mobile|Cell|Contact|Fax|Helpline|Whatsapp)[\s:\.#]*/i;

    for (const block of blocks) {
      if (block.BlockType !== "LINE" && block.BlockType !== "WORD") continue;
      if (block.TextType && block.TextType !== "PRINTED") continue;
      if ((block.Page ?? 1) !== 1) continue;

      let   text = (block.Text ?? "").trim();
      const upperText = text.toUpperCase();
      const bb    = block.Geometry?.BoundingBox;
      const poly  = block.Geometry?.Polygon ?? null;
      const conf  = block.Confidence ?? 0;
      if (!text || !bb) continue;

      if (fieldName === "Vendor GST Number") {
        const c = cleanGSTNumber(text);
        if (isGstFormat(c)) {
          fallback.push({ ...bb, confidence: conf, text: c,
                          fieldType: "GST_BLOCK_FALLBACK", source: "detect_document_text", polygon: poly });
        }
        const gstMatches = text.replace(/[\s\-]/g,"").toUpperCase().match(/[A-Z0-9]{15}/g) ?? [];
        for (const cand of gstMatches) {
          const cc = cleanGSTNumber(cand);
          if (isGstFormat(cc) && !fallback.some(f => f.text === cc)) {
            fallback.push({ ...bb, confidence: conf, text: cc,
                            fieldType: "GST_INLINE_FALLBACK", source: "detect_document_text", polygon: poly });
          }
        }
        continue;
      }

      if (fieldName === "Vendor Phone Number") {
        // v9.3-5: Ph: / Tel: landline detection
        if (PHONE_LABEL_RE.test(text)) {
          const extracted = extractPhoneFromLabelLine(text);
          if (extracted && !isHelpline(extracted)) {
            fallback.push({ ...bb, confidence: conf, text: extracted,
                            fieldType: "PHONE_LABEL_FALLBACK", source: "detect_document_text", polygon: poly });
            continue;
          }
        }
        // Standard phone patterns
        const phoneRe = /(?:\+91[\s\-]?)?(?:0\d{2,4}[\s\-]?)?\d{6,10}/g;
        const matches = text.match(phoneRe) ?? [];
        for (const m of matches) {
          const c = cleanPhoneNumber(m);
          if (c && !isHelpline(m)) {
            fallback.push({ ...bb, confidence: conf, text: c.trim(),
                            fieldType: "PHONE_BLOCK_FALLBACK", source: "detect_document_text", polygon: poly });
          }
        }
        continue;
      }

      if (fieldName === "Invoice Date") {
        // v9.3-1: accept any block that looks date-like (even with time)
        const dateRe = /\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}/;
        if (dateRe.test(text)) {
          fallback.push({ ...bb, confidence: conf, text: extractDateOnly(text),
                          fieldType: "DATE_BLOCK_FALLBACK", source: "detect_document_text", polygon: poly });
        }
        continue;
      }

      if (fieldName === "Vendor Address") {
        const addrKw = /ADDRESS|LOCATION|STREET|ROAD|LANE|NAGAR|COLONY|COMPLEX|PLOT|SHOP|FLAT|BUILDING|FLOOR|SECTOR|BLOCK|BYPASS|CROSS/i;
        if (addrKw.test(upperText)) {
          fallback.push({ ...bb, confidence: conf,
                          text: formatAddressForDisplay(text, vendorName),
                          fieldType: "ADDRESS_BLOCK_FALLBACK", source: "detect_document_text", polygon: poly });
        }
        continue;
      }

      for (const type of possibleTypes) {
        const readable = type.replace(/_/g, " ");
        if (upperText.includes(type) || upperText.includes(readable)) {
          let finalText = text;
          if (fieldName === "Vendor GST Number")   finalText = cleanGSTNumber(text);
          if (fieldName === "Vendor Phone Number") finalText = cleanPhoneNumber(text);
          if (fieldName === "Invoice Date")        finalText = extractDateOnly(text);
          fallback.push({ ...bb, confidence: conf, text: finalText, fieldType: type,
                          source: "detect_document_text", polygon: poly });
          break;
        }
      }
    }

    if (fallback.length > 0) {
      if (fieldName === "Vendor Phone Number") {
        const seen = new Set();
        const unique = fallback
          .filter(r => r.text && !isHelpline(r.text) && !seen.has(r.text) && seen.add(r.text))
          .map(normaliseBBKeys).filter(Boolean);
        return unique.length > 0 ? unique : null;
      }
      // v9.3-2: Address union bbox from raw blocks
      if (fieldName === "Vendor Address" && fallback.length > 1) {
        const sorted = [...fallback].sort((a,b) => (a.Top??0)-(b.Top??0));
        const union = computeUnionBBox(sorted);
        return union ? normaliseBBKeys({ ...union, text: fallback.map(r=>r.text).join(", "),
                                         confidence: Math.max(...fallback.map(r=>r.confidence)),
                                         source: "detect_document_text_union" }) : normaliseBBKeys(fallback[0]);
      }
      return normaliseBBKeys(fallback[0]);
    }

    // ── Source 4: FormKeyValues ──────────────────────────────────────────────
    const fieldHints = {
      "Bill Number":         ["bill no","invoice no","receipt no","order no","ref no","token no","challan no","kot no","table no"],
      "Vendor Name":         ["vendor name","company name","shop name","firm name"],
      "Vendor Address":      ["address","vendor address","company address"],
      "Vendor Phone Number": ["phone","mobile","tel","mob","contact","whatsapp","ph"],
      "Vendor GST Number":   ["gstin","gst no","gst","tax id","pan"],
      "Invoice Date":        ["date","invoice date","bill date","receipt date"],
      "Total Amount":        ["total","grand total","net amount","bill amount","payable"],
    };
    const hints = fieldHints[fieldName] ?? [];
    for (const kv of textractResponse.FormKeyValues ?? []) {
      const keyLower = (kv.Key ?? "").toLowerCase();
      if (!hints.some(h => keyLower.includes(h))) continue;
      const valRaw  = (kv.Value ?? "").trim();
      const valConf = kv.Confidence ?? 0;
      const bbox    = kv.BoundingBox;
      if (!valRaw || !bbox) continue;
      let finalText = valRaw;
      if (fieldName === "Vendor GST Number") {
        const c = cleanGSTNumber(valRaw);
        if (!isGstFormat(c)) continue;
        finalText = c;
      }
      if (fieldName === "Vendor Phone Number") {
        if (isHelpline(valRaw)) continue;
        finalText = cleanPhoneNumber(valRaw);
      }
      if (fieldName === "Invoice Date") {
        finalText = extractDateOnly(valRaw);
      }
      if (fieldName === "Vendor Address") {
        finalText = formatAddressForDisplay(valRaw, vendorName);
      }
      return normaliseBBKeys({
        Left: bbox.Left??bbox.left, Top: bbox.Top??bbox.top,
        Width: bbox.Width??bbox.width, Height: bbox.Height??bbox.height,
        text: finalText, confidence: valConf, source: "analyze_document_forms",
      });
    }

    return null;
  } catch (e) {
    console.error("getFieldBoundingBox:", e);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ALL FIELD BOUNDING BOXES
// ─────────────────────────────────────────────────────────────────────────────

export const getAllFieldBoundingBoxes = (textractResponse, vendorName = "") => {
  const result = {};
  const FIELD_NAMES = [
    "Vendor Name", "Bill Number", "Total Amount", "Invoice Date",
    "Vendor GST Number", "Vendor Phone Number", "Vendor Address",
  ];

  try {
    const backendBoxes =
      textractResponse?.field_bounding_boxes ??
      textractResponse?.fieldBoundingBoxes ?? {};

    for (const fieldName of FIELD_NAMES) {
      let box = backendBoxes[fieldName] ?? null;

      if (box) {
        if (fieldName === "Vendor Phone Number") {
          const list = Array.isArray(box) ? box : [box];
          const valid = list
            .filter(b => b && !isHelpline(b.text??b.Text??""))
            .map(b => { const n = normaliseBBKeys(b); if(n) n.text = cleanPhoneNumber(n.text)||n.text; return n; })
            .filter(Boolean);
          box = valid.length > 0 ? valid : null;
        } else if (fieldName === "Vendor GST Number") {
          const rawText = (box.text??box.Text??"").replace(/[^A-Z0-9]/gi,"").toUpperCase();
          const cleaned = cleanGSTNumber(rawText);
          if (!isGstFormat(cleaned)) { box = null; }
          else { box = normaliseBBKeys(box); if (box) box.text = cleaned; }
        } else if (fieldName === "Invoice Date") {
          // v9.3-1: strip time from date text
          box = normaliseBBKeys(box);
          if (box?.text) box.text = extractDateOnly(box.text);
        } else if (fieldName === "Vendor Address") {
          box = normaliseBBKeys(box);
          if (box?.text) box.text = formatAddressForDisplay(box.text, vendorName);
        } else if (fieldName === "Vendor Name") {
          box = normaliseBBKeys(box);
          if (box?.text && !vendorName) vendorName = box.text;
        } else {
          box = normaliseBBKeys(box);
        }
      }

      if (!box) {
        box = getFieldBoundingBox(textractResponse, fieldName, vendorName);
      }

      if (box) {
        if (Array.isArray(box)) {
          result[fieldName] = box.map(normaliseBBKeys).filter(Boolean);
        } else {
          result[fieldName] = normaliseBBKeys(box);
        }
      }
    }
  } catch (e) {
    console.warn("getAllFieldBoundingBoxes error:", e);
  }

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// v9.3-4: BIDIRECTIONAL HIT-TEST — image click -> field name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns [{fieldName, boundingBox}] in normalised fractional coords.
 * Use with getClosestFieldToClick() for image -> field highlighting.
 *
 * @param {object} textractResponse  Full Textract response
 * @param {number} imageWidth        Rendered image width in px
 * @param {number} imageHeight       Rendered image height in px
 * @param {number} zoomLevel         Current zoom (default 1)
 * @param {number} rotateAngle       Current rotation (default 0)
 */
export const getAllFieldBoundingBoxesForHitTest = (
  textractResponse, imageWidth, imageHeight, zoomLevel = 1, rotateAngle = 0
) => {
  const fieldBoxes = getAllFieldBoundingBoxes(textractResponse);
  const result = [];

  for (const [fieldName, box] of Object.entries(fieldBoxes)) {
    if (!box) continue;
    const boxes = Array.isArray(box) ? box : [box];
    for (const b of boxes) {
      if (!b) continue;
      const pixels = calculateTransformedBoundingBox(b, imageWidth, imageHeight, zoomLevel, rotateAngle);
      if (pixels) {
        result.push({ fieldName, boundingBox: pixels, raw: b });
      }
    }
  }

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export const findFieldNameByBlock = (textractResponse, blockId, text = "") => {
  try {
    const block = (textractResponse?.Blocks ?? []).find(b => b.Id === blockId);
    if (!block) return null;
    const blockText = (block.Text ?? text).toUpperCase();
    for (const [field, types] of Object.entries(FIELD_TO_TEXTRACT_TYPES)) {
      for (const t of types) {
        if (blockText.includes(t) || blockText.includes(t.replace(/_/g," "))) return field;
      }
    }
    return null;
  } catch (e) { console.error("findFieldNameByBlock:", e); return null; }
};

export const getAllBlocksWithBoundingBoxes = (textractResponse) => {
  try {
    return (textractResponse?.Blocks ?? [])
      .filter(b => b.Geometry?.BoundingBox)
      .map(b => ({
        id:          b.Id,
        text:        b.Text,
        blockType:   b.BlockType,
        textType:    b.TextType ?? "PRINTED",
        page:        b.Page ?? 1,
        boundingBox: b.Geometry.BoundingBox,
        polygon:     b.Geometry.Polygon ?? null,
        confidence:  b.Confidence,
        fieldName:   findFieldNameByBlock(textractResponse, b.Id, b.Text),
      }));
  } catch (e) { console.error("getAllBlocksWithBoundingBoxes:", e); return []; }
};

// ─────────────────────────────────────────────────────────────────────────────
// HIT-TESTING
// ─────────────────────────────────────────────────────────────────────────────

export const doBoundingBoxesOverlap = (box1, box2) => {
  if (!box1 || !box2) return false;
  return !(
    box2.left > box1.left + box1.width  ||
    box2.left + box2.width  < box1.left ||
    box2.top  > box1.top  + box1.height ||
    box2.top  + box2.height < box1.top
  );
};

export const calculateIOU = (box1, box2) => {
  if (!box1 || !box2) return 0;
  const xL = Math.max(box1.left, box2.left), yT = Math.max(box1.top, box2.top);
  const xR = Math.min(box1.left+box1.width, box2.left+box2.width);
  const yB = Math.min(box1.top+box1.height, box2.top+box2.height);
  if (xR < xL || yB < yT) return 0;
  const inter = (xR-xL)*(yB-yT);
  return inter / (box1.width*box1.height + box2.width*box2.height - inter);
};

/**
 * Find the field whose bounding box contains (clickX, clickY).
 * @param {Array} boundingBoxes  Output of getAllFieldBoundingBoxesForHitTest()
 */
export const getClosestFieldToClick = (boundingBoxes, clickX, clickY, threshold = 50) => {
  if (!boundingBoxes?.length) return null;
  let best = null, minDist = Infinity;
  for (const item of boundingBoxes) {
    const box = item.boundingBox;
    if (!box) continue;
    const inside =
      clickX >= box.left && clickX <= box.left + box.width &&
      clickY >= box.top  && clickY <= box.top  + box.height;
    if (inside) return item;
    const dx = Math.max(box.left - clickX, 0, clickX - (box.left + box.width));
    const dy = Math.max(box.top  - clickY, 0, clickY - (box.top  + box.height));
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < threshold && dist < minDist) { minDist = dist; best = item; }
  }
  return best;
};

export const boundingBoxToCSS = (box) => {
  if (!box) return {};
  return {
    position:"absolute", left:`${box.left}px`, top:`${box.top}px`,
    width:`${box.width}px`, height:`${box.height}px`,
    border:"2px solid #4f46e5", backgroundColor:"rgba(79,70,229,0.1)",
    pointerEvents:"none", zIndex:10, transition:"all 0.2s ease",
  };
};

export const getFieldColor = (fieldName) => {
  const map = {
    "Vendor Name":         "#0ea5e9",
    "Bill Number":         "#6366f1",
    "Total Amount":        "#ef4444",
    "Invoice Date":        "#8b5cf6",
    "Vendor GST Number":   "#ec4899",
    "Vendor Phone Number": "#f59e0b",
    "Vendor Address":      "#10b981",
  };
  return map[fieldName] ?? "#64748b";
};

export default {
  // Date
  extractDateOnly,
  // Address
  stripVendorNameFromAddress,
  formatAddressForDisplay,
  computeUnionBBox,
  // Validation
  isGstFormat,
  isHelpline,
  cleanGSTNumber,
  cleanPhoneNumber,
  extractPhoneFromLabelLine,
  // Bounding boxes
  calculateBoundingBoxPixels,
  calculateTransformedBoundingBox,
  getFieldBoundingBox,
  getAllFieldBoundingBoxes,
  getAllFieldBoundingBoxesForHitTest,
  // Blocks
  findFieldNameByBlock,
  getAllBlocksWithBoundingBoxes,
  // Hit-testing
  doBoundingBoxesOverlap,
  calculateIOU,
  getClosestFieldToClick,
  boundingBoxToCSS,
  // UI
  getFieldColor,
  // Maps
  TYPE_TO_DISPLAY,
  FIELD_TO_TEXTRACT_TYPES,
  getTextractTypesForField,
  // Constants
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
};