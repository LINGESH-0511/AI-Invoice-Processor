# =============================================================================
# processor.py  —  PRODUCTION v9.2
# Invoice Field Extraction Engine — All-India, All-Format
#
# FIXES vs v9.1  (all address bugs from screenshot analysis)
# ──────────────────────────────────────────────────────────
# BUG-1 FIXED  Address contains vendor name as prefix
#              Root cause: Textract often returns VENDOR_ADDRESS field with
#              the full header block: "KHANAVALI7 BASAVESHWAR NO.6,1ST FLOOR..."
#              or "Restaurant DESI FOOD JUNCTION Shop No. 47-48...".
#              Fix: strip_vendor_name_from_address() is called on every addr_part
#              collected in Tier-1, and again as a final pass in cleanup.
#              Handles: exact prefix, reversed word order (KHANAVALI7 BASAVESHWAR
#              vs BASAVESHWAR KHANAVALI7), and partial embedding.
#
# BUG-2 FIXED  addr_parts deduplication was broken
#              Root cause: old heuristic used character membership count
#              (sum(1 for c in fp if c in existing_fp)/shorter > 0.70) which
#              is NOT substring containment. This dropped valid distinct lines.
#              Fix: _dedup_address_parts() uses exact normalized-string match,
#              then removes shorter parts that are substrings of longer ones.
#
# BUG-3 FIXED  Final cleanup split address on commas then deduped
#              Root cause: re.split(r"[,\n;]", addr) then character-overlap dedup
#              destroyed "NO.6,1ST FLOOR" → ["NO.6", "1ST FLOOR"].
#              Fix: final cleanup only collapses whitespace and strips punctuation.
#              No splitting or deduplication at this stage.
#
# BUG-4 FIXED  Tier-3 address zone_start did not account for name line height
#              Root cause: zone_start = name_top + 0.004 but name line extends to
#              name_top + name_height (≈0.02), so name line was in the zone.
#              Fix: zone_start = name_top + name_height + 0.003
#
# BUG-4b FIXED Tier-3 raw blocks included name-word lines in address
#              Fix: blocks whose word-set is a subset of vendor name words
#              are filtered out before building address clusters.
#
# BUG-5 FIXED  Final address value not stripped of vendor name
#              Fix: strip_vendor_name_from_address() called at end of
#              extract_expense_data() as guaranteed last-resort cleanup.
#
# RETAINED FROM v9.1
# ──────────────────
#  All keyword fields: GST, date, total, bill_number, phone
#  4-Tier vendor name + address engine (GroupProperties → type → geometry)
#  Consensus voting, bbox corroboration, skew detection
#  GroupProperties VENDOR/RECEIVER, PageNumber, Currency.Code
#  LabelDetection direction validation, Polygon skew penalty
#  TextType PRINTED preference
#  Phone: 7-8 digit landline, label-context detection, helpline filter
#  All FIELD_MAPPING / FORM_KEY_HINTS / keyword expansions from v9.1
#  Confidence clamped to [0, 99.0]
#  No line-item extraction (removed per client requirement)
#
# LANGUAGE: English-only   REGION: All-India (28 states + UTs)
# =============================================================================

import logging
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

__version__ = "9.3.0"

# =============================================================================
# LOGGING
# =============================================================================

logger = logging.getLogger(__name__)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)

# =============================================================================
# CONSTANTS
# =============================================================================

MIN_CONFIDENCE: Dict[str, float] = {
    "vendor_gst":     80.0,
    "total_amount":   70.0,
    "invoice_date":   65.0,
    "bill_number":    60.0,
    "vendor_phone":   55.0,
    "vendor_name":    45.0,
    "vendor_address": 40.0,
}

MAX_CONFIDENCE = 99.0   # confidence is always clamped to [0, 99.0]

GROUP_VENDOR   = "VENDOR"
GROUP_RECEIVER = "RECEIVER"

SKEW_THRESHOLD          = 0.05
SKEW_PENALTY            = 8.0
VENDOR_GROUP_BONUS      = 6.0
PRINTED_BONUS           = 2.0
ADDRESS_FOOTER_TOP      = 0.82
MAX_ADDRESS_LINE_GAP    = 0.050

CONSENSUS_BONUS          = 7.0
BBOX_CORROBORATION_BONUS = 4.0

# Spatial zones (fraction of page height)
NAME_ZONE_TOP    = 0.0
NAME_ZONE_BOTTOM = 0.38
ADDR_ZONE_TOP    = 0.02
ADDR_ZONE_BOTTOM = 0.68

# =============================================================================
# COMPILED REGEX
# =============================================================================

GST_STRICT  = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[0-9A-Z]$")
GST_LOOSE   = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][0-9A-Z]$")
GST_FIND    = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[0-9A-Z]\b")
GST_FIND_LO = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][0-9A-Z]\b")

_NAME_NOISE_RE = re.compile(
    r"""^\s*(?:
        (?:TAX\s+INVOICE|GST\s+INVOICE|RETAIL\s+INVOICE|PROFORMA\s+INVOICE|
           TAX\s+RECEIPT|CASH\s+RECEIPT|CASH\s+MEMO|DELIVERY\s+CHALLAN|
           CREDIT\s+NOTE|DEBIT\s+NOTE|QUOTATION|ESTIMATE|PURCHASE\s+ORDER|
           INVOICE|RECEIPT|BILL)[\s\:\-]*$
        |(?:DATE|DATED|DT\.?|INVOICE\s+DATE|BILL\s+DATE|RECEIPT\s+DATE)[\s\:\-]
        |(?:GSTIN|GST\s*NO\.?|GST\s+NUMBER|PAN\s*NO\.?|CIN\s*NO\.?|
           TIN\s*NO\.?|VAT\s*NO\.?)[\s\:\-]
        |(?:GRAND\s+TOTAL|NET\s+AMOUNT|AMOUNT\s+DUE|NET\s+PAYABLE|
           TOTAL\s+AMOUNT|TOTAL\s+DUE)[\s\:\-]
        |(?:PHONE\s*NO\.?|MOBILE\s*NO\.?|TEL\s*NO\.?|FAX\s*NO\.?)[\s\:\-]
        |(?:THANK\s+YOU|THANKS\s+FOR|PLEASE\s+VISIT|VISIT\s+US|COME\s+AGAIN)
        |(?:PAGE\s+\d|COPY|ORIGINAL|DUPLICATE|TRIPLICATE)[\s\:\-]
        |(?:WWW\.|HTTPS?://|@[A-Z])
    )""",
    re.VERBOSE | re.IGNORECASE,
)

PHONE_RE = [
    re.compile(r"\+91[-\s]?[6-9]\d{9}"),
    re.compile(r"0[6-9]\d{9}"),
    re.compile(r"\b[6-9]\d{9}\b"),
    re.compile(r"0\d{2,4}[-\s]\d{6,8}"),
    re.compile(r"\(\d{3,5}\)\s*\d{5,8}"),
    re.compile(r"\b\d{10,12}\b"),
    # 7-8 digit local landlines (Mumbai/old city numbers) — comma/slash separated pairs
    re.compile(r"\b\d{7,8}\b(?:[,;\s/]+\b\d{7,8}\b)+"),
    # Single 7-8 digit — only with label context
    re.compile(r"\b\d{7,8}\b"),
]

_PHONE_LABEL_CONTEXT_RE = re.compile(
    r"(?:Ph|Tel|Tele|Phone|Fax|Mob|Cell|Contact|Helpline|Enquiry|Whatsapp|"
    r"Ph\.No|Tel\.No|Mobile|Landline|Call|Reach|Office|Direct)\s*[:\.#]?\s*",
    re.IGNORECASE,
)

DATE_RE = [
    re.compile(r"\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b"),
    re.compile(r"\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b"),
    re.compile(r"\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"
               r"[A-Z]*[,\.\s]+\d{2,4}\b", re.IGNORECASE),
    re.compile(r"\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"
               r"[A-Z]*\s+\d{1,2}[,\.\s]+\d{4}\b", re.IGNORECASE),
    re.compile(r"\b\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}\b",
               re.IGNORECASE),
]

NON_ASCII_RE = re.compile(r"[^\x00-\x7F]+")

# =============================================================================
# CURRENCY
# =============================================================================

CURRENCY_SYMBOL_MAP: Dict[str, List[str]] = {
    "INR": ["₹", "Rs.", "Rs", "INR", "R.", "Rp."],
    "USD": ["$", "USD", "US$"],
    "EUR": ["€", "EUR"],
    "GBP": ["£", "GBP"],
    "JPY": ["¥", "JPY"],
    "AED": ["AED", "Dh.", "Dhs."],
    "SGD": ["SGD", "S$"],
}
ALL_CURRENCY_SYMBOLS: List[str] = [s for syms in CURRENCY_SYMBOL_MAP.values() for s in syms]

# =============================================================================
# GST STATE CODES
# =============================================================================

GST_STATE_CODES: Dict[str, str] = {
    "01": "Jammu & Kashmir",   "02": "Himachal Pradesh",  "03": "Punjab",
    "04": "Chandigarh",        "05": "Uttarakhand",        "06": "Haryana",
    "07": "Delhi",             "08": "Rajasthan",          "09": "Uttar Pradesh",
    "10": "Bihar",             "11": "Sikkim",             "12": "Arunachal Pradesh",
    "13": "Nagaland",          "14": "Manipur",            "15": "Mizoram",
    "16": "Tripura",           "17": "Meghalaya",          "18": "Assam",
    "19": "West Bengal",       "20": "Jharkhand",          "21": "Odisha",
    "22": "Chhattisgarh",      "23": "Madhya Pradesh",     "24": "Gujarat",
    "25": "Daman & Diu",       "26": "Dadra & NH",         "27": "Maharashtra",
    "28": "Andhra Pradesh",    "29": "Karnataka",           "30": "Goa",
    "31": "Lakshadweep",       "32": "Kerala",              "33": "Tamil Nadu",
    "34": "Puducherry",        "35": "Andaman & Nicobar",  "36": "Telangana",
    "37": "Andhra Pradesh (New)", "38": "Ladakh",
}

# =============================================================================
# ADDRESS NOISE PATTERNS
# =============================================================================

ADDRESS_NOISE_PATTERNS = [
    re.compile(r"\b\d{1,2}:\d{2}\s*(?:AM|PM)\b", re.IGNORECASE),
    re.compile(r"\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\b", re.I),
    re.compile(r"GSTIN\s*[:\-]?\s*[A-Z0-9\-]{12,}", re.IGNORECASE),
    re.compile(r"GST\s*No\.?\s*[:\-]?\s*[A-Z0-9\-]{12,}", re.IGNORECASE),
    re.compile(r"(?:PHONE|MOBILE|CELL|TEL|PH|MOB|WA)\s*[:\-]?\s*[\d\s\-\+\(\)]{8,}", re.I),
    re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"(?:BILL|INVOICE|RECEIPT|INV)\s*(?:NO\.?|#)\s*[:\-]?\s*[A-Z0-9\-]+", re.I),
    re.compile(r"(?:WAITER|SERVER|TABLE|COUNTER|CASHIER)\s*[:\-]?\s*\S+", re.I),
    re.compile(r"\b\d{14}\b"),
    re.compile(r"\bFSSAI\b.*", re.IGNORECASE),
    re.compile(r"\bCIN\s*[:\-]\s*[A-Z0-9]{21}", re.IGNORECASE),
]

# =============================================================================
# ADDRESS STRUCTURAL MARKERS
# =============================================================================

ADDRESS_STRUCTURAL = [
    "ROAD", "STREET", "LANE", "AVENUE", "DRIVE", "HIGHWAY", "BYPASS", "FLYOVER",
    "NAGAR", "VIHAR", "COLONY", "SOCIETY", "COMPLEX", "ENCLAVE", "GARDEN", "PARK",
    "TOWNSHIP", "SECTOR", "BLOCK", "PHASE", "LAYOUT", "EXTENSION", "RESIDENCY",
    "APARTMENT", "FLAT ", "TOWER", "BUILDING", "BLDG", "PLOT ", "VILLA", "BHAVAN",
    "SHOP NO", "DOOR NO", "D.NO", "SURVEY NO", "S.NO", "KHASRA", "FLOOR", "GALI ",
    "NEAR ", "OPPOSITE", "OPP ", "BEHIND", "BESIDE", "NEXT TO", "TOWARDS",
    "DISTRICT", "DIST.", "TALUK", "TEHSIL", "MANDAL", "PANCHAYAT", "CORPORATION",
    "MUNICIPALITY", "POST ", "P.O.", "PIN ", "PINCODE", "ZIP ",
    "BAZAAR", "MARKET", "MARG ", "CHOWK", "MOHALLA",
    "HEAD OFFICE", "REGD OFFICE", "REGISTERED OFFICE", "BRANCH ", "FACTORY",
    "GODOWN", "WAREHOUSE", "SHOWROOM", "OUTLET", "UNIT ",
    "CROSS ROAD", "CROSS STREET", "MAIN ROAD", "MAIN STREET",
]

# =============================================================================
# FIELD MAPPING
# =============================================================================

