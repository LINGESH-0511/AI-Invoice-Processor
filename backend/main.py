# =========================================================
# main.py
# FASTAPI BACKEND - AI BILL ANALYSIS SYSTEM
# SIMPLIFIED VERSION - TRUSTS TEXTRACT 100%
# NO IMAGE PREPROCESSING, NO FALLBACKS
# =========================================================

from fastapi import FastAPI, UploadFile, File, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse

from textract_service import analyze_expense_document
from processor import extract_expense_data  # Using simplified processor
# Lazy-import database functions to avoid requiring DB drivers at import time
create_table = None
insert_invoice = None
fetch_invoices = None
get_connection = None

import pandas as pd
import io
import os
import uuid
import re

# =========================================================
# APP INIT
# =========================================================

app = FastAPI(title="AI Invoice Processing System")

# =========================================================
# FOLDERS
# =========================================================

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_FOLDER), name="uploads")

# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# STARTUP — create DB table on boot
# =========================================================

@app.on_event("startup")
def startup():
    try:
        # Try importing DB functions at startup; if DB libs missing, continue without DB
        global create_table, insert_invoice, fetch_invoices, get_connection
        try:
            from database import create_table as _ct, insert_invoice as _ii, fetch_invoices as _fi, get_connection as _gc
            create_table, insert_invoice, fetch_invoices, get_connection = _ct, _ii, _fi, _gc
        except Exception as e:
            print("⚠️ Database modules not available at startup:", e)
            create_table = None
        if create_table:
            create_table()
            print("✅ Database ready")
    except Exception as e:
        print("❌ Startup DB error:", str(e))


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/health")
def health():
    return {"status": "ok", "message": "Invoice AI API running"}


# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():
    return {"message": "Invoice AI API is running"}


# =========================================================
# HELPER FUNCTIONS (SIMPLIFIED)
# =========================================================

def safe_filename(name: str):
    """Sanitize filename for safe storage."""
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", name)


# =========================================================
# PROCESS INVOICE  ← FIXED - NO AUTO-SAVE
# =========================================================

@app.post("/process-invoice")
async def process_invoice(request: Request, file: UploadFile = File(...)):
    """
    SIMPLIFIED ENDPOINT - Trusts Textract 100%
    No image preprocessing, no fallbacks, no regex
    ⚠️ IMPORTANT: This endpoint does NOT save to database
       Database save happens only when frontend calls POST /invoices
    """
    try:
        # ── Read file ──────────────────────────────────────
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        # ── Save original file ─────────────────────────────
        unique_id      = str(uuid.uuid4())
        filename       = safe_filename(file.filename or "invoice")
        original_name  = f"{unique_id}_{filename}"
        original_path  = os.path.join(UPLOAD_FOLDER, original_name)

        with open(original_path, "wb") as f:
            f.write(file_bytes)

        # ── AWS Textract OCR (direct, no preprocessing) ────
        print(f"📄 Sending to Textract: {file.filename}")
        response = analyze_expense_document(file_bytes)  # Using original bytes
        print("✅ Textract analysis complete")

        # ── Extract fields using SIMPLIFIED processor ─────
        structured_data = extract_expense_data(response)
        important_fields = structured_data.get("important_fields", {})
        
        # Count fields found
        fields_found = sum(1 for field in important_fields.values() 
                          if field.get("value") != "Not Found")
        print(f"📊 Textract extracted {fields_found} fields")

        # ── Build file URL ─────────────────────────────────
        base_url     = str(request.base_url).rstrip("/")
        original_url = f"{base_url}/uploads/{original_name}"

        # ── Attempt to extract bounding boxes for each important field
        try:
            from processor import get_field_bounding_boxes
            field_boxes = get_field_bounding_boxes(response)
        except Exception:
            field_boxes = {}

        # ── REMOVED AUTO-SAVE TO DATABASE ──────────────────
        # The following block has been removed to prevent auto-saving:
        # if important_fields:
        #     insert_invoice(
        #         important_fields,
        #         invoice_image=original_url,
        #     )
        #     print("✅ Data saved to database")
        
        print("⚠️ Data NOT saved to database - waiting for frontend confirmation")

        # ── Return response ────────────────────────────────
        return {
            "status": "success",
            "data": important_fields,
            "invoice_image": original_url,
            "fields_found": fields_found,
            "processing_mode": "textract_only_no_preprocessing",
            "saved_to_db": False,  # Explicitly indicate not saved
            "message": "Data extracted successfully. Use POST /invoices to save.",
            "textract_response": response,
            "field_bounding_boxes": field_boxes
        }

    except HTTPException:
        raise

    except Exception as e:
        print(f"❌ PROCESS ERROR: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Processing failed: {str(e)}",
        )


