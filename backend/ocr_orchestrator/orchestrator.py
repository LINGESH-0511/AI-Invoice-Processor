# ocr_orchestrator/orchestrator.py
"""
OCR Orchestrator - Runs BOTH Textract and Tesseract
Picks the best result from each
"""

import logging
import time
from typing import Dict, Any, Optional
import concurrent.futures
from threading import Thread

# Import Textract (existing)
from textract_service import analyze_expense_document
import processor  # Existing processor for Textract

# Import Tesseract (new)
from handwritten_ocr.tesseract_malayalam import TesseractMalayalamOCR

logger = logging.getLogger(__name__)

class OCROrchestrator:
    """
    Runs both OCR engines in parallel and selects best results
    
    How it works:
    1. Runs Textract and Tesseract simultaneously
    2. Gets results from both
    3. Compares confidence scores field by field
    4. Picks the best value for each field
    5. Returns merged result with highest possible accuracy
    """
    
    def __init__(self):
        self.textract_available = True
        self.tesseract = TesseractMalayalamOCR()
        logger.info("🚀 OCR Orchestrator initialized")
        logger.info(f"   Textract: Available")
        logger.info(f"   Tesseract: {'Available' if self.tesseract.is_available else 'Not Available'}")
    
    def analyze_document(self, file_bytes: bytes) -> Dict[str, Any]:
        """
        Main method - analyze with BOTH OCR engines
        
        Args:
            file_bytes: Raw image bytes
        
        Returns:
            Dictionary with best fields from both OCRs
        """
        start_time = time.time()
        logger.info("=" * 60)
        logger.info("🚀 Starting Dual OCR Analysis (Textract + Tesseract)")
        
        # Store results from both engines
        textract_result = None
        tesseract_result = None
        
        # =========================================
        # Run both OCRs in parallel for speed
        # =========================================
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            # Submit both tasks
            textract_future = executor.submit(self._run_textract, file_bytes)
            tesseract_future = executor.submit(self._run_tesseract, file_bytes)
            
            # Get results (with timeout)
            try:
                textract_result = textract_future.result(timeout=30)
                logger.info("✅ Textract analysis complete")
            except Exception as e:
                logger.error(f"❌ Textract failed: {e}")
                textract_result = {"important_fields": {}}
            
            try:
                tesseract_result = tesseract_future.result(timeout=30)
                logger.info("✅ Tesseract analysis complete")
            except Exception as e:
                logger.error(f"❌ Tesseract failed: {e}")
                tesseract_result = {"important_fields": {}}
        
        # =========================================
        # Combine results (pick best for each field)
        # =========================================
        final_result = self._merge_results(textract_result, tesseract_result)
        
        elapsed = time.time() - start_time
        logger.info(f"⏱️  Total processing time: {elapsed:.2f}s")
        logger.info("=" * 60)
        
        return final_result
    
    def _run_textract(self, file_bytes: bytes) -> Dict:
        """Run AWS Textract analysis"""
        try:
            # Call Textract service
            raw_response = analyze_expense_document(file_bytes)
            
            # Process with existing processor.py
            processed = processor.extract_expense_data(raw_response)
            # Try to extract bounding boxes for fields from the raw textract response
            try:
                field_boxes = processor.get_field_bounding_boxes(raw_response)
            except Exception:
                field_boxes = {}
            processed["field_bounding_boxes"] = field_boxes
            
            # Add source marker
            if "important_fields" in processed:
                for field in processed["important_fields"]:
                    if isinstance(processed["important_fields"][field], dict):
                        processed["important_fields"][field]["ocr_source"] = "textract"
            
            return processed
            
        except Exception as e:
            logger.error(f"Textract execution failed: {e}")
            return {"important_fields": {}}
    
    def _run_tesseract(self, file_bytes: bytes) -> Dict:
        """Run Tesseract Malayalam OCR"""
        try:
            # Run Tesseract
            result = self.tesseract.analyze_document(file_bytes)
            
            # Format to match processor.py structure
            formatted = {
                "important_fields": result.get("important_fields", {}),
                "source": "tesseract",
                "success": result.get("success", False),
                "field_bounding_boxes": result.get("field_bounding_boxes", {})
            }
            
            # Add source marker
            for field in formatted["important_fields"]:
                if isinstance(formatted["important_fields"][field], dict):
                    formatted["important_fields"][field]["ocr_source"] = "tesseract"
            
            return formatted
            
        except Exception as e:
            logger.error(f"Tesseract execution failed: {e}")
            return {"important_fields": {}}
    
    def _merge_results(self, textract: Dict, tesseract: Dict) -> Dict:
        """
        Merge results from both OCRs, picking best for each field
        
        Strategy:
        - For each field, compare confidence scores
        - Pick the one with higher confidence
        - If one engine missed the field, use the other
        """
        logger.info("\n📊 Merging results from both OCR engines...")
        
        # Initialize final result
        final = {
            "important_fields": {},
            "metadata": {
                "sources_used": [],
                "fields_merged": 0
            }
        }
        
        # Get all possible fields
        all_fields = set()
        if "important_fields" in textract:
            all_fields.update(textract["important_fields"].keys())
        if "important_fields" in tesseract:
            all_fields.update(tesseract["important_fields"].keys())
        
        # Default fields list
        default_fields = [
            "Vendor Name", "Total Amount", "Invoice Date",
            "Vendor GST Number", "Bill Number", "Vendor Address",
            "Vendor Phone Number"
        ]
        all_fields.update(default_fields)
        
        # Compare field by field
        for field in all_fields:
            textract_field = textract.get("important_fields", {}).get(field, {})
            tesseract_field = tesseract.get("important_fields", {}).get(field, {})
            
            # Extract values and confidences
            textract_value = textract_field.get("value") if isinstance(textract_field, dict) else "Not Found"
            tesseract_value = tesseract_field.get("value") if isinstance(tesseract_field, dict) else "Not Found"
            
            textract_conf = textract_field.get("confidence", 0) if isinstance(textract_field, dict) else 0
            tesseract_conf = tesseract_field.get("confidence", 0) if isinstance(tesseract_field, dict) else 0
            
            # Decision logic
            if textract_value != "Not Found" and textract_value and textract_conf >= 70:
                # Textract has good confidence
                final["important_fields"][field] = {
                    "value": textract_value,
                    "confidence": textract_conf,
                    "source": "textract",
                    "ocr_source": "textract"
                }
                if "textract" not in final["metadata"]["sources_used"]:
                    final["metadata"]["sources_used"].append("textract")
                final["metadata"]["fields_merged"] += 1
                
                logger.info(f"  ✓ {field}: Using Textract ({textract_conf:.1f}%)")
                
            elif tesseract_value != "Not Found" and tesseract_value and tesseract_conf >= 60:
                # Tesseract has reasonable confidence (lower threshold for handwritten)
                final["important_fields"][field] = {
                    "value": tesseract_value,
                    "confidence": tesseract_conf,
                    "source": "tesseract",
                    "ocr_source": "tesseract"
                }
                if "tesseract" not in final["metadata"]["sources_used"]:
                    final["metadata"]["sources_used"].append("tesseract")
                final["metadata"]["fields_merged"] += 1
                
                logger.info(f"  ✍️ {field}: Using Tesseract ({tesseract_conf:.1f}%)")
                
            elif textract_value != "Not Found" and textract_value:
                # Textract has low confidence but at least has a value
                final["important_fields"][field] = {
                    "value": textract_value,
                    "confidence": textract_conf,
                    "source": "textract_fallback",
                    "ocr_source": "textract"
                }
                if "textract" not in final["metadata"]["sources_used"]:
                    final["metadata"]["sources_used"].append("textract")
                
                logger.info(f"  ⚠️ {field}: Textract fallback ({textract_conf:.1f}%)")
                
            elif tesseract_value != "Not Found" and tesseract_value:
                # Tesseract has low confidence but at least has a value
                final["important_fields"][field] = {
                    "value": tesseract_value,
                    "confidence": tesseract_conf,
                    "source": "tesseract_fallback",
                    "ocr_source": "tesseract"
                }
                if "tesseract" not in final["metadata"]["sources_used"]:
                    final["metadata"]["sources_used"].append("tesseract")
                
                logger.info(f"  ⚠️ {field}: Tesseract fallback ({tesseract_conf:.1f}%)")
                
            else:
                # No value from either
                final["important_fields"][field] = {
                    "value": "Not Found",
                    "confidence": 0,
                    "source": "none"
                }

        # Merge bounding boxes preferring Textract boxes when available
        final_boxes = {}
        tex_boxes = textract.get("field_bounding_boxes", {}) or {}
        tess_boxes = tesseract.get("field_bounding_boxes", {}) or {}
        for field in all_fields:
            if field in tex_boxes and tex_boxes.get(field):
                final_boxes[field] = tex_boxes.get(field)
            elif field in tess_boxes and tess_boxes.get(field):
                final_boxes[field] = tess_boxes.get(field)
            else:
                final_boxes[field] = None

        final["field_bounding_boxes"] = final_boxes

        logger.info(f"\n📊 Merge complete: Used {', '.join(final['metadata']['sources_used'])}")
        return final


# Global instance for easy import
_orchestrator = None

def get_orchestrator():
    """Get singleton orchestrator instance"""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = OCROrchestrator()
    return _orchestrator

def analyze_with_both_ocr(file_bytes: bytes) -> Dict:
    """
    Convenience function - analyze with both OCR engines
    """
    orchestrator = get_orchestrator()
    return orchestrator.analyze_document(file_bytes)