FIELD_MAPPING: Dict[str, str] = {
    # ── BILL NUMBER ──────────────────────────────────────────────────────────
    "INVOICE_RECEIPT_ID": "bill_number", "RECEIPT_ID": "bill_number",
    "INVOICE_ID": "bill_number", "INVOICE_NUMBER": "bill_number",
    "INVOICE_NO": "bill_number", "BILL_NUMBER": "bill_number", "BILL_NO": "bill_number",
    "RECEIPT_NUMBER": "bill_number", "RECEIPT_NO": "bill_number",
    "ORDER_NUMBER": "bill_number", "ORDER_ID": "bill_number", "ORDER_NO": "bill_number",
    "DOCUMENT_ID": "bill_number", "DOCUMENT_NUMBER": "bill_number", "DOC_NO": "bill_number",
    "REFERENCE_NUMBER": "bill_number", "REFERENCE_NO": "bill_number", "REF_NO": "bill_number",
    "REF_NUMBER": "bill_number", "REFERENCE_ID": "bill_number",
    "POS_ID": "bill_number", "POS_NUMBER": "bill_number", "POS_NO": "bill_number",
    "TOKEN_NUMBER": "bill_number", "TOKEN_NO": "bill_number", "TOKEN_ID": "bill_number",
    "CHALLAN_NUMBER": "bill_number", "CHALLAN_NO": "bill_number", "CHALLAN_ID": "bill_number",
    "CHALAN_NUMBER": "bill_number", "CHALAN_NO": "bill_number",
    "VOUCHER_NUMBER": "bill_number", "VOUCHER_NO": "bill_number", "VOUCHER_ID": "bill_number",
    "BOOKING_ID": "bill_number", "BOOKING_NUMBER": "bill_number", "BOOKING_NO": "bill_number",
    "TRANSACTION_ID": "bill_number", "TXN_ID": "bill_number", "TXN_NO": "bill_number",
    "TRANSACTION_NUMBER": "bill_number", "TRANSACTION_NO": "bill_number",
    "JOB_NUMBER": "bill_number", "JOB_NO": "bill_number", "JOB_ID": "bill_number",
    "WORK_ORDER": "bill_number", "WORK_ORDER_NO": "bill_number",
    "DELIVERY_NOTE": "bill_number", "DELIVERY_NO": "bill_number",
    "DISPATCH_NO": "bill_number", "DISPATCH_NUMBER": "bill_number",
    "MEMO_NUMBER": "bill_number", "MEMO_NO": "bill_number",
    "PROFORMA_NUMBER": "bill_number", "PROFORMA_NO": "bill_number", "PI_NUMBER": "bill_number",
    "QUOTATION_NUMBER": "bill_number", "QUOTATION_NO": "bill_number",
    "SLIP_NUMBER": "bill_number", "SLIP_NO": "bill_number",
    "TICKET_NUMBER": "bill_number", "TICKET_NO": "bill_number", "TICKET_ID": "bill_number",
    "CASH_MEMO_NO": "bill_number", "CASH_BILL_NO": "bill_number", "CASH_MEMO": "bill_number",
    "SERIAL_NUMBER": "bill_number", "SERIAL_NO": "bill_number", "SR_NO": "bill_number",
    "ESTIMATE_NUMBER": "bill_number", "ESTIMATE_NO": "bill_number",
    "PURCHASE_ORDER": "bill_number", "PO_NUMBER": "bill_number", "PO_NO": "bill_number",
    "DEBIT_NOTE_NO": "bill_number", "CREDIT_NOTE_NO": "bill_number",
    "GRN_NUMBER": "bill_number", "GRN_NO": "bill_number",
    "AWB_NUMBER": "bill_number", "AWB_NO": "bill_number",
    "LR_NUMBER": "bill_number", "LR_NO": "bill_number",
    "KOT_NUMBER": "bill_number", "KOT_NO": "bill_number", "KOT_ID": "bill_number",
    "TABLE_NUMBER": "bill_number", "TABLE_NO": "bill_number",

    # ── VENDOR NAME (Tier-2 fallback) ────────────────────────────────────────
    "VENDOR_NAME": "vendor_name", "MERCHANT_NAME": "vendor_name",
    "STORE_NAME": "vendor_name", "SUPPLIER_NAME": "vendor_name",
    "SELLER_NAME": "vendor_name", "BILL_FROM": "vendor_name",
    "COMPANY_NAME": "vendor_name", "BUSINESS_NAME": "vendor_name",
    "TRADING_NAME": "vendor_name", "SHOP_NAME": "vendor_name",
    "ESTABLISHMENT_NAME": "vendor_name", "RESTAURANT_NAME": "vendor_name",
    "HOTEL_NAME": "vendor_name", "RETAILER_NAME": "vendor_name",
    "DISTRIBUTOR_NAME": "vendor_name", "TRADE_NAME": "vendor_name",
    "BRAND_NAME": "vendor_name", "PROPRIETOR_NAME": "vendor_name",
    "MANUFACTURER_NAME": "vendor_name", "OPERATOR_NAME": "vendor_name",
    "SERVICE_PROVIDER": "vendor_name", "ISSUED_BY": "vendor_name",
    "SOLD_BY": "vendor_name", "FIRM_NAME": "vendor_name",
    "AGENCY_NAME": "vendor_name", "OUTLET_NAME": "vendor_name",
    "CLINIC_NAME": "vendor_name", "HOSPITAL_NAME": "vendor_name",
    "PHARMACY_NAME": "vendor_name", "SCHOOL_NAME": "vendor_name",

    # ── VENDOR ADDRESS (Tier-2 fallback) ─────────────────────────────────────
    "VENDOR_ADDRESS": "vendor_address", "ADDRESS": "vendor_address",
    "MERCHANT_ADDRESS": "vendor_address", "BILL_FROM_ADDRESS": "vendor_address",
    "SUPPLIER_ADDRESS": "vendor_address", "SELLER_ADDRESS": "vendor_address",
    "COMPANY_ADDRESS": "vendor_address", "BUSINESS_ADDRESS": "vendor_address",
    "STREET_ADDRESS": "vendor_address", "LOCATION": "vendor_address",
    "REGISTERED_ADDRESS": "vendor_address", "CORPORATE_ADDRESS": "vendor_address",
    "SHOP_ADDRESS": "vendor_address", "HEAD_OFFICE_ADDRESS": "vendor_address",
    "REGD_ADDRESS": "vendor_address", "BRANCH_ADDRESS": "vendor_address",
    "FACTORY_ADDRESS": "vendor_address", "OFFICE_ADDRESS": "vendor_address",

    # ── VENDOR PHONE ─────────────────────────────────────────────────────────
    "VENDOR_PHONE": "vendor_phone", "PHONE": "vendor_phone", "TELEPHONE": "vendor_phone",
    "TEL": "vendor_phone", "TELE_NUMBER": "vendor_phone", "MOBILE": "vendor_phone",
    "MOBILE_NUMBER": "vendor_phone", "CONTACT": "vendor_phone",
    "CONTACT_NUMBER": "vendor_phone", "CONTACT_NO": "vendor_phone",
    "PHONE_NUMBER": "vendor_phone", "PHONE_NO": "vendor_phone",
    "CELL": "vendor_phone", "CELL_PHONE": "vendor_phone", "LANDLINE": "vendor_phone",
    "OFFICE_PHONE": "vendor_phone", "WHATSAPP": "vendor_phone",
    "WHATSAPP_NUMBER": "vendor_phone", "WHATSAPP_NO": "vendor_phone",
    "FAX": "vendor_phone", "FAX_NUMBER": "vendor_phone", "FAX_NO": "vendor_phone",
    "HELPLINE": "vendor_phone", "HELPDESK": "vendor_phone", "HELPDESK_NO": "vendor_phone",
    "TOLL_FREE": "vendor_phone", "TOLLFREE": "vendor_phone", "TOLLFREE_NO": "vendor_phone",
    "MOB": "vendor_phone", "MOB_NO": "vendor_phone", "MOB_NUMBER": "vendor_phone",
    "PH": "vendor_phone", "PH_NO": "vendor_phone", "PH_NUMBER": "vendor_phone",
    "TEL_NO": "vendor_phone", "TELE_NO": "vendor_phone",
    "OFFICE_NO": "vendor_phone", "OFFICE_NUMBER": "vendor_phone",
    "DIRECT_LINE": "vendor_phone", "CUSTOMER_CARE": "vendor_phone",
    "SUPPORT_NUMBER": "vendor_phone", "ENQUIRY": "vendor_phone",
    "ENQUIRY_NUMBER": "vendor_phone", "ENQUIRY_NO": "vendor_phone",
    "CALL_US": "vendor_phone", "REACH_US": "vendor_phone", "CONTACT_US": "vendor_phone",
    "EMERGENCY": "vendor_phone", "EMERGENCY_NO": "vendor_phone",

    # ── VENDOR GST ───────────────────────────────────────────────────────────
    "GST_NUMBER": "vendor_gst", "GST": "vendor_gst", "GSTIN": "vendor_gst",
    "TAX_ID": "vendor_gst", "VAT_NUMBER": "vendor_gst", "VAT": "vendor_gst",
    "CST_NUMBER": "vendor_gst", "CST": "vendor_gst", "TAX_NUMBER": "vendor_gst",
    "TIN_NUMBER": "vendor_gst", "TIN": "vendor_gst", "PAN_NUMBER": "vendor_gst",
    "REGISTRATION_NUMBER": "vendor_gst", "GST_NO": "vendor_gst",
    "GSTIN_NO": "vendor_gst", "GSTIN_NUMBER": "vendor_gst", "GSTIN_ID": "vendor_gst",
    "GST_REG": "vendor_gst", "GST_REG_NO": "vendor_gst",
    "GST_REGISTRATION": "vendor_gst", "GST_REGISTRATION_NUMBER": "vendor_gst",
    "VENDOR_GST": "vendor_gst", "SELLER_GSTIN": "vendor_gst",
    "SUPPLIER_GSTIN": "vendor_gst", "MERCHANT_GSTIN": "vendor_gst",
    "TAX_REGISTRATION": "vendor_gst", "TAX_REG_NO": "vendor_gst",
    "TAXPAYER_ID": "vendor_gst", "COMPANY_GST": "vendor_gst",
    "FIRM_GSTIN": "vendor_gst", "SHOP_GSTIN": "vendor_gst", "STORE_GSTIN": "vendor_gst",
    "VAT_REG_NO": "vendor_gst", "SERVICE_TAX_NO": "vendor_gst",
    "EXCISE_NO": "vendor_gst", "PAN": "vendor_gst",

    # ── INVOICE DATE ─────────────────────────────────────────────────────────
    "INVOICE_RECEIPT_DATE": "invoice_date", "INVOICE_DATE": "invoice_date",
    "TRANSACTION_DATE": "invoice_date", "DATE": "invoice_date", "BILL_DATE": "invoice_date",
    "RECEIPT_DATE": "invoice_date", "DOCUMENT_DATE": "invoice_date",
    "ISSUE_DATE": "invoice_date", "CREATED_DATE": "invoice_date",
    "INVOICED_DATE": "invoice_date", "ORDER_DATE": "invoice_date",
    "PURCHASE_DATE": "invoice_date", "SERVICE_DATE": "invoice_date",
    "DATED": "invoice_date", "DATE_OF_INVOICE": "invoice_date",
    "TX_DATE": "invoice_date", "TXN_DATE": "invoice_date",
    "VALUE_DATE": "invoice_date", "POSTING_DATE": "invoice_date",
    "RAISED_ON": "invoice_date", "PAYMENT_DATE": "invoice_date",
    "SALE_DATE": "invoice_date", "DISPATCH_DATE": "invoice_date",
    "SUPPLY_DATE": "invoice_date", "CHALLAN_DATE": "invoice_date",
    "VOUCHER_DATE": "invoice_date", "BOOKING_DATE": "invoice_date",
    "VISIT_DATE": "invoice_date", "CHECK_IN": "invoice_date",
    "BILLING_DATE": "invoice_date", "TAX_DATE": "invoice_date",

    # ── TOTAL AMOUNT ─────────────────────────────────────────────────────────
    "TOTAL": "total_amount", "AMOUNT_DUE": "total_amount", "GRAND_TOTAL": "total_amount",
    "NET_AMOUNT": "total_amount", "TOTAL_AMOUNT": "total_amount",
    "BILL_AMOUNT": "total_amount", "INVOICE_TOTAL": "total_amount",
    "AMOUNT_PAYABLE": "total_amount", "TOTAL_DUE": "total_amount",
    "BALANCE_DUE": "total_amount", "NET_TOTAL": "total_amount",
    "TOTAL_BILL": "total_amount", "FINAL_TOTAL": "total_amount",
    "TOTAL_WITH_TAX": "total_amount", "TOTAL_AMOUNT_DUE": "total_amount",
    "NET_PAYABLE": "total_amount", "PAYABLE_AMOUNT": "total_amount",
    "NET_PAYABLE_AMOUNT": "total_amount", "NET_DUE": "total_amount",
    "TOTAL_PAYABLE": "total_amount", "FINAL_AMOUNT": "total_amount",
    "GROSS_TOTAL": "total_amount", "TOTAL_CHARGES": "total_amount",
    "TAXABLE_VALUE": "total_amount", "CHARGEABLE_AMOUNT": "total_amount",
    "AMOUNT_PAID": "total_amount", "GROSS_AMOUNT": "total_amount",
    "TOTAL_VALUE": "total_amount", "INVOICE_AMOUNT": "total_amount",
    "PAYABLE": "total_amount", "OUTSTANDING": "total_amount",
    "ROUNDED_TOTAL": "total_amount", "ROUND_OFF_AMOUNT": "total_amount",
    "AMOUNT_RECEIVED": "total_amount", "TOTAL_RECEIVABLE": "total_amount",
    "TOTAL_COST": "total_amount", "TOTAL_PRICE": "total_amount",
    "TOTAL_SUM": "total_amount", "TOTAL_NET": "total_amount",
    "BALANCE_PAYABLE": "total_amount", "BALANCE_AMOUNT": "total_amount",
    "RECEIPT_AMOUNT": "total_amount", "BILLED_AMOUNT": "total_amount",
    "CHARGED_AMOUNT": "total_amount", "INVOICE_VALUE": "total_amount",
    "TOTAL_INVOICE_VALUE": "total_amount",
}

