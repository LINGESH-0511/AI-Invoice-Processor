# =============================================================================
# textract_service.py  —  PRODUCTION v6.0
#
# THREE-LAYER AWS TEXTRACT PIPELINE
#   Layer 1  analyze_expense()         SummaryFields + GroupProperties + PageNumber
#   Layer 2  analyze_document(FORMS)   Key-value pairs  ← SMART GATING: only called
#                                       if Layer 1 left fields missing
#   Layer 3  detect_document_text()    Raw LINE/WORD blocks with TextType + Polygon
#
# WHAT IS NEW vs v5.x
#   ✓ Smart FORMS gating — Layer 2 only runs when Layer 1 has gaps
#       Saves an API call + latency on clean invoices
#   ✓ AWS RequestId logged for every Textract call (production debugging)
#   ✓ TextType (PRINTED vs HANDWRITING) included in Blocks so processor.py
#       can prefer PRINTED text for name/address/GST fields
#   ✓ Polygon coordinates included in Blocks so processor.py can detect
#       rotated/skewed documents and apply confidence penalties
#   ✓ FormKeyValues BoundingBox stored FLAT (Left/Top/Width/Height directly)
#       so get_field_bounding_boxes() accesses it without extra nesting
#   ✓ ProcessingMetadata includes per-layer field-found counts
#   ✓ S3 staging key defaults to .pdf when file type is UNKNOWN
#   ✓ Thread-safe Singleton (double-checked locking)
#   ✓ Exponential backoff retry on ThrottlingException
#   ✓ Auto-routes files > 5 MB to async S3 path
#
# LANGUAGE: English-only
# REGION:   ap-south-1 (Mumbai — lowest latency for India / Kerala)
# =============================================================================

import boto3
import os
import logging
import threading
import time
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
from dotenv import load_dotenv
from typing import Dict, List, Optional, Set, Tuple, Union

load_dotenv()

__version__ = "9.1.0"

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logger.addHandler(_h)

# =============================================================================
# CONFIGURATION
# =============================================================================

AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
AWS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET  = os.getenv("AWS_SECRET_ACCESS_KEY")
S3_STAGING_BUCKET = os.getenv("S3_STAGING_BUCKET", "")

THROTTLE_MAX_RETRIES = 5
THROTTLE_BASE_DELAY  = 1.0
THROTTLE_MAX_DELAY   = 32.0
SYNC_MAX_BYTES       = 5 * 1024 * 1024  # 5 MB

