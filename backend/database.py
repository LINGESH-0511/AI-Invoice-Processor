# =========================================================
# database.py
# ENTERPRISE STABLE — FINAL FIXED VERSION
# Exports: get_connection, create_table, insert_invoice,
#          fetch_invoices
# DB columns: vendor_name, gst_number, address, date,
#             total, phone_number, bill_number
# =========================================================

import psycopg2
import os
import re
from dotenv import load_dotenv

load_dotenv()


# =========================================================
# CONNECTION
# =========================================================

def get_connection():
    required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_PORT"]
    for var in required:
        if not os.getenv(var):
            raise Exception(f"{var} missing in .env")

    return psycopg2.connect(
        host     = os.getenv("DB_HOST"),
        database = os.getenv("DB_NAME"),
        user     = os.getenv("DB_USER"),
        password = os.getenv("DB_PASSWORD"),
        port     = os.getenv("DB_PORT"),
    )


# =========================================================
# CREATE TABLE + SAFE MIGRATION
# =========================================================

def create_table():
    """
    Creates invoice_data table if not exists.
    Safe migrations ensure old databases are upgraded.
    Called on startup from main.py.
    """
    conn = get_connection()
    cur  = conn.cursor()

    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoice_data (
                id              SERIAL PRIMARY KEY,
                vendor_name     TEXT,
                gst_number      TEXT,
                address         TEXT,
                date            TEXT,
                total           NUMERIC,
                phone_number    TEXT,
                bill_number     TEXT,
                invoice_image   TEXT,
                processed_image TEXT
            );
        """)

        # Safe migrations — won't fail if columns already exist
        migrations = [
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS gst_number      TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS address         TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS phone_number    TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS bill_number     TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS date            TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS total           NUMERIC;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS invoice_image   TEXT;",
            "ALTER TABLE invoice_data ADD COLUMN IF NOT EXISTS processed_image TEXT;",
        ]
        for sql in migrations:
            cur.execute(sql)

        conn.commit()
        print("[DB] Table ready.")

    except Exception as e:
        conn.rollback()
        print(f"[DB] create_table error: {e}")
        raise

    finally:
        cur.close()
        conn.close()


# =========================================================
# HELPERS
# =========================================================

def safe_get(data, key):
    """
    Extract value from processor.py structured output.

    processor.py output format:
    {
        "Vendor Name":         {"value": "SHIVSAGAR", "confidence": 99},
        "Vendor GST Number":   {"value": "27AASCS2460H1Z0", "confidence": 79},
        "Vendor Address":      {"value": "SHIVSAGAR, NH 3...", "confidence": 100},
        "Invoice Date":        {"value": "01/07/17", "confidence": 100},
        "Total Amount":        {"value": "419", "confidence": 55},
        "Vendor Phone Number": {"value": "Not Found", "confidence": 0},
        "Bill Number":         {"value": "53", "confidence": 99},
    }

    Returns empty string for missing or 'Not Found' values.
    """
    val = data.get(key, {}).get("value", "")
    if not val or val == "Not Found":
        return ""
    return str(val).strip()


def clean_number(value):
    """
    Convert OCR amount string to float safely.
    '₹1,234.56' → 1234.56
    '419'       → 419.0
    ''          → 0.0
    """
    if not value:
        return 0.0
    cleaned = re.sub(r"[^\d.]", "", str(value))
    if cleaned.count(".") > 1:
        parts   = cleaned.split(".")
        cleaned = parts[0] + "." + "".join(parts[1:])
    try:
        return float(cleaned) if cleaned else 0.0
    except Exception:
        return 0.0


# =========================================================
# INSERT INVOICE
# =========================================================

def insert_invoice(data, invoice_image=None, processed_image=None):
    """
    Insert extracted invoice fields into DB.
    
    ⚠️ IMPORTANT: This function should ONLY be called when
       the user clicks "Confirm & Save" in the frontend.
       Do NOT call this automatically during processing.
    
    Keys used from processor.py output:
    - "Vendor Name"
    - "Vendor GST Number"
    - "Vendor Address"
    - "Invoice Date"
    - "Total Amount"
    - "Vendor Phone Number"
    - "Bill Number"
    """
    conn = get_connection()
    cur  = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO invoice_data (
                vendor_name,
                gst_number,
                address,
                date,
                total,
                phone_number,
                bill_number,
                invoice_image,
                processed_image
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            safe_get(data, "Vendor Name"),
            safe_get(data, "Vendor GST Number"),
            safe_get(data, "Vendor Address"),
            safe_get(data, "Invoice Date"),
            clean_number(safe_get(data, "Total Amount")),
            safe_get(data, "Vendor Phone Number"),
            safe_get(data, "Bill Number"),
            invoice_image,
            processed_image,
        ))

        conn.commit()
        print(f"[DB] Invoice inserted successfully. ID: {cur.lastrowid if hasattr(cur, 'lastrowid') else 'unknown'}")

    except Exception as e:
        conn.rollback()
        print(f"[DB] insert_invoice error: {e}")
        raise

    finally:
        cur.close()
        conn.close()


# =========================================================
# FETCH ALL INVOICES
# =========================================================

def fetch_invoices():
    """
    Fetch all invoices from DB.
    Maps DB column names to Dashboard-expected field names:
      gst_number   → vendor_gst
      address      → vendor_address
      phone_number → vendor_phone
    """
    conn = get_connection()
    cur  = conn.cursor()

    try:
        cur.execute("""
            SELECT
                id,
                vendor_name,
                gst_number,
                address,
                date,
                total,
                phone_number,
                bill_number,
                invoice_image,
                processed_image
            FROM invoice_data
            ORDER BY id DESC;
        """)

        rows = cur.fetchall()

        invoices = []
        for row in rows:
            invoices.append({
                "id":              row[0],
                "vendor_name":     row[1] or "",
                "vendor_gst":      row[2] or "",   # gst_number → vendor_gst
                "vendor_address":  row[3] or "",   # address → vendor_address
                "date":            row[4] or "",
                "total":           float(row[5]) if row[5] else 0.0,
                "vendor_phone":    row[6] or "",   # phone_number → vendor_phone
                "bill_number":     row[7] or "",
                "invoice_image":   row[8] or "",
                "processed_image": row[9] or "",
            })

        print(f"[DB] Fetched {len(invoices)} invoices")
        return invoices

    except Exception as e:
        print(f"[DB] fetch_invoices error: {e}")
        return []

    finally:
        cur.close()
        conn.close()