TYPE_TO_DISPLAY: Dict[str, str] = {
    k: {
        "bill_number":    "Bill Number",
        "vendor_name":    "Vendor Name",
        "vendor_address": "Vendor Address",
        "vendor_phone":   "Vendor Phone Number",
        "vendor_gst":     "Vendor GST Number",
        "invoice_date":   "Invoice Date",
        "total_amount":   "Total Amount",
    }.get(v, v)
    for k, v in FIELD_MAPPING.items()
}

# =============================================================================
# FORM KEY HINTS
# =============================================================================

FORM_KEY_HINTS: Dict[str, List[str]] = {
    "bill_number": [
        "bill no", "bill number", "invoice no", "invoice number", "invoice #",
        "bill no:", "invoice no:", "receipt no:", "order no:", "ref no:",
        "bill #", "inv #", "bill no.", "invoice no.", "receipt no.", "token:",
        "token no:", "challan:", "voucher:", "memo:", "slip no:", "sr no:",
        "receipt no", "receipt number", "receipt #", "order no", "order number",
        "ref no", "ref number", "reference no", "reference number", "ref #",
        "doc no", "document no", "document number", "serial no", "serial number",
        "sr no", "sr. no", "s.no", "sl no", "sl. no",
        "pos id", "pos no", "token no", "token number", "token", "counter no",
        "challan no", "challan number", "chalan no", "chalan number",
        "voucher no", "voucher number", "voucher #",
        "booking id", "booking no", "booking number", "booking ref",
        "transaction id", "txn id", "txn no", "transaction no", "trans no", "tr no",
        "job no", "job number", "job id", "job order", "work order", "work order no",
        "delivery note", "delivery no", "dispatch no", "dispatch number", "dn no",
        "memo no", "memo number", "proforma no", "pi no", "pi number",
        "quotation no", "quote no", "estimate no", "estimate number",
        "slip no", "ticket no", "ticket number", "ticket id",
        "po no", "po number", "purchase order", "grn no", "grn number",
        "debit note no", "credit note no", "dn#", "cn#",
        "awb no", "lr no", "waybill no", "airway bill",
        "cash memo", "cash bill no", "cash memo no",
        "bill ref", "inv no", "inv#", "kot no", "kot number", "table no",
    ],
    "vendor_name": [
        "vendor name", "merchant name", "company name", "business name",
        "seller name", "supplier name", "shop name", "firm name",
        "sold by", "bill from", "billed from", "dispatched by", "issued by",
    ],
    "vendor_address": [
        "vendor address", "merchant address", "company address",
        "registered address", "supplier address", "seller address",
        "office address", "bill from address", "shop address",
    ],
    "vendor_phone": [
        "phone", "mobile", "tel", "contact", "ph", "mob",
        "phone no", "mobile no", "tel no", "contact no",
        "phone number", "mobile number", "telephone", "cell",
        "cell no", "cell phone", "landline", "office no",
        "whatsapp", "whatsapp no", "fax", "fax no", "helpline",
        "helpdesk", "toll free", "tollfree", "enquiry", "customer care",
        "support", "contact us", "call us", "reach us", "direct line",
        "+91", "emergency", "booking phone", "reservation",
        "tele", "tele no", "ph no", "mob no", "office phone",
        "ph:", "tel:", "mob:", "fax:", "ph.", "tel.", "mob.", "phone:", "mobile:",
        "contact:", "telephone:", "cell:", "landline:", "whatsapp:", "helpline:",
        "tele:", "office:", "direct:", "support:", "enquiry:", "mob no:",
    ],
    "vendor_gst": [
        "gstin", "gst no", "gst number", "gst", "gstin no", "gstin number",
        "gstin id", "gst reg", "gst reg no", "gst registration",
        "gst registration number", "tax id", "vat no", "vat number",
        "vat reg no", "registration no", "tax registration", "tax reg no",
        "taxpayer id", "company gst", "firm gstin", "shop gstin",
        "pan no", "pan number", "g.s.t.i.n", "g.s.t.n", "gst in",
        "seller gstin", "supplier gstin", "merchant gstin",
        "cst no", "cst number", "tin no", "tin number",
        "service tax no", "excise no", "seller tax id",
        "gstin:", "gst:", "gst no:", "gstin no:", "tax id:", "vat:", "cst:",
        "tin:", "pan:", "g.s.t.i.n:", "reg no:", "registration:", "gst #",
    ],
    "invoice_date": [
        "date", "invoice date", "bill date", "receipt date", "dt", "dated",
        "date of invoice", "date of bill", "date of receipt",
        "transaction date", "tx date", "txn date", "value date",
        "posting date", "raised on", "prepared date", "generated on",
        "sale date", "dispatch date", "supply date", "entry date",
        "challan date", "voucher date", "memo date", "print date",
        "booking date", "visit date", "billing date", "statement date",
        "inv dt", "inv date", "bill dt", "issue date", "order date",
        "purchase date", "service date", "payment date", "check in",
        "arrival date", "tax date", "clearing date", "created date",
        "date:", "dt:", "dated:", "invoice date:", "bill date:", "receipt date:",
        "transaction date:", "txn date:", "issue date:", "order date:",
    ],
    "total_amount": [
        "total", "grand total", "net amount", "total amount", "amount due",
        "balance due", "payable", "net payable", "bill amount", "net payable amount",
        "net due", "total payable", "final amount", "gross total", "gross amount",
        "total value", "invoice amount", "transaction amount", "total charges",
        "total cost", "total price", "amount payable", "total due", "invoice total",
        "final total", "net total", "bill total", "sub total", "total bill",
        "rounded total", "round off amount", "amount received", "total receivable",
        "balance payable", "balance amount", "receipt amount", "billed amount",
        "charged amount", "assessed value", "total inclusive", "invoice value",
        "total invoice value", "chargeable amount", "taxable value",
        "amount collected", "payable amount", "outstanding amount",
        "total:", "grand total:", "net total:", "amount:", "bill amount:",
        "net payable:", "payable:", "amount due:", "balance:", "net amount:",
        "nett total", "nett amount", "nett payable",
        "total rs", "total inr", "amt due", "tot amt", "tot. amount",
    ],
}

# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class ExtractedField:
    value:      str   = "Not Found"
    confidence: float = 0.0
    source:     str   = "textract"

    def to_dict(self) -> Dict[str, Any]:
        conf = min(max(round(self.confidence, 2), 0.0), MAX_CONFIDENCE)
        return {"value": self.value, "confidence": conf}


@dataclass
class ExtractionResult:
    bill_number:    ExtractedField = field(default_factory=ExtractedField)
    vendor_name:    ExtractedField = field(default_factory=ExtractedField)
    vendor_address: ExtractedField = field(default_factory=ExtractedField)
    vendor_phone:   ExtractedField = field(default_factory=ExtractedField)
    vendor_gst:     ExtractedField = field(default_factory=ExtractedField)
    invoice_date:   ExtractedField = field(default_factory=ExtractedField)
    total_amount:   ExtractedField = field(default_factory=ExtractedField)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "important_fields": {
                "Bill Number":         self.bill_number.to_dict(),
                "Vendor Name":         self.vendor_name.to_dict(),
                "Vendor Address":      self.vendor_address.to_dict(),
                "Vendor Phone Number": self.vendor_phone.to_dict(),
                "Vendor GST Number":   self.vendor_gst.to_dict(),
                "Invoice Date":        self.invoice_date.to_dict(),
                "Total Amount":        self.total_amount.to_dict(),
            }
        }

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def strip_non_ascii(text: str) -> str:
    return NON_ASCII_RE.sub(" ", text).strip()


def _clamp(val: float) -> float:
    return min(max(round(val, 2), 0.0), MAX_CONFIDENCE)


def clean_amount(s: str, currency_code: Optional[str] = None) -> str:
    if not s:
        return ""
    v = s.strip()
    syms = CURRENCY_SYMBOL_MAP.get(currency_code or "", ALL_CURRENCY_SYMBOLS)
    for sym in sorted(syms, key=len, reverse=True):
        v = re.sub(re.escape(sym) + r"\s*", "", v, flags=re.IGNORECASE)
    v = re.sub(r"[^\d.,\-]", "", v).strip(",").strip()
    if not v:
        return ""
    parts = v.split(".")
    if len(parts) > 2:
        v = parts[0] + "." + "".join(parts[1:])
    result = v.strip(".")
    return result if result and result != "." else ""


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits


def is_gst_format(text: str) -> bool:
    if not text:
        return False
    c = re.sub(r"[\s\-\/]", "", text.strip().upper())
    if len(c) != 15:
        return False
    state = int(c[:2]) if c[:2].isdigit() else 99
    if state < 1 or state > 38:
        return False
    return bool(GST_STRICT.match(c) or GST_LOOSE.match(c))


def validate_gst_state(gst: str) -> Optional[str]:
    return GST_STATE_CODES.get(gst[:2]) if gst and len(gst) >= 2 else None


def is_cin_format(text: str) -> bool:
    t = text.strip().upper()
    if any(kw in t for kw in ["PLC", "PVT", "LIMITED", "LTD", "LLP", "OPC"]):
        return True
    if re.match(r"^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$", t):
        return True
    return False


def looks_like_date(text: str) -> bool:
    return bool(text) and any(p.search(text) for p in DATE_RE)


def extract_gst_from_text(text: str) -> List[str]:
    s = text.strip().upper()
    found = GST_FIND.findall(s)
    if found:
        return [f for f in found if is_gst_format(f)]
    found_lo = GST_FIND_LO.findall(s)
    return [f for f in found_lo if is_gst_format(f)]


def clean_address(text: str) -> str:
    if not text:
        return ""
    c = re.sub(r"\s+", " ", text).strip()
    c = strip_non_ascii(c)
    for pat in ADDRESS_NOISE_PATTERNS:
        c = pat.sub(" ", c)
    c = re.sub(r"^[\s,;\-\/]+|[\s,;\-\/]+$", "", c)
    c = re.sub(r",\s*,", ",", c)
    c = re.sub(r"\s{2,}", " ", c).strip()
    return c


def _line_has_address_structure(text: str) -> bool:
    upper = text.upper()
    if re.search(r"\b[1-9]\d{5}\b", text):
        return True
    return any(ind in upper for ind in ADDRESS_STRUCTURAL)


def extract_all_phones_from_text(text: str, label_context: bool = False) -> List[str]:
    found: List[str] = []
    seen_norms: set = set()
    covered: List[Tuple[int, int]] = []

    if not label_context and _PHONE_LABEL_CONTEXT_RE.search(text):
        label_context = True

    def _overlaps(s: int, e: int) -> bool:
        return any(s < ce and e > cs for cs, ce in covered)

    min_digits = 7 if label_context else 10

    for pattern in PHONE_RE:
        for m in pattern.finditer(text):
            s, e = m.start(), m.end()
            if _overlaps(s, e):
                continue
            raw = m.group(0)
            digit_runs = re.findall(r"\d{6,}", raw)
            if not digit_runs:
                norm = normalize_phone(raw)
                if min_digits <= len(norm) <= 13 and norm not in seen_norms:
                    seen_norms.add(norm)
                    found.append(norm)
                    covered.append((s, e))
            else:
                for run in digit_runs:
                    norm = normalize_phone(run)
                    if min_digits <= len(norm) <= 13 and norm not in seen_norms:
                        seen_norms.add(norm)
                        found.append(norm)
                covered.append((s, e))
    return found


def extract_phones_with_label_context(text: str) -> List[str]:
    remainder = _PHONE_LABEL_CONTEXT_RE.sub("", text, count=1).strip()
    groups = re.findall(r"\b\d{7,13}\b", remainder)
    result = []
    seen: set = set()
    for g in groups:
        norm = normalize_phone(g)
        if 7 <= len(norm) <= 13 and norm not in seen and not _is_helpline(norm):
            seen.add(norm)
            result.append(norm)
    for ph in extract_all_phones_from_text(text, label_context=True):
        if ph not in seen and not _is_helpline(ph):
            seen.add(ph)
            result.append(ph)
    return result


def _is_helpline(norm: str) -> bool:
    if len(norm) < 7:
        return True
    if any(norm.startswith(h) for h in {"1800", "1860", "1890", "0800", "0900"}):
        return True
    return norm in {"112", "100", "101", "102", "104", "108", "1098", "181", "1091"}

# =============================================================================
# v9.3: Date-only extraction (strips time portion from datetime strings)
# =============================================================================