_TEXTRACT_CFG = Config(
    region_name=AWS_REGION,
    retries={"max_attempts": 3, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=30,
    max_pool_connections=10,
)
_S3_CFG = Config(
    region_name=AWS_REGION,
    retries={"max_attempts": 3, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=60,
)

# All 7 field names processor.py must fill
ALL_FIELDS: Set[str] = {
    "bill_number", "vendor_name", "vendor_address",
    "vendor_phone", "vendor_gst", "invoice_date", "total_amount",
}

_missing = [v for v in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY") if not os.getenv(v)]
if _missing:
    raise EnvironmentError(f"Missing required environment variables: {', '.join(_missing)}")

# =============================================================================
# THREAD-SAFE SINGLETON — TEXTRACT
# =============================================================================

class TextractClient:
    """Thread-safe Singleton boto3 Textract client (double-checked locking)."""

    _instance: Optional["TextractClient"] = None
    _lock: threading.Lock = threading.Lock()
    _client = None

    def __new__(cls) -> "TextractClient":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    obj = super().__new__(cls)
                    obj._client = None
                    obj._build()
                    cls._instance = obj
        return cls._instance

    def _build(self) -> None:
        try:
            self._client = boto3.client(
                "textract",
                aws_access_key_id=AWS_KEY_ID,
                aws_secret_access_key=AWS_SECRET,
                region_name=AWS_REGION,
                config=_TEXTRACT_CFG,
            )
            logger.info("Textract client v%s ready (region=%s)", __version__, AWS_REGION)
        except Exception as exc:
            logger.error("Textract client init failed: %s", exc)
            raise

    @property
    def client(self):
        if self._client is None:
            self._build()
        return self._client

    def test_connection(self) -> bool:
        """Probe with a 1-byte document.  Any error except AccessDenied = connected."""
        try:
            self._client.analyze_expense(Document={"Bytes": b"\x00"})
            return True
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("InvalidParameterException", "UnsupportedDocumentException",
                        "BadDocumentException", "InvalidDocumentException"):
                logger.info("Textract connection OK (code=%s)", code)
                return True
            if code in ("AccessDeniedException", "UnauthorizedException"):
                logger.error("Access denied — check IAM textract:* permissions")
                return False
            logger.error("Connection test error [%s]: %s", code, exc)
            return False
        except Exception as exc:
            logger.error("Connection test failed: %s", exc)
            return False


def get_textract_client():
    return TextractClient().client


# =============================================================================
# THREAD-SAFE SINGLETON — S3
# =============================================================================

class S3Client:
    _instance: Optional["S3Client"] = None
    _lock: threading.Lock = threading.Lock()
    _client = None

    def __new__(cls) -> "S3Client":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    obj = super().__new__(cls)
                    obj._client = None
                    obj._build()
                    cls._instance = obj
        return cls._instance

    def _build(self) -> None:
        self._client = boto3.client(
            "s3",
            aws_access_key_id=AWS_KEY_ID,
            aws_secret_access_key=AWS_SECRET,
            region_name=AWS_REGION,
            config=_S3_CFG,
        )
        logger.info("S3 client ready (region=%s)", AWS_REGION)

    @property
    def client(self):
        if self._client is None:
            self._build()
        return self._client


def get_s3_client():
    return S3Client().client


# =============================================================================
# RETRY HELPER
# =============================================================================

def _call_with_backoff(fn, *args, **kwargs):
    """Exponential backoff retry on ThrottlingException."""
    for attempt in range(1, THROTTLE_MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("ThrottlingException", "ProvisionedThroughputExceededException"):
                if attempt == THROTTLE_MAX_RETRIES:
                    raise RuntimeError(
                        f"Textract throttled — {THROTTLE_MAX_RETRIES} retries exhausted"
                    ) from exc
                wait = min(THROTTLE_BASE_DELAY * (2 ** (attempt - 1)), THROTTLE_MAX_DELAY)
                logger.warning("Throttled attempt %d/%d — retrying in %.1fs",
                               attempt, THROTTLE_MAX_RETRIES, wait)
                time.sleep(wait)
            else:
                raise


def _log_request_id(response: Dict, label: str) -> None:
    """Log AWS RequestId for every Textract API response (production debugging)."""
    req_id = (
        response.get("ResponseMetadata", {}).get("RequestId", "")
        or response.get("JobId", "")
    )
    if req_id:
        logger.info("[%s] AWS RequestId: %s", label, req_id)


# =============================================================================
# INPUT VALIDATION
# =============================================================================

def validate_file_bytes(file_bytes: Union[bytes, bytearray]) -> str:
    """Validate raw bytes.  Returns detected file type string."""
    if file_bytes is None:
        raise ValueError("file_bytes cannot be None")
    if not isinstance(file_bytes, (bytes, bytearray)):
        raise TypeError(f"Expected bytes/bytearray, got {type(file_bytes).__name__}")
    if len(file_bytes) == 0:
        raise ValueError("File is empty (0 bytes)")

    mb = len(file_bytes) / (1024 * 1024)
    if len(file_bytes) > SYNC_MAX_BYTES:
        logger.warning("File %.2f MB > 5 MB — will use async S3 path", mb)
    else:
        logger.info("File size: %.2f MB", mb)

    for sig, ftype in {b"%PDF": "PDF", b"\xff\xd8": "JPEG", b"\x89PNG\r\n\x1a\n": "PNG"}.items():
        if file_bytes.startswith(sig):
            logger.info("File type: %s", ftype)
            return ftype

    logger.warning("Unknown file signature — proceeding as PDF")
    return "PDF"   # default to PDF (not UNKNOWN) so S3 key is valid


# =============================================================================
# LARGE-FILE ASYNC PATH
# =============================================================================

def _analyze_expense_async(file_bytes: Union[bytes, bytearray], s3_key: str) -> Dict:
    if not S3_STAGING_BUCKET:
        raise RuntimeError("S3_STAGING_BUCKET env var not set — required for files > 5 MB")

    s3 = get_s3_client()
    client = get_textract_client()

    logger.info("Uploading %.2f MB to s3://%s/%s",
                len(file_bytes) / (1024 * 1024), S3_STAGING_BUCKET, s3_key)
    _call_with_backoff(s3.put_object, Bucket=S3_STAGING_BUCKET, Key=s3_key, Body=file_bytes)

    start = _call_with_backoff(
        client.start_expense_analysis,
        DocumentLocation={"S3Object": {"Bucket": S3_STAGING_BUCKET, "Name": s3_key}},
    )
    job_id = start["JobId"]
    logger.info("Async AnalyzeExpense job started: %s", job_id)

    for n in range(72):
        time.sleep(5)
        resp   = _call_with_backoff(client.get_expense_analysis, JobId=job_id)
        status = resp.get("JobStatus", "")
        logger.info("Poll %d — %s", n + 1, status)

        if status == "SUCCEEDED":
            docs  = resp.get("ExpenseDocuments", [])
            token = resp.get("NextToken")
            while token:
                page  = _call_with_backoff(client.get_expense_analysis,
                                           JobId=job_id, NextToken=token)
                docs.extend(page.get("ExpenseDocuments", []))
                token = page.get("NextToken")
            resp["ExpenseDocuments"] = docs
            try:
                s3.delete_object(Bucket=S3_STAGING_BUCKET, Key=s3_key)
            except Exception:
                logger.warning("Could not delete S3 staging file: %s", s3_key)
            _log_request_id(resp, "get_expense_analysis")
            return resp

        if status == "FAILED":
            raise RuntimeError(
                f"Async AnalyzeExpense failed: {resp.get('StatusMessage','Unknown')}"
            )

    raise RuntimeError("Async AnalyzeExpense timed out after 360s")


# =============================================================================
# FORMS KEY-VALUE EXTRACTOR
# =============================================================================

def _words_from_block(block: Dict, block_map: Dict) -> str:
    words: List[str] = []
    for rel in block.get("Relationships", []):
        if rel.get("Type") == "CHILD":
            for cid in rel.get("Ids", []):
                child = block_map.get(cid, {})
                if child.get("BlockType") == "WORD":
                    words.append(child.get("Text", ""))
    return " ".join(words)


def _extract_form_key_values(forms_response: Dict) -> List[Dict]:
    """
    Parse AnalyzeDocument FORMS response.
    Each entry: {Key, Value, Confidence, BoundingBox}
    BoundingBox stored FLAT (not nested under Geometry).
    """
    blocks    = forms_response.get("Blocks", [])
    block_map = {b["Id"]: b for b in blocks}
    results: List[Dict] = []

    for block in blocks:
        if block.get("BlockType") != "KEY_VALUE_SET":
            continue
        if "KEY" not in block.get("EntityTypes", []):
            continue

        key_text = _words_from_block(block, block_map).strip()
        if not key_text:
            continue

        value_text = ""
        value_conf = 0.0
        value_bbox: Optional[Dict] = None

        for rel in block.get("Relationships", []):
            if rel.get("Type") != "VALUE":
                continue
            for vid in rel.get("Ids", []):
                vblock = block_map.get(vid, {})
                vwords: List[str] = []
                for vrel in vblock.get("Relationships", []):
                    if vrel.get("Type") == "CHILD":
                        for wcid in vrel.get("Ids", []):
                            wc = block_map.get(wcid, {})
                            if wc.get("BlockType") == "WORD":
                                vwords.append(wc.get("Text", ""))
                if vwords:
                    value_text = " ".join(vwords)
                    value_conf = vblock.get("Confidence", 0.0)
                    # Store BoundingBox DIRECTLY — flat dict, not nested under Geometry
                    value_bbox = vblock.get("Geometry", {}).get("BoundingBox")

        if key_text and value_text.strip():
            results.append({
                "Key":         key_text,
                "Value":       value_text.strip(),
                "Confidence":  round(value_conf, 2),
                "BoundingBox": value_bbox,
            })

    logger.info("AnalyzeDocument FORMS: %d key-value pair(s)", len(results))
    return results


# =============================================================================
# HELPER — count fields found after Layer 1
# =============================================================================

# Inline type→field mapping for the 7 target fields
# (keeps textract_service independent of processor import for the gate)
_TARGET_TYPE_TO_FIELD: Dict[str, str] = {
    # Bill number
    "INVOICE_RECEIPT_ID":"bill_number","RECEIPT_ID":"bill_number","INVOICE_ID":"bill_number",
    "INVOICE_NUMBER":"bill_number","INVOICE_NO":"bill_number","BILL_NUMBER":"bill_number",
    "BILL_NO":"bill_number","RECEIPT_NUMBER":"bill_number","RECEIPT_NO":"bill_number",
    "ORDER_NUMBER":"bill_number","ORDER_ID":"bill_number","DOCUMENT_ID":"bill_number",
    "REFERENCE_NUMBER":"bill_number","REF_NO":"bill_number","POS_ID":"bill_number",
    "TOKEN_NUMBER":"bill_number","TOKEN_NO":"bill_number","CHALLAN_NUMBER":"bill_number",
    "CHALLAN_NO":"bill_number","VOUCHER_NUMBER":"bill_number","VOUCHER_NO":"bill_number",
    "BOOKING_ID":"bill_number","TRANSACTION_ID":"bill_number","TXN_ID":"bill_number",
    "JOB_NUMBER":"bill_number","WORK_ORDER":"bill_number","MEMO_NUMBER":"bill_number",
    "SLIP_NUMBER":"bill_number","TICKET_NUMBER":"bill_number","KOT_NUMBER":"bill_number",
    # Vendor name
    "VENDOR_NAME":"vendor_name","MERCHANT_NAME":"vendor_name","STORE_NAME":"vendor_name",
    "SUPPLIER_NAME":"vendor_name","SELLER_NAME":"vendor_name","BILL_FROM":"vendor_name",
    "COMPANY_NAME":"vendor_name","BUSINESS_NAME":"vendor_name","TRADING_NAME":"vendor_name",
    "SHOP_NAME":"vendor_name","ESTABLISHMENT_NAME":"vendor_name","RESTAURANT_NAME":"vendor_name",
    "HOTEL_NAME":"vendor_name","RETAILER_NAME":"vendor_name","TRADE_NAME":"vendor_name",
    "BRAND_NAME":"vendor_name","FIRM_NAME":"vendor_name","OUTLET_NAME":"vendor_name",
    # Vendor address
    "VENDOR_ADDRESS":"vendor_address","ADDRESS":"vendor_address",
    "MERCHANT_ADDRESS":"vendor_address","BILL_FROM_ADDRESS":"vendor_address",
    "SUPPLIER_ADDRESS":"vendor_address","COMPANY_ADDRESS":"vendor_address",
    "BUSINESS_ADDRESS":"vendor_address","STREET_ADDRESS":"vendor_address",
    "LOCATION":"vendor_address","REGISTERED_ADDRESS":"vendor_address",
    "CORPORATE_ADDRESS":"vendor_address","SHOP_ADDRESS":"vendor_address",
    # Vendor phone
    "VENDOR_PHONE":"vendor_phone","PHONE":"vendor_phone","TELEPHONE":"vendor_phone",
    "TEL":"vendor_phone","MOBILE":"vendor_phone","MOBILE_NUMBER":"vendor_phone",
    "CONTACT":"vendor_phone","CONTACT_NUMBER":"vendor_phone","CONTACT_NO":"vendor_phone",
    "PHONE_NUMBER":"vendor_phone","PHONE_NO":"vendor_phone","CELL":"vendor_phone",
    "CELL_PHONE":"vendor_phone","LANDLINE":"vendor_phone","WHATSAPP":"vendor_phone",
    "FAX":"vendor_phone","HELPLINE":"vendor_phone","MOB":"vendor_phone",
    "MOB_NO":"vendor_phone","PH":"vendor_phone","PH_NO":"vendor_phone",
    # Vendor GST
    "GST_NUMBER":"vendor_gst","GST":"vendor_gst","GSTIN":"vendor_gst",
    "TAX_ID":"vendor_gst","VAT_NUMBER":"vendor_gst","VAT":"vendor_gst",
    "CST_NUMBER":"vendor_gst","TAX_NUMBER":"vendor_gst","TIN_NUMBER":"vendor_gst",
    "PAN_NUMBER":"vendor_gst","REGISTRATION_NUMBER":"vendor_gst","GST_NO":"vendor_gst",
    "GSTIN_NO":"vendor_gst","GSTIN_NUMBER":"vendor_gst","GST_REG_NO":"vendor_gst",
    "GST_REGISTRATION":"vendor_gst","GST_REGISTRATION_NUMBER":"vendor_gst","PAN":"vendor_gst",
    # Invoice date
    "INVOICE_RECEIPT_DATE":"invoice_date","INVOICE_DATE":"invoice_date",
    "TRANSACTION_DATE":"invoice_date","DATE":"invoice_date","BILL_DATE":"invoice_date",
    "RECEIPT_DATE":"invoice_date","DOCUMENT_DATE":"invoice_date","ISSUE_DATE":"invoice_date",
    "CREATED_DATE":"invoice_date","INVOICED_DATE":"invoice_date","ORDER_DATE":"invoice_date",
    "PURCHASE_DATE":"invoice_date","SERVICE_DATE":"invoice_date","DATED":"invoice_date",
    "TX_DATE":"invoice_date","TXN_DATE":"invoice_date","VALUE_DATE":"invoice_date",
    "POSTING_DATE":"invoice_date","RAISED_ON":"invoice_date","CHALLAN_DATE":"invoice_date",
    "VOUCHER_DATE":"invoice_date","BILLING_DATE":"invoice_date","VISIT_DATE":"invoice_date",
    # Total amount
    "TOTAL":"total_amount","AMOUNT_DUE":"total_amount","GRAND_TOTAL":"total_amount",
    "NET_AMOUNT":"total_amount","TOTAL_AMOUNT":"total_amount","BILL_AMOUNT":"total_amount",
    "INVOICE_TOTAL":"total_amount","AMOUNT_PAYABLE":"total_amount","TOTAL_DUE":"total_amount",
    "BALANCE_DUE":"total_amount","NET_TOTAL":"total_amount","TOTAL_BILL":"total_amount",
    "FINAL_TOTAL":"total_amount","TOTAL_WITH_TAX":"total_amount","NET_PAYABLE":"total_amount",
    "PAYABLE_AMOUNT":"total_amount","NET_PAYABLE_AMOUNT":"total_amount","NET_DUE":"total_amount",
    "TOTAL_PAYABLE":"total_amount","FINAL_AMOUNT":"total_amount","GROSS_TOTAL":"total_amount",
    "TOTAL_CHARGES":"total_amount","TAXABLE_VALUE":"total_amount","AMOUNT_PAID":"total_amount",
    "GROSS_AMOUNT":"total_amount","TOTAL_VALUE":"total_amount","INVOICE_AMOUNT":"total_amount",
    "PAYABLE":"total_amount","BALANCE_AMOUNT":"total_amount","BILLED_AMOUNT":"total_amount",
}


def _count_target_fields_found(expense_docs: List[Dict]) -> Dict[str, bool]:
    """
    v9.1 FIXED: Returns {field_name: found} for the 7 target fields only.
    Uses _TARGET_TYPE_TO_FIELD (inline, no import of processor) so the count
    is accurate and not inflated by unrelated SummaryFields.
    """
    found: Dict[str, bool] = {fn: False for fn in ALL_FIELDS}
    for doc in expense_docs:
        for fld in doc.get("SummaryFields", []):
            ftype  = fld.get("Type", {}).get("Text", "").upper()
            target = _TARGET_TYPE_TO_FIELD.get(ftype)
            val    = fld.get("ValueDetection", {}).get("Text", "").strip()
            if target and val:
                found[target] = True
    return found


def _should_run_forms(expense_docs: List[Dict]) -> Tuple[bool, str, List[str]]:
    """
    v9.1 FORMS gate: based on the 7 target fields specifically.
    Always runs FORMS if vendor_phone is missing (most commonly missed).
    Returns (should_run, reason, missing_fields).
    """
    field_found = _count_target_fields_found(expense_docs)
    missing     = [fn for fn, found in field_found.items() if not found]
    found_count = len(ALL_FIELDS) - len(missing)

    logger.info(
        "[FORMS gate v9.1] Layer 1 found %d/%d target fields. Missing: %s",
        found_count, len(ALL_FIELDS), missing or "none",
    )

    if not missing:
        return (False, f"all {len(ALL_FIELDS)} target fields found in Layer 1", [])

    if missing == ["vendor_phone"]:
        return (True, "vendor_phone missing — running FORMS (often missed by AnalyzeExpense)", missing)

    return (True, f"{len(missing)} target field(s) missing", missing)


# Legacy shim for backward compatibility
def _count_found(expense_docs: List[Dict]) -> int:
    return sum(1 for v in _count_target_fields_found(expense_docs).values() if v)


# =============================================================================
# MAIN PUBLIC FUNCTION
# =============================================================================

def analyze_expense_document(
    file_bytes: Union[bytes, bytearray],
    s3_key: Optional[str] = None,
) -> Dict:
    """
    Run all three AWS Textract layers and return a merged response dict.

    Returned dict keys
    ──────────────────
    ExpenseDocuments   Layer 1  SummaryFields carry:
                                  Type.Confidence         field-type confidence
                                  Type.Text               field type string
                                  ValueDetection.*        OCR text + confidence + BoundingBox
                                  LabelDetection.*        printed label text + confidence + BoundingBox
                                  GroupProperties[].Types VENDOR / RECEIVER grouping  ← NEW
                                  PageNumber              which document page          ← NEW
                                  Currency.Code           field currency (INR/USD)     ← NEW

    Blocks             Layer 3  Each block now includes:
                                  TextType   PRINTED | HANDWRITING                     ← NEW
                                  Geometry.Polygon  4-point polygon for skew detection ← NEW
                                  Page       page number of block                      ← NEW

    FormKeyValues      Layer 2  [{Key, Value, Confidence, BoundingBox}, ...]
                                BoundingBox is flat (Left/Top/Width/Height directly)

    ProcessingMetadata           timing, RequestIds, API calls, field counts

    Smart FORMS gating: Layer 2 (analyze_document FORMS) is ONLY called if
    Layer 1 left one or more of the 7 target fields unfilled.  If AnalyzeExpense
    found all fields, Layer 2 is skipped entirely (saves API cost + ~1-2s latency).
    """
    t0        = time.time()
    api_calls: List[str] = []
    request_ids: Dict[str, str] = {}

    logger.info("=" * 65)
    logger.info("Textract Analysis  v%s  region=%s", __version__, AWS_REGION)
    logger.info("=" * 65)

    try:
        file_type = validate_file_bytes(file_bytes)
        is_large  = len(file_bytes) > SYNC_MAX_BYTES
        client    = get_textract_client()

        # ------------------------------------------------------------------ #
        # Layer 1 — AnalyzeExpense                                           #
        # ------------------------------------------------------------------ #
        expense_resp: Dict = {}
        try:
            if is_large:
                if not s3_key:
                    s3_key = (
                        f"textract_staging/inv_{int(time.time()*1000)}"
                        f".{file_type.lower()}"
                    )
                logger.info("[Layer 1] AnalyzeExpense — async S3 path")
                expense_resp = _analyze_expense_async(file_bytes, s3_key)
                api_calls.append("start_expense_analysis(async)")
            else:
                logger.info("[Layer 1] AnalyzeExpense — sync path")
                expense_resp = _call_with_backoff(
                    client.analyze_expense,
                    Document={"Bytes": file_bytes},
                )
                api_calls.append("analyze_expense")
                _log_request_id(expense_resp, "analyze_expense")
                request_ids["analyze_expense"] = (
                    expense_resp.get("ResponseMetadata", {}).get("RequestId", "")
                )

            if not expense_resp:
                raise RuntimeError("AnalyzeExpense returned empty response")

            docs = expense_resp.get("ExpenseDocuments", [])
            logger.info("[Layer 1] ExpenseDocuments: %d", len(docs))

            if docs:
                sf = docs[0].get("SummaryFields", [])
                logger.info(
                    "[Layer 1] SummaryFields: %d  |  types: %s",
                    len(sf),
                    ", ".join(f.get("Type", {}).get("Text", "") for f in sf),
                )
                # Log GroupProperties usage
                has_groups = any(f.get("GroupProperties") for f in sf)
                logger.info("[Layer 1] GroupProperties present: %s", has_groups)

        except (ClientError, BotoCoreError) as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "Unknown")
            msg  = str(exc)
            logger.error("[Layer 1] [%s]: %s", code, msg)
            if "AccessDeniedException" in msg:
                raise RuntimeError("AWS Access Denied — check IAM: textract:AnalyzeExpense")
            if "UnsupportedDocumentException" in msg:
                raise RuntimeError(f"File type '{file_type}' not supported by Textract")
            if "InvalidParameterException" in msg:
                raise RuntimeError("Invalid document — check file integrity")
            raise RuntimeError(f"AnalyzeExpense failed: {msg}")

        # ------------------------------------------------------------------ #
        # SMART GATING — decide whether FORMS layer is needed               #
        # ------------------------------------------------------------------ #
        form_key_values: List[Dict] = []
        layer2_skipped_reason = ""

        if is_large:
            layer2_skipped_reason = "file > 5 MB sync limit"
        else:
            try:
                should_run, gate_reason, missing_fields = _should_run_forms(
                    expense_resp.get("ExpenseDocuments", [])
                )

                if not should_run:
                    layer2_skipped_reason = gate_reason
                else:
                    logger.info("[Layer 2] AnalyzeDocument (FORMS) — reason: %s", gate_reason)
                    forms_resp = _call_with_backoff(
                        client.analyze_document,
                        Document={"Bytes": file_bytes},
                        FeatureTypes=["FORMS"],
                    )
                    api_calls.append("analyze_document(FORMS)")
                    _log_request_id(forms_resp, "analyze_document")
                    request_ids["analyze_document"] = (
                        forms_resp.get("ResponseMetadata", {}).get("RequestId", "")
                    )
                    form_key_values = _extract_form_key_values(forms_resp)

            except ImportError:
                # processor not importable yet (first-run circular) — run FORMS
                logger.info("[Layer 2] FORMS gate: running (processor not yet imported)")
                try:
                    forms_resp = _call_with_backoff(
                        client.analyze_document,
                        Document={"Bytes": file_bytes},
                        FeatureTypes=["FORMS"],
                    )
                    api_calls.append("analyze_document(FORMS)")
                    form_key_values = _extract_form_key_values(forms_resp)
                except Exception as exc2:
                    logger.warning("[Layer 2] failed (non-fatal): %s", exc2)

            except Exception as exc:
                logger.warning("[Layer 2] failed (non-fatal): %s", exc)

        if layer2_skipped_reason:
            logger.info("[Layer 2] skipped — %s", layer2_skipped_reason)

        # ------------------------------------------------------------------ #
        # Layer 3 — DetectDocumentText                                       #
        # Includes TextType and full Polygon for each block                  #
        # ------------------------------------------------------------------ #
        raw_blocks: List[Dict] = []
        if not is_large:
            try:
                logger.info("[Layer 3] DetectDocumentText — raw LINE/WORD blocks")
                text_resp  = _call_with_backoff(
                    client.detect_document_text,
                    Document={"Bytes": file_bytes},
                )
                api_calls.append("detect_document_text")
                _log_request_id(text_resp, "detect_document_text")
                request_ids["detect_document_text"] = (
                    text_resp.get("ResponseMetadata", {}).get("RequestId", "")
                )
                raw_blocks = text_resp.get("Blocks", [])

                line_count     = sum(1 for b in raw_blocks if b.get("BlockType") == "LINE")
                printed_count  = sum(
                    1 for b in raw_blocks
                    if b.get("BlockType") == "LINE" and b.get("TextType") == "PRINTED"
                )
                logger.info(
                    "[Layer 3] Total blocks: %d  |  LINE: %d  |  PRINTED LINE: %d",
                    len(raw_blocks), line_count, printed_count,
                )
            except Exception as exc:
                logger.warning("[Layer 3] failed (non-fatal): %s", exc)
                raw_blocks = expense_resp.get("Blocks", [])
        else:
            raw_blocks = expense_resp.get("Blocks", [])
            logger.info(
                "[Layer 3] using %d blocks from AnalyzeExpense (large file)",
                len(raw_blocks),
            )

        # ------------------------------------------------------------------ #
        # Merge all three layers                                              #
        # ------------------------------------------------------------------ #
        # Compute per-field found status for metadata
        field_found_l1 = _count_target_fields_found(
            expense_resp.get("ExpenseDocuments", [])
        )

        merged: Dict = expense_resp.copy()
        merged["Blocks"]        = raw_blocks
        merged["FormKeyValues"] = form_key_values
        merged["ProcessingMetadata"] = {
            "timestamp":            time.time(),
            "elapsed_seconds":      round(time.time() - t0, 3),
            "api_version":          __version__,
            "api_calls_made":       api_calls,
            "request_ids":          request_ids,
            "region":               AWS_REGION,
            "file_type":            file_type,
            "forms_layer_ran":      bool(form_key_values),
            "layer1_fields_found":  {k: v for k, v in field_found_l1.items()},
            "layer1_found_count":   sum(1 for v in field_found_l1.values() if v),
            "file_size_bytes":  len(file_bytes),
            "forms_layer_ran":  bool(form_key_values),
        }

        logger.info("=" * 65)
        logger.info(
            "Analysis done in %.2fs  |  Docs=%d  Blocks=%d  FormKV=%d",
            time.time() - t0,
            len(merged.get("ExpenseDocuments", [])),
            len(raw_blocks),
            len(form_key_values),
        )
        logger.info("API calls: %s", " | ".join(api_calls))
        logger.info("=" * 65)
        return merged

    except ValueError as exc:
        logger.error("Input validation: %s", exc)
        raise
    except NoCredentialsError as exc:
        logger.error("AWS credentials missing: %s", exc)
        raise RuntimeError("AWS credentials not found or invalid") from exc
    except Exception as exc:
        logger.error("Unexpected error: %s", exc, exc_info=True)
        raise RuntimeError(f"Textract analysis failed: {exc}") from exc


# =============================================================================
# EXPORTS
# =============================================================================

def test_textract_connection() -> bool:
    return TextractClient().test_connection()


__all__ = [
    "analyze_expense_document",
    "get_textract_client",
    "test_textract_connection",
    "validate_file_bytes",
    "TextractClient",
    "__version__",
]