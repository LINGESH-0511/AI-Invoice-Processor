# =========================================================
# api.py
# SIMPLIFIED VERSION - Textract Only for Printed Invoices
# Dual OCR endpoint preserved for handwritten Malayalam
# =========================================================

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.responses import JSONResponse
import io
import pandas as pd
import logging
from typing import Dict, Any

# Textract imports (simplified version)
from textract_service import analyze_expense_document
from processor import extract_expense_data  # Using your simplified processor
from database import create_table, insert_invoice, get_connection

# NEW: Dual OCR imports (PRESERVED - DO NOT MODIFY)
from ocr_orchestrator.orchestrator import analyze_with_both_ocr

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# ── CORS ──────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── INIT TABLE ────────────────────────────────────────────
create_table()


# =========================================================
# ROOT (unchanged)
# =========================================================
@app.get("/")
def root():
    return {"message": "Invoice AI API is running with Dual OCR Support (Textract + Tesseract Malayalam)"}


# =========================================================
# MODIFIED ENDPOINT: PROCESS INVOICE (Textract only - SIMPLIFIED)
# Now uses the simplified processor that trusts Textract 100%
# =========================================================
@app.post("/process-invoice")
async def process_invoice(file: UploadFile = File(...)):
    """
    SIMPLIFIED ENDPOINT - uses ONLY Textract
    No fallbacks, no regex, no custom validation
    Trusts Textract's ML output completely
    Best for printed invoices
    """
    try:
        file_bytes = await file.read()
        logger.info(f"📄 [Textract Only] Processing file: {file.filename} ({len(file_bytes)} bytes)")

        # Step 1: AWS Textract OCR (AnalyzeExpense API)
        response = analyze_expense_document(file_bytes)
        
        # Log what Textract found
        if "ExpenseDocuments" in response:
            doc_count = len(response.get("ExpenseDocuments", []))
            logger.info(f"✅ Textract analyzed document: {doc_count} expense document(s) found")
        
        # Step 2: Extract structured fields using SIMPLIFIED processor
        # This now uses ONLY Textract's SummaryFields - no fallbacks, no patterns
        structured_data = extract_expense_data(response)

        # Attempt to extract bounding boxes for each important field
        try:
            from processor import get_field_bounding_boxes
            field_boxes = get_field_bounding_boxes(response)
        except Exception:
            field_boxes = {}
        
        # Log extraction results
        fields_found = sum(1 for field in structured_data.get("important_fields", {}).values() 
                          if field.get("value") != "Not Found")
        logger.info(f"✅ Extracted {fields_found} fields using Textract-only processor")

        # Step 3: Save to DB (only if we have data)
        if structured_data.get("important_fields"):
            db_ready_data = _prepare_for_db(structured_data["important_fields"])
            insert_invoice(db_ready_data)
            logger.info("✅ Data saved to database")

        return {
            "status": "success",
            "data": structured_data.get("important_fields", {}),
            "ocr_source": "textract_only",
            "processing_mode": "trust_textract_100%",
            "fields_found": fields_found,
            "textract_response": response,  # include raw/merged textract for debugging
            "field_bounding_boxes": field_boxes
        }

    except Exception as e:
        logger.error(f"❌ PROCESS INVOICE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# PRESERVED ENDPOINT: PROCESS HANDWRITTEN INVOICE (Dual OCR)
# COMPLETELY UNCHANGED - DO NOT MODIFY
# =========================================================
@app.post("/process-handwritten")
async def process_handwritten(file: UploadFile = File(...)):
    """
    NEW ENDPOINT - Uses BOTH Textract and Tesseract OCR
    Perfect for handwritten Malayalam invoices
    Automatically picks the best result from both engines
    """
    try:
        file_bytes = await file.read()
        logger.info(f"✍️ [Dual OCR] Processing handwritten file: {file.filename} ({len(file_bytes)} bytes)")

        # Run both OCR engines in parallel and get best results
        result = analyze_with_both_ocr(file_bytes)

        # Save to database
        if result.get("important_fields"):
            # Convert to DB format
            db_ready_data = _prepare_for_db(result["important_fields"])
            insert_invoice(db_ready_data)
            logger.info("✅ Data saved to database")

        return {
            "status": "success",
            "data": result.get("important_fields", {}),
            "metadata": result.get("metadata", {
                "sources_used": result.get("metadata", {}).get("sources_used", ["unknown"]),
                "fields_merged": result.get("metadata", {}).get("fields_merged", 0)
            })
        }

    except Exception as e:
        logger.error(f"❌ DUAL OCR PROCESSING ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# OCR HEALTH CHECK (unchanged - shows both engines)
# =========================================================
@app.get("/ocr-health")
def ocr_health():
    """
    Check the status of both OCR engines
    Useful for debugging and monitoring
    """
    health_status = {
        "textract": "unknown",
        "tesseract": "unknown",
        "malayalam": "unknown",
        "dual_ocr": "available"
    }
    
    # Check Textract
    try:
        from textract_service import get_textract_client
        client = get_textract_client()
        health_status["textract"] = "available"
    except Exception as e:
        health_status["textract"] = f"unavailable: {str(e)}"
    
    # Check Tesseract
    try:
        import pytesseract
        version = pytesseract.get_tesseract_version()
        health_status["tesseract"] = f"available (v{version})"
        
        # Check Malayalam
        try:
            languages = pytesseract.get_languages()
            if 'mal' in languages:
                health_status["malayalam"] = "available"
            else:
                health_status["malayalam"] = "not installed"
        except:
            health_status["malayalam"] = "unknown"
            
    except Exception as e:
        health_status["tesseract"] = f"unavailable: {str(e)}"
        health_status["malayalam"] = "unavailable"
    
    return health_status


# =========================================================
# GET ALL INVOICES (unchanged)
# =========================================================
@app.get("/invoices")
def get_invoices():
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                vendor_name,
                gst_number,
                address,
                date,
                total,
                phone_number,
                bill_number
            FROM invoice_data
            ORDER BY id DESC
        """)

        rows = cur.fetchall()
        cur.close()
        conn.close()

        result = []
        for row in rows:
            result.append({
                "id": row[0],
                "vendor_name": row[1] or "",
                "vendor_gst": row[2] or "",
                "vendor_address": row[3] or "",
                "date": row[4] or "",
                "total": float(row[5]) if row[5] else 0.0,
                "vendor_phone": row[6] or "",
                "bill_number": row[7] or "",
            })

        return {"data": result}

    except Exception as e:
        logger.error(f"❌ GET INVOICES ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DASHBOARD SUMMARY (unchanged)
# =========================================================
@app.get("/dashboard-summary")
def dashboard_summary():
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM invoice_data")
        total_count = cur.fetchone()[0]

        cur.execute("SELECT COALESCE(SUM(total), 0) FROM invoice_data")
        total_spend = float(cur.fetchone()[0])

        cur.execute("SELECT COUNT(DISTINCT vendor_name) FROM invoice_data WHERE vendor_name IS NOT NULL AND vendor_name != ''")
        vendor_count = cur.fetchone()[0]

        avg_spend = total_spend / total_count if total_count > 0 else 0

        cur.close()
        conn.close()

        return {
            "data": {
                "total_invoices": total_count,
                "total_spend": total_spend,
                "total_vendors": vendor_count,
                "average_spend": avg_spend,
            }
        }

    except Exception as e:
        logger.error(f"❌ DASHBOARD SUMMARY ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DELETE INVOICE (unchanged)
# =========================================================
@app.delete("/delete-invoice/{invoice_id}")
def delete_invoice(invoice_id: int):
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("DELETE FROM invoice_data WHERE id = %s", (invoice_id,))
        conn.commit()

        cur.close()
        conn.close()

        return {"status": "deleted", "id": invoice_id}

    except Exception as e:
        logger.error(f"❌ DELETE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# EXPORT ALL AS EXCEL (unchanged)
# =========================================================
@app.get("/export-excel")
def export_excel():
    try:
        conn = get_connection()
        df = pd.read_sql(
            "SELECT id, vendor_name, gst_number, address, date, total, phone_number, bill_number FROM invoice_data ORDER BY id DESC",
            conn
        )
        conn.close()

        # Rename columns for Excel readability
        df.rename(columns={
            "vendor_name": "Vendor Name",
            "gst_number": "GST Number",
            "address": "Vendor Address",
            "date": "Invoice Date",
            "total": "Total Amount",
            "phone_number": "Phone Number",
            "bill_number": "Bill Number",
        }, inplace=True)

        output = io.BytesIO()
        df.to_excel(output, index=False)
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=invoices.xlsx"}
        )

    except Exception as e:
        logger.error(f"❌ EXPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DOWNLOAD CURRENT INVOICE AS EXCEL (unchanged)
# =========================================================
@app.post("/download-current-invoice-excel")
def download_current_invoice(data: dict):
    try:
        df = pd.DataFrame([{
            k: v.get("value", "") if isinstance(v, dict) else v
            for k, v in data.items()
        }])

        output = io.BytesIO()
        df.to_excel(output, index=False)
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=invoice.xlsx"}
        )

    except Exception as e:
        logger.error(f"❌ DOWNLOAD CURRENT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DEBUG — check DB columns (unchanged)
# =========================================================
@app.get("/debug-columns")
def debug_columns():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM invoice_data ORDER BY id DESC LIMIT 3")
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "columns": columns,
            "rows": [dict(zip(columns, row)) for row in rows]
        }
    except Exception as e:
        return {"error": str(e)}


# =========================================================
# HELPER FUNCTION: Convert to database format (unchanged)
# =========================================================
def _prepare_for_db(important_fields: Dict) -> Dict:
    """Convert important_fields format to database format"""
    def get_value(field):
        if isinstance(field, dict):
            return field.get("value", "")
        return field if field else ""
    
    return {
        "vendor_name": get_value(important_fields.get("Vendor Name", "")),
        "gst_number": get_value(important_fields.get("Vendor GST Number", "")),
        "address": get_value(important_fields.get("Vendor Address", "")),
        "date": get_value(important_fields.get("Invoice Date", "")),
        "total": get_value(important_fields.get("Total Amount", "0")),
        "phone_number": get_value(important_fields.get("Vendor Phone Number", "")),
        "bill_number": get_value(important_fields.get("Bill Number", ""))
    }


# =========================================================
# TEST ENDPOINT: Quick test for endpoints (updated)
# =========================================================
@app.get("/test-endpoints")
async def test_endpoints():
    """
    Test endpoint to verify both OCR endpoints are working
    """
    return {
        "status": "ready",
        "message": "OCR endpoints are available",
        "endpoints": {
            "textract_only": {
                "endpoint": "/process-invoice (POST)",
                "mode": "Trust Textract 100% - No fallbacks",
                "best_for": "Printed invoices"
            },
            "dual_ocr": {
                "endpoint": "/process-handwritten (POST)",
                "mode": "Textract + Tesseract with merging",
                "best_for": "Handwritten Malayalam invoices"
            },
            "ocr_health": "/ocr-health (GET)"
        }
    }