# =========================================================
# SAVE INVOICE - NEW ENDPOINT for frontend confirmation
# =========================================================

@app.post("/invoices")
async def save_invoice(data: dict):
    """
    Save invoice to database - called when frontend clicks "Confirm & Save"
    """
    try:
        important_fields = data.get("data", {})
        invoice_image = data.get("invoice_image", "")

        if not important_fields:
            raise HTTPException(status_code=400, detail="No data to save")

        # Save to database if available
        try:
            if insert_invoice is None:
                # Try importing now
                from database import insert_invoice as _ii
                _ii(important_fields, invoice_image=invoice_image)
            else:
                insert_invoice(important_fields, invoice_image=invoice_image)
            print("✅ Invoice saved to database via confirmation")
        except Exception as e:
            print("⚠️ Could not save invoice to database:", e)
            raise HTTPException(status_code=500, detail="Database unavailable")
        
        return {
            "status": "success",
            "message": "Invoice saved successfully",
            "saved": True
        }
        
    except Exception as e:
        print(f"❌ SAVE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# GET ALL INVOICES  ← used by Dashboard
# =========================================================

@app.get("/invoices")
def get_invoices():
    """
    Returns all invoices from DB with Dashboard-compatible field names:
    vendor_gst, vendor_address, vendor_phone
    (mapped inside fetch_invoices() in database.py)
    """
    try:
        return {"data": fetch_invoices()}
    except Exception as e:
        print(f"GET INVOICES ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DASHBOARD SUMMARY
# =========================================================

@app.get("/dashboard-summary")
def dashboard_summary():
    try:
        conn = get_connection()
        cur  = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM invoice_data")
        total_count = cur.fetchone()[0]

        cur.execute("SELECT COALESCE(SUM(total), 0) FROM invoice_data")
        total_spend = float(cur.fetchone()[0])

        cur.execute("""
            SELECT COUNT(DISTINCT vendor_name)
            FROM invoice_data
            WHERE vendor_name IS NOT NULL AND vendor_name != ''
        """)
        vendor_count = cur.fetchone()[0]

        avg_spend = total_spend / total_count if total_count > 0 else 0

        cur.close()
        conn.close()

        return {
            "data": {
                "total_invoices": total_count,
                "total_spend":    total_spend,
                "total_vendors":  vendor_count,
                "average_spend":  avg_spend,
            }
        }

    except Exception as e:
        print(f"DASHBOARD SUMMARY ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DELETE INVOICE
# =========================================================

@app.delete("/delete-invoice/{invoice_id}")
def delete_invoice(invoice_id: int):
    try:
        conn = get_connection()
        cur  = conn.cursor()

        cur.execute("DELETE FROM invoice_data WHERE id = %s", (invoice_id,))
        conn.commit()

        cur.close()
        conn.close()

        return {"status": "deleted", "id": invoice_id}

    except Exception as e:
        print(f"DELETE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# EXPORT ALL INVOICES AS EXCEL
# =========================================================

@app.get("/export-excel")
def export_excel():
    try:
        conn = get_connection()
        cur  = conn.cursor()

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

        rows    = cur.fetchall()
        cur.close()
        conn.close()

        df = pd.DataFrame(rows, columns=[
            "ID", "Vendor Name", "GST Number", "Vendor Address",
            "Invoice Date", "Total Amount", "Phone Number", "Bill Number"
        ])

        output = io.BytesIO()
        df.to_excel(output, index=False)
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=invoices.xlsx"}
        )

    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DOWNLOAD CURRENT INVOICE AS EXCEL
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
        print(f"DOWNLOAD CURRENT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# DEBUG — view raw DB columns (remove in production)
# =========================================================

@app.get("/debug-columns")
def debug_columns():
    try:
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("SELECT * FROM invoice_data ORDER BY id DESC LIMIT 3")
        columns = [desc[0] for desc in cur.description]
        rows    = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "columns": columns,
            "rows":    [dict(zip(columns, row)) for row in rows]
        }
    except Exception as e:
        return {"error": str(e)}


# =========================================================
# NEW ENDPOINT: Textract Info
# =========================================================

@app.get("/textract-info")
def textract_info():
    """
    Information about Textract processing mode
    """
    return {
        "mode": "pure_textract",
        "description": "This API uses Amazon Textract AnalyzeExpense directly",
        "processing": "No preprocessing, no fallbacks, no regex patterns",
        "trust_level": "100% - We trust Textract's ML output completely"
    }