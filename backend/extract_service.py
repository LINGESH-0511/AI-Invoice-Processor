# =========================================================
# extract_service.py
# PURE PASSTHROUGH VERSION - USES ONLY TEXTRACT OUTPUT
# NO VALIDATION, NO FORMATTING, NO PARSING
# Simply passes through what processor.py extracted
# =========================================================

import logging
from datetime import datetime
from typing import Dict, Any

logger = logging.getLogger(__name__)


# =========================================================
# PURE PASSTHROUGH FUNCTIONS - NO PROCESSING
# =========================================================

def passthrough_field(value: str, confidence: float) -> tuple:
    """
    Simply return the value and confidence as-is - no processing.
    """
    if not value or value == "Not Found":
        return "Not Found", 0.0
    
    # Return exactly what Textract gave us
    return value, confidence


# =========================================================
# MASTER VALIDATOR - NOW JUST A PASSTHROUGH
# =========================================================

def validate_and_format_extracted_data(extracted_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Master function that simply passes through Textract's native output.
    NO validation, NO formatting, NO parsing - pure passthrough.
    """
    
    fields = extracted_data.get("important_fields", {})
    logger.info("=" * 60)
    logger.info("🔍 PROCESSING EXTRACTED FIELDS (Pure Passthrough Mode)")
    logger.info("    No validation - trusting Textract 100%")
    
    formatted_data = {
        "important_fields": {}
    }
    
    # 1. Bill Number - Pure passthrough
    bill = fields.get("Bill Number", {}).get("value", "Not Found")
    bill_conf = fields.get("Bill Number", {}).get("confidence", 0)
    clean_bill, bill_conf_adj = passthrough_field(bill, bill_conf)
    formatted_data["important_fields"]["Bill Number"] = {
        "value": clean_bill,
        "confidence": bill_conf  # Use original confidence, not adjusted
    }
    
    # 2. Vendor Name - Pure passthrough
    vendor = fields.get("Vendor Name", {}).get("value", "Not Found")
    vendor_conf = fields.get("Vendor Name", {}).get("confidence", 0)
    clean_vendor, vendor_conf_adj = passthrough_field(vendor, vendor_conf)
    formatted_data["important_fields"]["Vendor Name"] = {
        "value": clean_vendor,
        "confidence": vendor_conf
    }
    
    # 3. Address - Pure passthrough (NO vendor name prepending)
    addr = fields.get("Vendor Address", {}).get("value", "Not Found")
    addr_conf = fields.get("Vendor Address", {}).get("confidence", 0)
    clean_addr, addr_conf_adj = passthrough_field(addr, addr_conf)
    formatted_data["important_fields"]["Vendor Address"] = {
        "value": clean_addr,
        "confidence": addr_conf
    }
    
    # 4. Phone Number - Pure passthrough (NO validation)
    phone = fields.get("Vendor Phone Number", {}).get("value", "Not Found")
    phone_conf = fields.get("Vendor Phone Number", {}).get("confidence", 0)
    clean_phone, phone_conf_adj = passthrough_field(phone, phone_conf)
    formatted_data["important_fields"]["Vendor Phone Number"] = {
        "value": clean_phone,
        "confidence": phone_conf
    }
    
    # 5. GST Number - Pure passthrough (NO validation)
    gst = fields.get("Vendor GST Number", {}).get("value", "Not Found")
    gst_conf = fields.get("Vendor GST Number", {}).get("confidence", 0)
    clean_gst, gst_conf_adj = passthrough_field(gst, gst_conf)
    formatted_data["important_fields"]["Vendor GST Number"] = {
        "value": clean_gst,
        "confidence": gst_conf
    }
    
    # 6. Invoice Date - Pure passthrough (NO formatting)
    date = fields.get("Invoice Date", {}).get("value", "Not Found")
    date_conf = fields.get("Invoice Date", {}).get("confidence", 0)
    clean_date, date_conf_adj = passthrough_field(date, date_conf)
    formatted_data["important_fields"]["Invoice Date"] = {
        "value": clean_date,
        "confidence": date_conf
    }
    
    # 7. Total Amount - Pure passthrough (NO ₹ symbol, NO formatting)
    total = fields.get("Total Amount", {}).get("value", "Not Found")
    total_conf = fields.get("Total Amount", {}).get("confidence", 0)
    clean_total, total_conf_adj = passthrough_field(total, total_conf)
    formatted_data["important_fields"]["Total Amount"] = {
        "value": clean_total,
        "confidence": total_conf
    }
    
    # Log final results
    logger.info("=" * 60)
    logger.info("✅ FINAL FIELDS (Pure Textract - No Processing):")
    for field, data in formatted_data["important_fields"].items():
        logger.info(f"  {field:<25} -> '{data['value']}' ({data['confidence']}%)")
    logger.info("=" * 60)
    
    return formatted_data


# =========================================================
# CONFIDENCE SCORE CALCULATION - PRESERVE TEXTRACT
# =========================================================

def calculate_overall_confidence(formatted_data: Dict[str, Any]) -> float:
    """
    Calculate overall confidence using Textract's native scores.
    NO weighting changes - simple average.
    """
    fields = formatted_data.get("important_fields", {})
    
    if not fields:
        return 0.0
    
    # Simple average of all field confidences
    total_conf = 0
    field_count = 0
    
    for field, data in fields.items():
        if data.get("value") != "Not Found":
            total_conf += data.get("confidence", 0)
            field_count += 1
    
    if field_count == 0:
        return 0.0
    
    overall = total_conf / field_count
    logger.info(f"📊 Overall confidence: {overall:.1f}%")
    
    return round(overall, 1)


# =========================================================
# MAIN EXPORT FUNCTION - PURE PASSTHROUGH
# =========================================================

def process_extracted_data(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main entry point - PURE PASSTHROUGH MODE.
    NO validation, NO formatting, NO parsing.
    Returns exactly what Textract provided.
    """
    try:
        # Simply pass through - no validation, no formatting
        formatted = validate_and_format_extracted_data(raw_data)
        
        # Calculate overall confidence
        overall_conf = calculate_overall_confidence(formatted)
        
        return {
            "important_fields": formatted["important_fields"],
            "overall_confidence": overall_conf,
            "metadata": {
                "validated_at": datetime.now().isoformat(),
                "validator": "textract_passthrough_v1.0",
                "note": "Pure Textract output - no processing applied"
            }
        }
        
    except Exception as e:
        logger.error(f"Extraction passthrough failed: {e}")
        return {
            "important_fields": raw_data.get("important_fields", {}),
            "overall_confidence": 0.0,
            "error": str(e)
        }


# =========================================================
# EXPORT ONLY WHAT'S NEEDED
# =========================================================

__all__ = ['process_extracted_data', 'calculate_overall_confidence']