def extract_date_only(text: str) -> str:
    """
    Strip time portion from datetime strings.
    Handles: "29-04-2018 & 09:02:38 PM", "2024-04-12 21:26:06",
             "04/12/2024 @ 09:15", "17/11/2024 14:14" etc.
    Returns just the date part.
    """
    if not text:
        return text
    t = text.strip()

    # Pattern 1: date & time  (e.g. 29-04-2018 & 09:02:38 PM)
    m = re.match(r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*[&@]\s*\d{1,2}:\d{2}", t)
    if m:
        return m.group(1)

    # Pattern 2: ISO datetime  (2024-04-12 21:26:06 or 2024-04-12T21:26)
    m = re.match(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})[T\s]\d{1,2}:\d{2}", t)
    if m:
        return m.group(1)

    # Pattern 3: date[space]time  (17/11/2024 14:14  or  04/12/2024 9:02)
    m = re.match(r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+\d{1,2}:\d{2}", t)
    if m:
        return m.group(1)

    return t


# =============================================================================
# v9.3: Landline phone extraction with STD code and internal spaces
# =============================================================================

_LANDLINE_WITH_SPACE_RE = re.compile(
    r"0(\d{2,4})[\s\-](\d{3,4})[\s](\d{3,4})"   # 044-4855 5525
    r"|0(\d{2,4})[\s\-](\d{6,8})",               # 044-48555525
)

def extract_landline_from_label_line(text: str) -> Optional[str]:
    """
    Extract landline number from a line with a phone label prefix.
    Handles: Ph:044-4855 5525, Tel:022-2234 5678, etc.
    Returns the full number with STD code (e.g. 04448555525).
    """
    # Strip label
    rest = _PHONE_LABEL_CONTEXT_RE.sub("", text, count=1).strip()
    if not rest:
        return None

    # Try STD with internal space: 044-4855 5525
    m = re.search(r"(0\d{2,4})[\s\-](\d{3,5})[\s\-](\d{3,5})", rest)
    if m:
        full = m.group(1) + m.group(2) + m.group(3)
        if 9 <= len(full) <= 12:
            return full

    # Try STD no space: 044-48555525
    m = re.search(r"(0\d{2,4})[\s\-](\d{6,8})", rest)
    if m:
        full = m.group(1) + m.group(2)
        if 9 <= len(full) <= 12:
            return full

    return None




# =============================================================================
# BUG-1 / BUG-5 FIX: strip_vendor_name_from_address
# =============================================================================

def strip_vendor_name_from_address(address: str, vendor_name: str) -> str:
    """
    Remove vendor name words from the beginning of an address string.

    Handles three cases that appear in real Indian invoices:
      1. Exact prefix: "SARAS RESTAURANT NH 66..." → "NH 66..."
      2. Reversed word order: "KHANAVALI7 BASAVESHWAR NO.6..." with
         name "BASAVESHWAR KHANAVALI7" → "NO.6..."
      3. Partial embedding: "Restaurant DESI FOOD JUNCTION Shop No..."
         with name "DESI FOOD JUNCTION" → "Shop No..."

    Only strips if at least 5 characters remain after stripping.
    Called at: (a) each addr_part in Tier-1, (b) after Tier-3 selection,
               (c) final cleanup in extract_expense_data.
    """
    if not address or not vendor_name:
        return address

    addr_clean = address.strip()
    name_clean = vendor_name.strip()

    # Strategy 1: Exact case-insensitive prefix
    if addr_clean.lower().startswith(name_clean.lower()):
        rest = addr_clean[len(name_clean):].strip().lstrip(",-/ ")
        if rest and len(rest) >= 5:
            logger.info("  [addr-strip] exact prefix removed: %r", name_clean[:40])
            return rest

    # Strategy 2: All significant name words found at start (any order)
    name_words = set(
        w.upper() for w in re.findall(r"[A-Z0-9]+", name_clean) if len(w) > 2
    )
    if not name_words:
        return addr_clean

    addr_upper = addr_clean.upper()
    addr_words_ordered = re.findall(r"[A-Z0-9]+", addr_upper)

    found_name_words: set = set()
    char_pos = 0
    for word in addr_words_ordered:
        if word in name_words:
            found_name_words.add(word)
        m = re.search(re.escape(word), addr_upper[char_pos:])
        if m:
            char_pos += m.end()
        if found_name_words >= name_words:
            rest = addr_clean[char_pos:].strip().lstrip(",-/ ")
            if rest and len(rest) >= 5:
                logger.info(
                    "  [addr-strip] word-set prefix removed (%d/%d words)",
                    len(found_name_words), len(name_words),
                )
                return rest
            break

    return addr_clean


# =============================================================================
# BUG-2 FIX: Correct address part deduplication
# =============================================================================

def _dedup_address_parts(parts: List[str]) -> List[str]:
    """
    Deduplicate address parts using exact normalized match + substring removal.

    Replaces the broken v9.1 character-overlap heuristic which counted
    individual character membership (not substring containment), causing
    valid distinct address lines to be incorrectly dropped.

    Step 1: Remove exact duplicates (normalized: lowercase + alnum only).
    Step 2: Remove shorter parts whose normalized form is fully contained
            within a longer part's normalized form (keep the richer version).
    """
    if not parts:
        return parts

    normalized = [
        (p, re.sub(r"[^a-z0-9]", "", p.lower()))
        for p in parts
    ]

    # Step 1: exact duplicate removal
    seen: set = set()
    deduped: List[Tuple[str, str]] = []
    for orig, norm in normalized:
        if norm and norm not in seen:
            seen.add(norm)
            deduped.append((orig, norm))

    # Step 2: remove parts fully contained in a longer part
    result: List[str] = []
    for i, (orig_i, norm_i) in enumerate(deduped):
        is_substring = any(
            i != j and norm_i and norm_i in norm_j and len(norm_i) < len(norm_j)
            for j, (_, norm_j) in enumerate(deduped)
        )
        if not is_substring:
            result.append(orig_i)

    return result


# =============================================================================
# POLYGON SKEW DETECTION
# =============================================================================

def _detect_skew(polygon: Optional[List[Dict]]) -> float:
    if not polygon or len(polygon) < 4:
        return 0.0
    try:
        top_skew    = abs(polygon[0].get("Y", 0) - polygon[1].get("Y", 0))
        bottom_skew = abs(polygon[2].get("Y", 0) - polygon[3].get("Y", 0))
        if max(top_skew, bottom_skew) > SKEW_THRESHOLD:
            return SKEW_PENALTY
    except Exception:
        pass
    return 0.0


# =============================================================================
# LABEL DIRECTION VALIDATION
# =============================================================================

def _label_direction_ok(fld: Dict) -> bool:
    try:
        ll = fld.get("LabelDetection", {}).get("Geometry", {}).get("BoundingBox", {}).get("Left")
        vl = fld.get("ValueDetection", {}).get("Geometry", {}).get("BoundingBox", {}).get("Left")
        if ll is not None and vl is not None and ll >= vl:
            return False
    except Exception:
        pass
    return True


# =============================================================================
# GROUP PROPERTIES HELPERS
# =============================================================================

def _get_group_type(fld: Dict) -> Optional[str]:
    for gp in fld.get("GroupProperties", []):
        t = gp.get("Types", [])
        if t:
            return t[0].upper()
    return None


def _get_all_group_types(fld: Dict) -> List[str]:
    result = []
    for gp in fld.get("GroupProperties", []):
        result.extend(x.upper() for x in gp.get("Types", []))
    return result


# =============================================================================
# LABEL KEYWORD DETECTION
# =============================================================================

_PHONE_LABEL_KW = {
    "phone", "mobile", "tel", "telephone", "cell", "mob", "contact", "whatsapp", "fax",
    "helpline", "helpdesk", "toll", "enquiry", "customer care", "support", "call",
    "reach", "landline", "ph ", "ph:", "ph.", "mob ", "mob:", "tele", "office no",
    "shop no", "+91", "direct", "ph no", "tel no", "tele no", "mob no", "cell no",
    "landline:", "fax:", "whatsapp:", "contact:", "mob no:",
}

def _label_suggests_phone(label: str) -> bool:
    lt = label.lower()
    return any(kw in lt for kw in _PHONE_LABEL_KW)


_GST_LABEL_KW = {
    "gst", "gstin", "gstin no", "gst no", "gst number", "tax id", "vat", "cst", "tin",
    "pan", "registration", "reg no", "tax reg", "taxpayer", "g.s.t", "g.s.t.i.n",
    "gst reg", "gst registration", "tax number", "firm gstin", "company gst",
    "seller gstin", "supplier gstin",
}

def _label_suggests_gst(label: str) -> bool:
    lt = label.lower()
    return any(kw in lt for kw in _GST_LABEL_KW)


# =============================================================================
# WEIGHTED COMPOSITE SCORE
# =============================================================================

def _score(
    type_conf:  float,
    val_conf:   float,
    label_conf: float = 0.0,
    group:      Optional[str] = None,
    is_printed: bool = True,
    skew_pen:   float = 0.0,
) -> float:
    base = (type_conf * 0.50) + (val_conf * 0.40) + (label_conf * 0.10)
    if group == GROUP_VENDOR:
        base += VENDOR_GROUP_BONUS
    if is_printed:
        base += PRINTED_BONUS
    base -= skew_pen
    return _clamp(base)


# =============================================================================
# CONSENSUS VOTING
# =============================================================================

def _apply_consensus_bonus(candidates: List[Dict], field_name: str) -> List[Dict]:
    def _nv(v: str, fn: str) -> str:
        v = v.strip().upper()
        if fn == "vendor_phone":  return normalize_phone(v)
        if fn == "total_amount":  return re.sub(r"[^\d.]", "", v)
        if fn == "vendor_gst":    return re.sub(r"[^A-Z0-9]", "", v)
        return v

    if not candidates:
        return candidates
    cnt: Counter = Counter(_nv(c["value"], field_name) for c in candidates)
    updated = []
    for c in candidates:
        nv = _nv(c["value"], field_name)
        if cnt[nv] >= 2:
            c = dict(c)
            c["score"] = _clamp(c["score"] + CONSENSUS_BONUS)
        updated.append(c)
    return updated


# =============================================================================
# BOUNDING BOX CORROBORATION
# =============================================================================

def _bbox_overlap(bb1: Dict, bb2: Dict) -> float:
    try:
        x1 = max(bb1["Left"], bb2["Left"])
        y1 = max(bb1["Top"],  bb2["Top"])
        x2 = min(bb1["Left"] + bb1["Width"],  bb2["Left"] + bb2["Width"])
        y2 = min(bb1["Top"]  + bb1["Height"], bb2["Top"]  + bb2["Height"])
        if x2 <= x1 or y2 <= y1:
            return 0.0
        inter = (x2 - x1) * (y2 - y1)
        union = (bb1["Width"] * bb1["Height"]) + (bb2["Width"] * bb2["Height"]) - inter
        return inter / union if union > 0 else 0.0
    except Exception:
        return 0.0


def _apply_bbox_corroboration(
    candidates: List[Dict], bbox_map: Dict, field_name: str
) -> List[Dict]:
    disp = {
        "bill_number":    "Bill Number",
        "vendor_name":    "Vendor Name",
        "vendor_address": "Vendor Address",
        "vendor_phone":   "Vendor Phone Number",
        "vendor_gst":     "Vendor GST Number",
        "invoice_date":   "Invoice Date",
        "total_amount":   "Total Amount",
    }.get(field_name)
    if not disp:
        return candidates
    ref = bbox_map.get(disp)
    if not isinstance(ref, dict) or "Left" not in ref:
        return candidates
    updated = []
    for c in candidates:
        cb = c.get("bbox")
        if cb and _bbox_overlap(cb, ref) > 0.25:
            c = dict(c)
            c["score"] = _clamp(c["score"] + BBOX_CORROBORATION_BONUS)
        updated.append(c)
    return updated


# =============================================================================
# VENDOR NAME NOISE / CLEANING
# =============================================================================

def _is_name_noise(text: str) -> bool:
    if not text or len(text.strip()) < 2:
        return True
    t = text.strip()
    if re.match(r"^[\d\s,.\-₹$%\/]+$", t):
        return True
    if sum(c.isdigit() for c in t) / max(len(t), 1) > 0.55:
        return True
    if _NAME_NOISE_RE.match(t):
        return True
    phones = extract_all_phones_from_text(t)
    if phones and len(re.sub(r"[\d\s\-\+\(\)\/,]", "", t)) < 5:
        return True
    if is_gst_format(re.sub(r"[^A-Z0-9]", "", t.upper())):
        return True
    if re.search(r"(www\.|https?://|@[A-Za-z])", t, re.IGNORECASE):
        return True
    return False


def _clean_name_value(text: str) -> str:
    t = text.strip()
    t = re.sub(r"^(?:name|vendor|merchant|company|store|shop|firm|from)\s*[:\-]\s*",
               "", t, flags=re.IGNORECASE)
    t = re.sub(r"^M/[sS]\.?\s*", "", t)
    t = re.sub(r"^Messrs?\.?\s+", "", t, flags=re.IGNORECASE)
    t = strip_non_ascii(t)
    t = re.sub(r"[,;\-]+$", "", t).strip()
    return t


def _is_address_noise_line(text: str) -> bool:
    if not text or len(text.strip()) < 3:
        return True
    t = text.strip().upper()
    if is_gst_format(re.sub(r"[^A-Z0-9]", "", t)):
        return True
    if re.search(r"GSTIN|GST\s*NO|GST\s*NUMBER|GST\s*REG", t):
        return True
    if re.search(r"(?:BILL|INVOICE|RECEIPT|INV)\s*(?:NO\.?|#)\s*[:\-]?\s*[A-Z0-9]", t):
        return True
    if re.search(r"THANK\s+YOU|VISIT\s+US|COME\s+AGAIN|FSSAI|CIN\s*:", t):
        return True
    return False


# =============================================================================
# TIER-1: GroupProperties = VENDOR  (BUG-1 FIXED)
# =============================================================================

def _extract_name_address_from_vendor_group(
    response: Dict,
) -> Tuple[Optional[Dict], Optional[Dict]]:
    """
    Extract vendor name and address from Textract GroupProperties=VENDOR fields.

    BUG-1 FIX: After name_cand is determined, each addr_part is passed through
    strip_vendor_name_from_address() to remove any embedded name prefix.

    BUG-2 FIX: Uses _dedup_address_parts() with correct exact + substring dedup.
    """
    vendor_fields: List[Dict] = []

    NAME_TYPES_T2 = {k for k, v in FIELD_MAPPING.items() if v == "vendor_name"}
    ADDR_TYPES_T2 = {k for k, v in FIELD_MAPPING.items() if v == "vendor_address"}

    for doc in response.get("ExpenseDocuments", []):
        for fld in doc.get("SummaryFields", []):
            page = fld.get("PageNumber", 1) or 1
            if page != 1:
                continue

            all_groups  = _get_all_group_types(fld)
            is_receiver = GROUP_RECEIVER in all_groups
            is_vendor   = GROUP_VENDOR in all_groups

            if is_receiver:
                continue

            val_obj  = fld.get("ValueDetection", {})
            value    = val_obj.get("Text", "").strip()
            val_conf = val_obj.get("Confidence", 0.0)
            if not value or val_conf < MIN_CONFIDENCE["vendor_name"]:
                continue

            value = strip_non_ascii(value)
            if not value:
                continue

            bb        = val_obj.get("Geometry", {}).get("BoundingBox", {})
            top       = bb.get("Top", 0.5)
            left      = bb.get("Left", 0.5)
            height    = bb.get("Height", 0.02)
            ftype     = fld.get("Type", {}).get("Text", "").upper()
            type_conf = fld.get("Type", {}).get("Confidence", 0.0)
            label_conf = (fld.get("LabelDetection") or {}).get("Confidence", 0.0)
            polygon   = val_obj.get("Geometry", {}).get("Polygon")
            skew_pen  = _detect_skew(polygon)

            is_name_type = ftype in NAME_TYPES_T2
            is_addr_type = ftype in ADDR_TYPES_T2
            spatial_ok   = left < 0.55

            if not is_vendor and not ((is_name_type or is_addr_type) and spatial_ok):
                continue

            composite = _score(type_conf, val_conf, label_conf,
                               GROUP_VENDOR if is_vendor else None, True, skew_pen)

            vendor_fields.append({
                "value":        value,
                "val_conf":     val_conf,
                "score":        composite,
                "top":          top,
                "left":         left,
                "height":       height,
                "type":         ftype,
                "bbox":         bb,
                "source":       f"vendor_group_{ftype}",
                "is_addr_type": is_addr_type,
            })
            logger.info("  [T1] type=%s top=%.3f left=%.3f val='%s' score=%.1f",
                        ftype, top, left, value[:50], composite)

    if not vendor_fields:
        return None, None

    vendor_fields.sort(key=lambda x: x["top"])

    name_cand  = None
    addr_parts: List[str] = []

    for vf in vendor_fields:
        text         = vf["value"]
        type_is_addr = vf.get("is_addr_type") or any(
            t in vf["type"] for t in ["ADDRESS", "LOCATION", "STREET", "CITY", "STATE", "ZIP"]
        )

        if name_cand is None and not type_is_addr:
            if "\n" in text:
                parts      = [p.strip() for p in text.split("\n") if p.strip()]
                name_clean = _clean_name_value(parts[0])
                if not _is_name_noise(name_clean):
                    name_cand = dict(vf)
                    name_cand["value"] = name_clean
                    rest = clean_address(" ".join(parts[1:]))
                    if rest:
                        addr_parts.append(rest)
                    continue

            cleaned = _clean_name_value(text)
            if not _is_name_noise(cleaned):
                name_cand = dict(vf)
                name_cand["value"] = cleaned
                continue

        # Fall through to address collection
        cleaned_addr = clean_address(text)
        if cleaned_addr and not _is_address_noise_line(cleaned_addr):
            # v9.3: store (top_coord, text) so we can sort by spatial position
            addr_parts.append((vf.get("top", 0.5), cleaned_addr))

    # v9.3: Sort addr_parts by Top coordinate to preserve spatial reading order
    addr_parts.sort(key=lambda x: x[0] if isinstance(x, tuple) else 0)
    addr_parts = [t if not isinstance(t, tuple) else t[1] for t in addr_parts]

    # BUG-1 FIX: Strip vendor name prefix from each addr_part
    if name_cand:
        vendor_name_val = name_cand["value"]
        stripped_parts: List[str] = []
        for part in addr_parts:
            stripped = strip_vendor_name_from_address(part, vendor_name_val)
            if stripped and len(stripped) >= 5:
                stripped_parts.append(stripped)
        addr_parts = stripped_parts

    addr_cand = None
    if addr_parts:
        # BUG-2 FIX: correct dedup (exact + substring, not char-overlap)
        deduped_parts = _dedup_address_parts(addr_parts)
        if deduped_parts:
            combined = clean_address(", ".join(deduped_parts))
            if combined:
                # v9.3: prepend vendor name to address if not already present
                if name_cand:
                    vname_val = name_cand["value"].strip()
                    if vname_val and not combined.upper().startswith(vname_val.upper()):
                        combined = vname_val + ", " + combined
                best_score = max(vf["score"] for vf in vendor_fields)
                addr_cand  = {
                    "value":  combined,
                    "score":  best_score,
                    "source": "vendor_group_address",
                    "bbox":   vendor_fields[0].get("bbox"),
                }

    return name_cand, addr_cand


# =============================================================================
# TIER-2: SummaryField type match
# =============================================================================

def _extract_name_address_from_summary_types(
    response: Dict,
) -> Tuple[Optional[Dict], Optional[Dict]]:
    NAME_TYPES = {k for k, v in FIELD_MAPPING.items() if v == "vendor_name"}
    ADDR_TYPES = {k for k, v in FIELD_MAPPING.items() if v == "vendor_address"}
    name_cands: List[Dict] = []
    addr_cands: List[Dict] = []

    for doc in response.get("ExpenseDocuments", []):
        for fld in doc.get("SummaryFields", []):
            if _get_group_type(fld) == GROUP_RECEIVER:
                continue
            if (fld.get("PageNumber", 1) or 1) != 1:
                continue
            ftype     = fld.get("Type", {}).get("Text", "").upper()
            type_conf = fld.get("Type", {}).get("Confidence", 0.0)
            val_obj   = fld.get("ValueDetection", {})
            value     = val_obj.get("Text", "").strip()
            val_conf  = val_obj.get("Confidence", 0.0)
            if not value:
                continue
            label_conf = (fld.get("LabelDetection") or {}).get("Confidence", 0.0)
            polygon   = val_obj.get("Geometry", {}).get("Polygon")
            skew_pen  = _detect_skew(polygon)
            bb        = val_obj.get("Geometry", {}).get("BoundingBox", {})
            top       = bb.get("Top", 0.5)
            composite = _score(type_conf, val_conf, label_conf, None, True, skew_pen)

            if ftype in NAME_TYPES and val_conf >= MIN_CONFIDENCE["vendor_name"]:
                cleaned = _clean_name_value(strip_non_ascii(value))
                if cleaned and not _is_name_noise(cleaned):
                    name_cands.append({
                        "value": cleaned, "score": composite, "top": top,
                        "source": f"summary_name_{ftype}", "bbox": bb, "height": bb.get("Height", 0.02),
                    })
            elif ftype in ADDR_TYPES and val_conf >= MIN_CONFIDENCE["vendor_address"]:
                cleaned = clean_address(strip_non_ascii(value))
                if cleaned:
                    addr_cands.append({
                        "value": cleaned, "score": composite, "top": top,
                        "source": f"summary_addr_{ftype}", "bbox": bb,
                    })

    name_cand = max(name_cands, key=lambda x: x["score"]) if name_cands else None
    addr_cand = max(addr_cands, key=lambda x: x["score"]) if addr_cands else None
    return name_cand, addr_cand


# =============================================================================
# RAW BLOCK HELPERS
# =============================================================================

def _get_raw_blocks_page1(response: Dict) -> List[Dict]:
    lines = []
    for block in response.get("Blocks", []):
        if block.get("BlockType") != "LINE":
            continue
        if (block.get("Page", 1) or 1) != 1:
            continue
        if block.get("TextType", "PRINTED") != "PRINTED":
            continue
        text = strip_non_ascii(block.get("Text", "").strip())
        if not text:
            continue
        conf = block.get("Confidence", 0.0)
        bb   = block.get("Geometry", {}).get("BoundingBox", {})
        poly = block.get("Geometry", {}).get("Polygon")
        lines.append({
            "text":     text,
            "conf":     conf,
            "top":      bb.get("Top", 0.5),
            "left":     bb.get("Left", 0.0),
            "width":    bb.get("Width", 0.0),
            "height":   bb.get("Height", 0.0),
            "bbox":     bb,
            "skew_pen": _detect_skew(poly),
        })
    lines.sort(key=lambda x: x["top"])
    return lines


def _find_gst_top_coordinate(response: Dict, found_gst: str) -> Optional[float]:
    for block in response.get("Blocks", []):
        if block.get("BlockType") not in ("LINE", "WORD"):
            continue
        if (block.get("Page", 1) or 1) != 1:
            continue
        text = (block.get("Text") or "").upper().strip()
        norm = re.sub(r"[^A-Z0-9]", "", text)
        if found_gst in norm or norm == found_gst:
            return block.get("Geometry", {}).get("BoundingBox", {}).get("Top")
    return None


# =============================================================================
# TIER-3: Geometric / spatial raw block analysis
# =============================================================================

def _extract_name_from_raw_blocks(
    blocks: List[Dict],
    already_found_name: Optional[str],
) -> Optional[Dict]:
    if already_found_name:
        return None

    name_zone = [b for b in blocks
                 if NAME_ZONE_TOP <= b["top"] <= NAME_ZONE_BOTTOM
                 and not _is_name_noise(b["text"])
                 and b["conf"] >= MIN_CONFIDENCE["vendor_name"]]
    if not name_zone:
        return None

    all_h = [b["height"] for b in blocks if b["height"] > 0]
    median_h = sorted(all_h)[len(all_h) // 2] if all_h else 0.01

    scored = []
    for b in name_zone:
        font_bonus  = 5.0 if b["height"] >= median_h * 1.1 else 0.0
        width_bonus = 3.0 if b["width"] > 0.28 else 0.0
        pos_bonus   = max(0.0, (NAME_ZONE_BOTTOM - b["top"]) * 8.0)
        addr_pen    = 3.0 if _line_has_address_structure(b["text"]) else 0.0
        s = (b["conf"] * 0.55) + font_bonus + width_bonus + pos_bonus - addr_pen - b["skew_pen"]
        cleaned = _clean_name_value(b["text"])
        if cleaned:
            scored.append({
                "value":  cleaned, "score": _clamp(s),
                "source": "raw_geometry_name", "bbox": b["bbox"],
                "top": b["top"], "height": b["height"],
            })

    if not scored:
        return None

    # Sort topmost first; use score as tiebreaker
    scored_by_top = sorted(scored, key=lambda x: (round(x["top"] * 100), -x["score"]))
    topmost = scored_by_top[0]
    topmost_top = topmost.get("top", 0.0)

    # Combine all blocks in the same horizontal band (same line)
    BAND_THRESHOLD = 0.022
    same_band_blocks = [
        b for b in name_zone
        if abs(b["top"] - topmost_top) <= BAND_THRESHOLD
    ]
    if len(same_band_blocks) > 1:
        same_band_blocks.sort(key=lambda b: b["left"])
        band_texts = []
        for b in same_band_blocks:
            cleaned = _clean_name_value(b["text"])
            if cleaned and cleaned not in band_texts:
                band_texts.append(cleaned)
        combined_name = " ".join(band_texts).strip()
        combined_name = re.sub(r"\s{2,}", " ", combined_name)
        if combined_name and len(combined_name) <= 80:
            topmost = dict(topmost)
            topmost["value"] = combined_name
            logger.info("  [T3-name-band-combine] '%s'", combined_name)

    return topmost


def _extract_address_from_raw_blocks(
    blocks: List[Dict],
    name_top: float,
    name_height: float,
    gst_top: Optional[float],
    already_found_addr: Optional[str],
    vendor_name_words: Optional[set] = None,
) -> Optional[Dict]:
    """
    BUG-4 FIX: zone_start = name_top + name_height + 0.003
               (not just name_top + 0.004) to exclude the name line itself.

    BUG-4b FIX: blocks whose word-set is a subset of vendor name words
                are filtered out before building address clusters.

    BUG-2 FIX: raw line dedup uses _dedup_address_parts().
    """
    if already_found_addr and len(already_found_addr) > 30:
        return None

    # BUG-4 FIX: use name_height so we skip the name line entirely
    zone_start = max(name_top + name_height + 0.003, ADDR_ZONE_TOP)
    raw_zone_end = (gst_top - 0.004) if gst_top and gst_top > zone_start else ADDRESS_FOOTER_TOP
    zone_end = max(zone_start + 0.05, min(raw_zone_end, ADDRESS_FOOTER_TOP))

    if not vendor_name_words:
        vendor_name_words = set()

    candidates = []
    for b in blocks:
        if not (zone_start <= b["top"] <= zone_end):
            continue
        if b["conf"] < MIN_CONFIDENCE["vendor_address"]:
            continue
        if _is_address_noise_line(b["text"]):
            continue
        if _is_name_noise(b["text"]):
            continue
        # BUG-4b FIX: skip blocks whose words are all part of the vendor name
        if vendor_name_words:
            block_words = set(
                w.upper() for w in re.findall(r"[A-Z0-9]+", b["text"]) if len(w) > 2
            )
            if block_words and block_words <= vendor_name_words:
                logger.info("  [T3-addr] skipping name-word block: '%s'", b["text"][:40])
                continue
        candidates.append(b)

    if not candidates:
        return None

    clusters: List[List[Dict]] = []
    current: List[Dict] = []
    for b in candidates:
        if not current:
            current.append(b)
        elif b["top"] - current[-1]["top"] <= MAX_ADDRESS_LINE_GAP:
            current.append(b)
        else:
            clusters.append(current)
            current = [b]
    if current:
        clusters.append(current)

    def _cluster_score(cl: List[Dict]) -> float:
        nearness     = max(0.0, 1.0 - cl[0]["top"]) * 20.0
        length_bonus = min(len(cl) * 2.0, 10.0)
        struct_bonus = sum(3.0 for b in cl if _line_has_address_structure(b["text"]))
        avg_conf     = sum(b["conf"] for b in cl) / len(cl)
        return (avg_conf * 0.40) + nearness + length_bonus + struct_bonus

    best = max(clusters, key=_cluster_score)
    parts = [
        clean_address(b["text"]) for b in best[:6]
        if clean_address(b["text"]) and not _is_address_noise_line(b["text"])
    ]
    if not parts:
        return None

    # BUG-2 FIX: use correct dedup
    deduped = _dedup_address_parts(parts)
    combined = clean_address(", ".join(deduped)) if deduped else ""
    if not combined or len(combined) < 5:
        return None

    avg_conf = sum(b["conf"] for b in best[:6]) / len(best[:6])
    logger.info("  [T3-addr] lines=%d top=%.3f: '%s'", len(best), best[0]["top"], combined[:60])
    return {
        "value":  combined,
        "score":  _clamp(avg_conf * 0.68 + len(best) * 1.5),
        "source": "raw_geometry_address",
        "bbox":   best[0]["bbox"],
    }


# =============================================================================
# MASTER ORCHESTRATOR: vendor name + address
# =============================================================================

def extract_vendor_name_and_address(
    response: Dict,
    found_gst: Optional[str] = None,
) -> Tuple[Optional[ExtractedField], Optional[ExtractedField]]:
    raw_blocks = _get_raw_blocks_page1(response)

    t1_name, t1_addr = _extract_name_address_from_vendor_group(response)
    logger.info("[NameAddr T1] name=%s | addr=%s",
                (t1_name["value"] if t1_name else "—")[:40],
                (t1_addr["value"] if t1_addr else "—")[:40])

    t2_name, t2_addr = _extract_name_address_from_summary_types(response)
    logger.info("[NameAddr T2] name=%s | addr=%s",
                (t2_name["value"] if t2_name else "—")[:40],
                (t2_addr["value"] if t2_addr else "—")[:40])

    # Merge name
    name_cand = None
    if t1_name and t2_name:
        if t1_name["value"].upper().strip() == t2_name["value"].upper().strip():
            t1_name = dict(t1_name)
            t1_name["score"] = _clamp(t1_name["score"] + CONSENSUS_BONUS)
            name_cand = t1_name
        else:
            name_cand = t1_name if t1_name["score"] >= t2_name["score"] else t2_name
    else:
        name_cand = t1_name or t2_name

    # Merge address
    addr_cand = None
    if t1_addr and t2_addr:
        addr_cand = t1_addr if len(t1_addr["value"]) >= len(t2_addr["value"]) else t2_addr
    else:
        addr_cand = t1_addr or t2_addr

    # BUG-4 FIX: track name height
    name_top    = name_cand.get("top",    0.0)  if name_cand else 0.0
    name_height = name_cand.get("height", 0.02) if name_cand else 0.02
    gst_top     = _find_gst_top_coordinate(response, found_gst) if found_gst else None

    # BUG-4b: Build vendor name word set for Tier-3 filtering
    vendor_name_words_set: Optional[set] = None
    if name_cand:
        vendor_name_words_set = set(
            w.upper() for w in re.findall(r"[A-Z0-9]+", name_cand["value"]) if len(w) > 2
        )

    # Tier-3: geometric fallback for name
    if name_cand is None:
        t3_name = _extract_name_from_raw_blocks(raw_blocks, None)
        if t3_name:
            name_cand           = t3_name
            name_top            = t3_name.get("top",    0.0)
            name_height         = t3_name.get("height", 0.02)
            vendor_name_words_set = set(
                w.upper() for w in re.findall(r"[A-Z0-9]+", t3_name["value"]) if len(w) > 2
            )
            logger.info("[NameAddr T3] name='%s'", t3_name["value"][:50])

    # Tier-3: geometric fallback for address
    if not addr_cand or len(addr_cand.get("value", "")) < 25:
        t3_addr = _extract_address_from_raw_blocks(
            raw_blocks,
            name_top=name_top,
            name_height=name_height,
            gst_top=gst_top,
            already_found_addr=addr_cand["value"] if addr_cand else None,
            vendor_name_words=vendor_name_words_set,
        )
        if t3_addr and (not addr_cand or len(t3_addr["value"]) > len(addr_cand["value"])):
            addr_cand = t3_addr
            logger.info("[NameAddr T3] addr='%s'", t3_addr["value"][:60])

    # BUG-5 FIX: Strip vendor name from address as final insurance
    if addr_cand and name_cand:
        stripped = strip_vendor_name_from_address(addr_cand["value"], name_cand["value"])
        if stripped and stripped != addr_cand["value"] and len(stripped) >= 5:
            addr_cand = dict(addr_cand)
            addr_cand["value"] = stripped
            logger.info("[NameAddr post-strip] addr='%s'", stripped[:60])

    # v9.3: Prepend vendor name to address (user requirement: name first)
    if addr_cand and name_cand:
        vname_val = name_cand["value"].strip()
        addr_val  = addr_cand["value"].strip()
        if vname_val and addr_val and not addr_val.upper().startswith(vname_val.upper()):
            addr_cand = dict(addr_cand)
            addr_cand["value"] = vname_val + ", " + addr_val
            logger.info("[NameAddr prepend-name] addr='%s'", addr_cand["value"][:60])

    name_ef = None
    if name_cand:
        v = name_cand["value"].strip()
        if v and len(v) >= 2:
            name_ef = ExtractedField(
                value=v,
                confidence=_clamp(name_cand.get("score", 60.0)),
                source=name_cand.get("source", "textract_first"),
            )

    addr_ef = None
    if addr_cand:
        v = clean_address(addr_cand["value"])
        if v and len(v) >= 5:
            addr_ef = ExtractedField(
                value=v,
                confidence=_clamp(addr_cand.get("score", 55.0)),
                source=addr_cand.get("source", "textract_first"),
            )

    return name_ef, addr_ef


# =============================================================================
# LAYER 1 — AnalyzeExpense SummaryFields (keyword fields)
# =============================================================================

def extract_from_textract_structured(response: Dict) -> Dict[str, ExtractedField]:
    TARGET = {"bill_number", "vendor_phone", "vendor_gst", "invoice_date", "total_amount"}
    cands: Dict[str, List[Dict]] = {fn: [] for fn in TARGET}

    def _proc(fld: Dict, page: int) -> None:
        type_obj   = fld.get("Type", {})
        ftype      = type_obj.get("Text", "").upper()
        type_conf  = type_obj.get("Confidence", 0.0)
        label_obj  = fld.get("LabelDetection") or {}
        label_text = label_obj.get("Text", "").strip()
        label_conf = label_obj.get("Confidence", 0.0)
        val_obj    = fld.get("ValueDetection", {})
        value      = val_obj.get("Text", "").strip()
        val_conf   = val_obj.get("Confidence", 0.0)

        if not value:
            return

        target = FIELD_MAPPING.get(ftype)
        if target is None:
            if _label_suggests_phone(label_text):
                target = "vendor_phone"; type_conf = max(type_conf, 50.0)
            elif _label_suggests_gst(label_text):
                target = "vendor_gst";   type_conf = max(type_conf, 50.0)

        if target not in TARGET:
            return
        if val_conf < MIN_CONFIDENCE.get(target, 0.0):
            return
        if _get_group_type(fld) == GROUP_RECEIVER:
            return
        if not _label_direction_ok(fld):
            label_conf = max(label_conf - 15.0, 0.0)

        polygon  = val_obj.get("Geometry", {}).get("Polygon")
        skew_pen = _detect_skew(polygon)
        bbox     = val_obj.get("Geometry", {}).get("BoundingBox")
        currency = (fld.get("Currency") or {}).get("Code")
        group    = _get_group_type(fld)
        comp     = _score(type_conf, val_conf, label_conf, group, True, skew_pen)

        if target == "vendor_gst":
            v_up   = value.upper()
            v_norm = re.sub(r"[^A-Z0-9]", "", v_up)
            is_gst_lbl = _label_suggests_gst(label_text)
            if re.search(r"\bTIN\b", v_up) and not is_gst_lbl:
                return
            if any(t in v_up for t in ["SERVICE TAX", "SERVICE", "VAT"]) and not is_gst_lbl:
                return
            if is_cin_format(v_norm):
                return
            if is_gst_format(v_norm):
                value = v_norm
            elif is_gst_lbl:
                fnd = extract_gst_from_text(v_up)
                value = fnd[0] if fnd else None
                if not value:
                    return
            else:
                return

        elif target == "total_amount":
            cv = clean_amount(value, currency)
            if not cv:
                return
            value = cv

        elif target == "invoice_date":
            # v9.3: strip time portion from datetime strings
            value = extract_date_only(value)
            if not value:
                return

        elif target == "vendor_phone":
            phones = extract_all_phones_from_text(value, label_context=True)
            if not phones:
                norm = normalize_phone(value)
                if 7 <= len(norm) <= 13:
                    phones = [norm]
            for ph in phones:
                if not _is_helpline(ph):
                    cands["vendor_phone"].append({
                        "value": ph, "val_conf": val_conf, "score": comp,
                        "page": page, "source": f"struct_{ftype}", "bbox": bbox,
                    })
            return

        cands[target].append({
            "value": value, "val_conf": val_conf, "score": comp,
            "page": page, "source": f"struct_{ftype}", "bbox": bbox,
        })
        logger.info("  [L1] %s via %s: '%s' score=%.1f", target, ftype, value, comp)

    for doc in response.get("ExpenseDocuments", []):
        sfs = sorted(
            [(fld.get("PageNumber", 1) or 1, fld) for fld in doc.get("SummaryFields", [])],
            key=lambda x: x[0],
        )
        for pg, fld in sfs:
            _proc(fld, pg)

    results: Dict[str, ExtractedField] = {}
    for fn, candidates in cands.items():
        if not candidates:
            continue
        candidates = _apply_consensus_bonus(candidates, fn)
        page1 = [c for c in candidates if c.get("page", 1) == 1]
        pool  = page1 if page1 else candidates

        if fn == "vendor_phone":
            seen: set = set()
            phones: List[str] = []
            best_s, best_src = 0.0, ""
            for c in sorted(pool, key=lambda x: x["score"], reverse=True):
                n = normalize_phone(c["value"])
                if _is_helpline(n) or len(n) < 7:
                    continue
                if n not in seen:
                    seen.add(n); phones.append(n)
                if c["score"] > best_s:
                    best_s = c["score"]; best_src = c["source"]
            if phones:
                results[fn] = ExtractedField(
                    value=", ".join(phones[:3]),
                    confidence=_clamp(best_s), source=best_src,
                )

        elif fn == "total_amount":
            def _num(v: str) -> float:
                try:
                    return float(re.sub(r"[^\d.]", "", v))
                except Exception:
                    return 0.0
            best = max(page1 if page1 else candidates, key=lambda x: _num(x["value"]))
            results[fn] = ExtractedField(
                value=best["value"], confidence=_clamp(best["score"]), source=best["source"]
            )

        else:
            best = max(page1 if page1 else candidates, key=lambda x: x["score"])
            results[fn] = ExtractedField(
                value=best["value"], confidence=_clamp(best["score"]), source=best["source"]
            )

        logger.info("  [L1 sel] %s: '%s' conf=%.1f", fn, results[fn].value, results[fn].confidence)
    return results


# =============================================================================
# LAYER 2 — FORMS Key-Value Pairs
# =============================================================================

def extract_from_form_key_values(
    form_key_values: List[Dict],
    bbox_map: Optional[Dict] = None,
    missing_fields: Optional[List[str]] = None,
) -> Dict[str, ExtractedField]:
    target_fields = set(missing_fields) if missing_fields else set(MIN_CONFIDENCE.keys())
    cands: Dict[str, List[Dict]] = {fn: [] for fn in target_fields}
    bbox_map = bbox_map or {}

    for kv in form_key_values:
        key_raw  = kv.get("Key", "").strip().lower()
        val_raw  = kv.get("Value", "").strip()
        val_conf = kv.get("Confidence", 0.0)
        kv_bbox  = kv.get("BoundingBox")

        if not key_raw or not val_raw:
            continue

        for fn, hints in FORM_KEY_HINTS.items():
            if fn not in target_fields:
                continue
            if not any(hint in key_raw for hint in hints):
                continue
            if val_conf < MIN_CONFIDENCE.get(fn, 0.0):
                continue

            processed = val_raw
            if fn == "invoice_date":
                # v9.3: strip time from datetime strings in FORMS values
                processed = extract_date_only(val_raw)
                if not processed:
                    continue
            elif fn == "vendor_gst":
                norm = re.sub(r"[^A-Z0-9]", "", val_raw.upper())
                if is_gst_format(norm):
                    processed = norm
                else:
                    fnd = extract_gst_from_text(val_raw.upper())
                    processed = fnd[0] if fnd else None
                if not processed:
                    continue
            elif fn == "vendor_address":
                processed = clean_address(val_raw)
                if not processed:
                    continue
            elif fn == "vendor_name":
                processed = _clean_name_value(strip_non_ascii(val_raw))
                if not processed or _is_name_noise(processed):
                    continue
            elif fn == "total_amount":
                processed = clean_amount(val_raw)
                if not processed:
                    continue
            elif fn == "vendor_phone":
                phones = extract_all_phones_from_text(val_raw, label_context=True)
                if not phones:
                    for g in re.findall(r"\b\d{7,13}\b", val_raw):
                        n = normalize_phone(g)
                        if 7 <= len(n) <= 13:
                            phones.append(n)
                valid = [p for p in phones if not _is_helpline(p)]
                if not valid:
                    continue
                processed = ", ".join(valid[:3])

            score = _clamp(val_conf * 0.85)
            cands.setdefault(fn, []).append({
                "value": processed, "val_conf": val_conf,
                "score": score, "source": f"forms_{key_raw}", "bbox": kv_bbox,
            })
            break

    results: Dict[str, ExtractedField] = {}
    for fn, candidates in cands.items():
        if candidates:
            candidates = _apply_consensus_bonus(candidates, fn)
            if bbox_map:
                candidates = _apply_bbox_corroboration(candidates, bbox_map, fn)
            if fn == "total_amount":
                def _num(v):
                    try: return float(re.sub(r"[^\d.]", "", v))
                    except: return 0.0
                best = max(candidates, key=lambda x: _num(x["value"]))
            else:
                best = max(candidates, key=lambda x: x["score"])
            results[fn] = ExtractedField(
                value=best["value"], confidence=_clamp(best["score"]), source=best["source"]
            )
    return results


# =============================================================================
# LAYER 3 — Raw LINE Fallback (keyword fields only)
# =============================================================================

def extract_from_raw_lines_fallback(
    response: Dict,
    missing_fields: List[str],
    bbox_map: Optional[Dict] = None,
) -> Dict[str, ExtractedField]:
    SKIP = {"vendor_name", "vendor_address"}
    missing_fields = [f for f in missing_fields if f not in SKIP]

    results: Dict[str, ExtractedField] = {}
    bbox_map = bbox_map or {}
    all_lines: List[Dict] = []

    for block in response.get("Blocks", []):
        if block.get("BlockType") != "LINE":
            continue
        text = strip_non_ascii(block.get("Text", "").strip())
        conf = block.get("Confidence", 0.0)
        if not text or conf <= 0 or (block.get("Page", 1) or 1) != 1:
            continue
        is_print = block.get("TextType", "PRINTED") == "PRINTED"
        bb   = block.get("Geometry", {}).get("BoundingBox", {})
        poly = block.get("Geometry", {}).get("Polygon")
        all_lines.append({
            "text": text, "confidence": conf, "is_printed": is_print,
            "top": bb.get("Top", 0), "skew_pen": _detect_skew(poly), "bbox": bb,
        })
    all_lines.sort(key=lambda x: x["top"])

    def _ls(item: Dict) -> float:
        s = item["confidence"] * 0.68
        if item["is_printed"]:
            s += PRINTED_BONUS
        return _clamp(s - item["skew_pen"])

    for fn in missing_fields:
        mc = MIN_CONFIDENCE.get(fn, 0.0)
        cands: List[Dict] = []

        if fn == "vendor_gst":
            for i, item in enumerate(all_lines):
                if item["confidence"] < mc:
                    continue
                text  = item["text"]
                upper = text.upper()
                gst_markers = [
                    "GST", "GSTIN", "GST NO", "GSTIN:", "GST:", "GST NUMBER",
                    "GST REG", "TAX ID", "TAXPAYER", "G.S.T", "REGISTRATION NO",
                ]
                if any(m in upper for m in gst_markers):
                    for gst in extract_gst_from_text(text):
                        if not re.search(r"\bTIN\b", upper):
                            cands.append({"value": gst, "score": _ls(item),
                                          "source": f"fb_gst_{i}", "bbox": item.get("bbox")})
                norm = re.sub(r"[^A-Z0-9]", "", text.strip().upper())
                if is_gst_format(norm) and not re.search(r"\bTIN\b", upper):
                    cands.append({"value": norm, "score": _ls(item),
                                  "source": f"fb_gst_fmt_{i}", "bbox": item.get("bbox")})

        elif fn == "invoice_date":
            _date_kws = [
                "date", "dt", "dated", "invoice date", "bill date", "receipt date",
                "txn date", "tx date", "value date", "issue date", "order date",
                "posting date", "raised on", "generated on", "sale date",
                "billing date", "visit date", "check in", "created date",
            ]
            seen_dates: set = set()
            for i, item in enumerate(all_lines):
                if item["confidence"] < mc:
                    continue
                lower  = item["text"].lower()
                has_kw = any(kw in lower for kw in _date_kws)
                if has_kw and looks_like_date(item["text"]):
                    dv = extract_date_only(item["text"])
                    nd = re.sub(r"[^0-9]", "", dv)[:8]
                    if nd not in seen_dates:
                        seen_dates.add(nd)
                        cands.append({"value": dv, "score": _ls(item),
                                      "source": f"fb_date_kw_{i}", "bbox": item.get("bbox")})
                elif looks_like_date(item["text"]) and len(item["text"]) < 40:
                    dv = extract_date_only(item["text"])
                    nd = re.sub(r"[^0-9]", "", dv)[:8]
                    if nd not in seen_dates:
                        seen_dates.add(nd)
                        cands.append({"value": dv, "score": _clamp(_ls(item) * 0.80),
                                      "source": f"fb_date_{i}", "bbox": item.get("bbox")})

        elif fn == "total_amount":
            _total_kws = [
                "total", "grand total", "net amount", "bill amount", "amount due",
                "total amount", "net payable", "payable amount", "balance due",
                "net payable amount", "net due", "total payable", "final amount",
                "gross total", "total charges", "total cost", "amount paid",
                "taxable value", "invoice total", "outstanding", "balance amount",
                "nett total", "nett amount", "nett payable",
            ]
            for i, item in enumerate(all_lines):
                if item["confidence"] < mc:
                    continue
                upper = item["text"].upper()
                if any(kw.upper() in upper for kw in _total_kws):
                    nums = re.findall(r"[\d,]+\.?\d*", item["text"])
                    if nums:
                        cv = clean_amount(nums[-1].replace(",", ""))
                        if cv:
                            cands.append({"value": cv, "score": _ls(item),
                                          "source": f"fb_total_{i}", "bbox": item.get("bbox")})

        elif fn == "bill_number":
            _bill_kws = [
                "bill no", "invoice no", "receipt no", "bill#", "inv#", "order no",
                "ref no", "token no", "challan no", "voucher no", "booking id",
                "txn id", "txn no", "job no", "work order", "memo no", "slip no",
                "ticket no", "cash memo", "pos id", "doc no", "serial no", "sr no",
                "po no", "grn no", "awb no", "lr no", "debit note", "credit note",
                "kot no", "table no",
            ]
            _bill_re = re.compile(
                r"(?:BILL\s*NO|INVOICE\s*NO|RECEIPT\s*NO|BILL\s*#|INV\s*#|"
                r"ORDER\s*NO|REF\s*NO|TOKEN\s*NO|CHALLAN\s*NO|VOUCHER\s*NO|"
                r"BOOKING\s*(?:ID|NO)|TXN\s*(?:ID|NO)|JOB\s*NO|MEMO\s*NO|"
                r"SLIP\s*NO|TICKET\s*NO|POS\s*(?:ID|NO)|DOC\s*NO|SR\s*NO|"
                r"PO\s*NO|GRN\s*NO|AWB\s*NO|LR\s*NO|KOT\s*NO|TABLE\s*NO)"
                r"\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{1,30})",
            )
            for i, item in enumerate(all_lines):
                if item["confidence"] < mc:
                    continue
                upper = item["text"].upper()
                if any(kw.upper() in upper for kw in _bill_kws):
                    m = _bill_re.search(upper)
                    if m:
                        cands.append({"value": m.group(1).strip(), "score": _ls(item),
                                      "source": f"fb_bill_{i}", "bbox": item.get("bbox")})

        elif fn == "vendor_phone":
            _phone_kws = [
                "phone", "mobile", "tel", "contact", "mob", "ph", "whatsapp", "fax",
                "helpline", "cell", "call", "reach", "landline", "enquiry", "support",
                "customer care", "toll", "direct", "office", "booking",
                "ph:", "tel:", "mob:", "fax:", "ph.", "tel.", "mob.", "contact:",
                "telephone:", "cell:", "landline:", "mob no:", "mobile no:",
            ]
            seen_ph: set = set()
            for i, item in enumerate(all_lines):
                if item["confidence"] < mc:
                    continue
                text_l = item["text"].lower()
                has_kw = any(kw in text_l for kw in _phone_kws)

                if has_kw:
                    # v9.3: first try landline-with-space extraction (Ph:044-4855 5525)
                    landline = extract_landline_from_label_line(item["text"])
                    if landline:
                        norm = normalize_phone(landline)
                        phones = [norm] if 7 <= len(norm) <= 13 else []
                    else:
                        phones = extract_phones_with_label_context(item["text"])
                else:
                    phones = extract_all_phones_from_text(item["text"])

                for ph in phones:
                    if _is_helpline(ph) or ph in seen_ph:
                        continue
                    seen_ph.add(ph)
                    score = _clamp(_ls(item) * (1.0 if has_kw else 0.82))
                    cands.append({
                        "value": ph, "score": score,
                        "source": f"fb_phone_{'kw' if has_kw else 'raw'}_{i}",
                        "bbox": item.get("bbox"),
                    })

        if cands:
            voted = _apply_consensus_bonus(cands, fn)
            if bbox_map:
                voted = _apply_bbox_corroboration(voted, bbox_map, fn)

            if fn == "vendor_phone":
                seen: set = set()
                out: List[str] = []
                best_s, best_src = 0.0, ""
                for c in sorted(voted, key=lambda x: x["score"], reverse=True):
                    if c["value"] not in seen:
                        seen.add(c["value"]); out.append(c["value"])
                    if c["score"] > best_s:
                        best_s = c["score"]; best_src = c["source"]
                    if len(out) >= 3:
                        break
                if out:
                    results[fn] = ExtractedField(
                        value=", ".join(out), confidence=_clamp(best_s), source=best_src
                    )
            elif fn == "total_amount":
                def _num(v):
                    try: return float(re.sub(r"[^\d.]", "", v))
                    except: return 0.0
                best = max(voted, key=lambda x: _num(x["value"]))
                results[fn] = ExtractedField(
                    value=best["value"], confidence=_clamp(best["score"]), source=best["source"]
                )
            else:
                best = max(voted, key=lambda x: x["score"])
                results[fn] = ExtractedField(
                    value=best["value"], confidence=_clamp(best["score"]), source=best["source"]
                )
            logger.info("  [L3] %s: '%s' conf=%.1f", fn, results[fn].value, results[fn].confidence)

    return results


# =============================================================================
# MAIN EXTRACTION ENGINE
# =============================================================================

def extract_expense_data(response: Dict) -> Dict[str, Any]:
    """
    v9.2 extraction pipeline.

    Confidence: always 0.00 – 99.00.

    ADDRESS FIXES (v9.2):
      - strip_vendor_name_from_address() at every stage
      - Correct _dedup_address_parts() (exact + substring, not char-overlap)
      - BUG-3: final cleanup does NOT split/dedup on commas
      - BUG-4: name_height used for address zone_start
      - BUG-4b: vendor name words filtered from raw address blocks
      - BUG-5: final strip_vendor_name_from_address() pass guaranteed
    """
    t0     = time.time()
    result = ExtractionResult()
    ALL_FIELDS = [
        "bill_number", "vendor_name", "vendor_address",
        "vendor_phone", "vendor_gst", "invoice_date", "total_amount",
    ]

    try:
        logger.info("=" * 65)
        logger.info("EXTRACTION START  processor.py v%s", __version__)
        logger.info("=" * 65)

        if not response:
            logger.error("Empty response"); return result.to_dict()
        if "ExpenseDocuments" not in response and "Blocks" not in response:
            logger.error("Invalid Textract response"); return result.to_dict()

        # Pre-compute bounding boxes
        try:
            bbox_map = get_field_bounding_boxes(response)
            logger.info("[Bbox] %d bounding boxes pre-computed", len(bbox_map))
        except Exception as e:
            logger.warning("[Bbox] failed (non-fatal): %s", e)
            bbox_map = {}

        # Layer 1: keyword fields
        logger.info("\n[Layer 1] AnalyzeExpense keyword fields")
        for fn, fo in extract_from_textract_structured(response).items():
            setattr(result, fn, fo)

        # Name + Address: Textract-first engine
        logger.info("\n[NameAddr] Textract-first engine")
        gst_val = result.vendor_gst.value if result.vendor_gst.value != "Not Found" else None
        name_ef, addr_ef = extract_vendor_name_and_address(response, found_gst=gst_val)
        if name_ef:
            result.vendor_name    = name_ef
        if addr_ef:
            result.vendor_address = addr_ef
        logger.info("  name='%s' | addr='%s'",
                    result.vendor_name.value[:40], result.vendor_address.value[:40])

        # Layer 2: FORMS
        form_kv = response.get("FormKeyValues", [])
        missing  = [fn for fn in ALL_FIELDS if getattr(result, fn).value == "Not Found"]
        if form_kv and missing:
            logger.info("\n[Layer 2] FORMS — filling: %s", missing)
            for fn, fo in extract_from_form_key_values(
                form_kv, bbox_map=bbox_map, missing_fields=missing
            ).items():
                if getattr(result, fn).value == "Not Found":
                    setattr(result, fn, fo)
        else:
            logger.info("\n[Layer 2] skipped — %s",
                        "no FormKeyValues" if not form_kv else "no missing fields")

        # Layer 3: Raw LINE fallback
        missing = [fn for fn in ALL_FIELDS if getattr(result, fn).value == "Not Found"]
        kw_missing = [f for f in missing if f not in ("vendor_name", "vendor_address")]
        if kw_missing:
            logger.info("\n[Layer 3] Raw LINE fallback — %s", kw_missing)
            for fn, fo in extract_from_raw_lines_fallback(
                response, kw_missing, bbox_map=bbox_map
            ).items():
                if getattr(result, fn).value == "Not Found":
                    setattr(result, fn, fo)

        # Bbox direct rescue for phone
        if result.vendor_phone.value == "Not Found":
            _pb = bbox_map.get("Vendor Phone Number")
            if isinstance(_pb, dict):
                txt = _pb.get("text", "")
                phones = extract_all_phones_from_text(txt)
                if not phones:
                    n = normalize_phone(txt)
                    if 7 <= len(n) <= 13:
                        phones = [n]
                valid = [p for p in phones if not _is_helpline(p)]
                if valid:
                    result.vendor_phone = ExtractedField(
                        value=", ".join(valid[:3]),
                        confidence=_clamp(float(_pb.get("confidence", 60.0))),
                        source="bbox_direct_phone",
                    )

        for fn, disp in {
            "bill_number": "Bill Number", "invoice_date": "Invoice Date",
            "total_amount": "Total Amount", "vendor_gst": "Vendor GST Number",
        }.items():
            if getattr(result, fn).value != "Not Found":
                continue
            _b = bbox_map.get(disp)
            if isinstance(_b, dict):
                txt = _b.get("text", "").strip()
                if txt:
                    proc = txt
                    if fn == "invoice_date":
                        proc = extract_date_only(txt)
                    elif fn == "total_amount":
                        proc = clean_amount(txt)
                    elif fn == "vendor_gst":
                        norm = re.sub(r"[^A-Z0-9]", "", txt.upper())
                        proc = norm if is_gst_format(norm) else ""
                    if proc:
                        setattr(result, fn, ExtractedField(
                            value=proc,
                            confidence=_clamp(float(_b.get("confidence", 60.0))),
                            source=f"bbox_direct_{fn}",
                        ))

        # ── BUG-3 FIX: Final cleanup — simple whitespace only, NO comma-splitting
        # ── BUG-5 FIX: Final strip_vendor_name_from_address() pass
        if result.vendor_address.value != "Not Found":
            addr = result.vendor_address.value
            # Simple cleanup only — do NOT split on commas or dedup
            addr = re.sub(r"\s+", " ", addr).strip()
            addr = re.sub(r"^[\s,;\-\/]+|[\s,;\-\/]+$", "", addr)
            addr = re.sub(r",\s*,", ",", addr)
            addr = re.sub(r"\s{2,}", " ", addr).strip()

            # v9.3: Vendor name should be at start; strip only if it appears elsewhere
            # (do NOT strip from start since we intentionally prepend it)
            if result.vendor_name.value != "Not Found":
                vn = result.vendor_name.value.strip()
                # Only strip if name appears AFTER the first occurrence
                if addr.upper().startswith(vn.upper()):
                    pass  # correct — name is at start, leave it
                else:
                    # Name is embedded elsewhere — strip it and re-prepend
                    stripped_a = strip_vendor_name_from_address(addr, vn)
                    if stripped_a and len(stripped_a) >= 5:
                        addr = vn + ", " + stripped_a

            if addr:
                result.vendor_address.value = addr

        if result.total_amount.value != "Not Found":
            c = clean_amount(result.total_amount.value)
            if c:
                result.total_amount.value = c

        if result.vendor_gst.value != "Not Found":
            gn = re.sub(r"[^A-Z0-9]", "", result.vendor_gst.value.upper())
            if is_gst_format(gn):
                result.vendor_gst.value = gn
                st = validate_gst_state(gn)
                if st:
                    logger.info("GST verified — State: %s (code %s)", st, gn[:2])
            else:
                logger.warning("GST format invalid: '%s'", result.vendor_gst.value)

        # Summary
        elapsed     = time.time() - t0
        found_count = 0
        logger.info("\n" + "=" * 65)
        logger.info("EXTRACTION DONE (%.3fs)", elapsed)
        field_details = {}
        for fn in ALL_FIELDS:
            fo     = getattr(result, fn)
            status = "✓" if fo.value != "Not Found" else "✗"
            if fo.value != "Not Found":
                found_count += 1
            logger.info("  %s %-18s: %-42s conf=%.1f src=%s",
                        status, fn, fo.value[:42], fo.confidence, fo.source)
            field_details[fn] = {
                "value": fo.value, "confidence": fo.confidence, "source": fo.source
            }
        logger.info("  Fields: %d/%d", found_count, len(ALL_FIELDS))
        logger.info("=" * 65)

        out = result.to_dict()
        out["extraction_metadata"] = {
            "processor_version":  __version__,
            "elapsed_seconds":    round(elapsed, 3),
            "fields_found":       found_count,
            "fields_total":       len(ALL_FIELDS),
            "field_details":      field_details,
            "api_calls_used":     response.get("ProcessingMetadata", {}).get("api_calls_made", []),
            "request_ids":        response.get("ProcessingMetadata", {}).get("request_ids", {}),
            "forms_layer_ran":    response.get("ProcessingMetadata", {}).get("forms_layer_ran", False),
        }
        return out

    except Exception as exc:
        logger.error("Extraction failed: %s", exc, exc_info=True)
        return result.to_dict()


# =============================================================================
# BOUNDING BOXES — all 4 Textract sources
# =============================================================================

def get_field_bounding_boxes(response: Dict) -> Dict[str, Union[Dict, List]]:
    boxes: Dict[str, Any] = {}

    try:
        for doc in response.get("ExpenseDocuments", []):
            for fld in doc.get("SummaryFields", []):
                if _get_group_type(fld) == GROUP_RECEIVER:
                    continue
                ftype      = fld.get("Type", {}).get("Text", "").upper()
                type_conf  = fld.get("Type", {}).get("Confidence", 0.0)
                label_text = (fld.get("LabelDetection") or {}).get("Text", "").strip()
                display    = TYPE_TO_DISPLAY.get(ftype)
                if display is None:
                    if _label_suggests_phone(label_text):
                        display = "Vendor Phone Number"
                    elif _label_suggests_gst(label_text):
                        display = "Vendor GST Number"
                vd         = fld.get("ValueDetection") or {}
                geom       = vd.get("Geometry", {}).get("BoundingBox")
                tv         = (vd.get("Text") or "").strip()
                val_c      = vd.get("Confidence", 0.0)
                group_type = _get_group_type(fld) or ""
                if not (display and geom and tv):
                    continue
                if display == "Vendor GST Number" and not is_gst_format(
                    re.sub(r"[^A-Z0-9]", "", tv.upper())
                ):
                    continue
                entry = {
                    "Left": geom.get("Left"), "Top": geom.get("Top"),
                    "Width": geom.get("Width"), "Height": geom.get("Height"),
                    "confidence": _clamp(val_c), "type_confidence": _clamp(type_conf),
                    "group": group_type, "text": tv, "source": "analyze_expense",
                }
                if display == "Vendor Phone Number":
                    boxes.setdefault(display, []).append(entry)
                elif display not in boxes:
                    boxes[display] = entry

            for grp in doc.get("LineItemGroups", []):
                for item in grp.get("LineItems", []):
                    for ef in item.get("LineItemExpenseFields", []):
                        ftype2  = ef.get("Type", {}).get("Text", "").upper()
                        display = TYPE_TO_DISPLAY.get(ftype2)
                        vd      = ef.get("ValueDetection") or {}
                        geom    = vd.get("Geometry", {}).get("BoundingBox")
                        tv      = (vd.get("Text") or "").strip()
                        val_c   = vd.get("Confidence", 0.0)
                        if not (display and geom and tv) or display in boxes:
                            continue
                        boxes[display] = {
                            "Left": geom.get("Left"), "Top": geom.get("Top"),
                            "Width": geom.get("Width"), "Height": geom.get("Height"),
                            "confidence": _clamp(val_c), "text": tv,
                            "source": "analyze_expense_line_item",
                        }
    except Exception as e:
        logger.warning("BoundingBox [S1/S2]: %s", e)

    # Source 3a: raw blocks — GST
    if "Vendor GST Number" not in boxes:
        try:
            for block in response.get("Blocks", []):
                if block.get("BlockType") not in ("LINE", "WORD"):
                    continue
                if block.get("TextType", "PRINTED") != "PRINTED":
                    continue
                tv   = (block.get("Text") or "").strip()
                geom = block.get("Geometry", {}).get("BoundingBox")
                conf = block.get("Confidence", 0.0)
                norm = re.sub(r"[^A-Z0-9]", "", tv.upper())
                if geom and tv and is_gst_format(norm):
                    boxes["Vendor GST Number"] = {
                        "Left": geom.get("Left"), "Top": geom.get("Top"),
                        "Width": geom.get("Width"), "Height": geom.get("Height"),
                        "confidence": _clamp(conf), "text": norm,
                        "source": "detect_document_text",
                    }
                    break
        except Exception as e:
            logger.warning("BoundingBox [S3-GST]: %s", e)

    # Source 3b: raw blocks — Phone
    if "Vendor Phone Number" not in boxes:
        try:
            for block in response.get("Blocks", []):
                if block.get("BlockType") != "LINE":
                    continue
                if block.get("TextType", "PRINTED") != "PRINTED":
                    continue
                tv   = (block.get("Text") or "").strip()
                geom = block.get("Geometry", {}).get("BoundingBox")
                conf = block.get("Confidence", 0.0)
                if not (tv and geom):
                    continue
                valid = [p for p in extract_all_phones_from_text(tv) if not _is_helpline(p)]
                if valid:
                    boxes["Vendor Phone Number"] = {
                        "Left": geom.get("Left"), "Top": geom.get("Top"),
                        "Width": geom.get("Width"), "Height": geom.get("Height"),
                        "confidence": _clamp(conf), "text": ", ".join(valid[:3]),
                        "source": "detect_document_text_phone",
                    }
                    break
        except Exception as e:
            logger.warning("BoundingBox [S3-Phone]: %s", e)

    # Source 4: FORMS
    _fn_to_disp = {
        "bill_number":    "Bill Number",    "vendor_name":  "Vendor Name",
        "vendor_address": "Vendor Address", "vendor_phone": "Vendor Phone Number",
        "vendor_gst":     "Vendor GST Number", "invoice_date": "Invoice Date",
        "total_amount":   "Total Amount",
    }
    try:
        for kv in response.get("FormKeyValues", []):
            key_lower = kv.get("Key", "").strip().lower()
            val_raw   = kv.get("Value", "").strip()
            val_conf  = kv.get("Confidence", 0.0)
            bbox      = kv.get("BoundingBox")
            if not (val_raw and bbox):
                continue
            matched: Optional[str] = None
            for fn, hints in FORM_KEY_HINTS.items():
                if any(h in key_lower for h in hints):
                    matched = _fn_to_disp.get(fn); break
            if matched and matched not in boxes:
                if matched == "Vendor GST Number":
                    norm = re.sub(r"[^A-Z0-9]", "", val_raw.upper())
                    if not is_gst_format(norm):
                        continue
                    val_raw = norm
                boxes[matched] = {
                    "Left": bbox.get("Left"), "Top": bbox.get("Top"),
                    "Width": bbox.get("Width"), "Height": bbox.get("Height"),
                    "confidence": _clamp(val_conf), "text": val_raw,
                    "source": "analyze_document_forms",
                }
    except Exception as e:
        logger.warning("BoundingBox [S4]: %s", e)

    return boxes


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "extract_expense_data",
    "ExtractedField",
    "ExtractionResult",
    "get_field_bounding_boxes",
    "extract_from_textract_structured",
    "extract_from_form_key_values",
    "extract_from_raw_lines_fallback",
    "extract_vendor_name_and_address",
    "strip_vendor_name_from_address",
    "_dedup_address_parts",
    "clean_address",
    "clean_amount",
    "extract_all_phones_from_text",
    "is_gst_format",
    "validate_gst_state",
    "extract_gst_from_text",
    "normalize_phone",
    "strip_non_ascii",
    "looks_like_date",
    "FIELD_MAPPING",
    "TYPE_TO_DISPLAY",
    "FORM_KEY_HINTS",
    "ADDRESS_STRUCTURAL",
    "GST_STATE_CODES",
    "MIN_CONFIDENCE",
    "MAX_CONFIDENCE",
    "__version__",
]