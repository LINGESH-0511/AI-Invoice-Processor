# handwritten_ocr/tesseract_malayalam.py
"""
Tesseract OCR for Malayalam Handwritten Invoices
This runs COMPLETELY SEPARATE from Textract
"""

import pytesseract
import logging
import re
from PIL import Image
import io
from typing import Dict, List, Any, Optional

# Configure logging
logger = logging.getLogger(__name__)

class TesseractMalayalamOCR:
    """
    Tesseract OCR engine optimized for Malayalam handwritten text
    Runs independently of AWS Textract
    """
    
    def __init__(self):
        # Configure Tesseract path (Windows)
        self.tesseract_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
        pytesseract.pytesseract.tesseract_cmd = self.tesseract_path
        
        # Check if available
        self.is_available = self._check_availability()
        
        if self.is_available:
            logger.info("✅ Tesseract Malayalam OCR initialized")
            self._check_languages()
        else:
            logger.error("❌ Tesseract not found at: {}".format(self.tesseract_path))
    
    def _check_availability(self) -> bool:
        """Check if Tesseract is installed"""
        try:
            version = pytesseract.get_tesseract_version()
            logger.info(f"   Tesseract version: {version}")
            return True
        except Exception as e:
            logger.error(f"   Tesseract not available: {e}")
            return False
    
    def _check_languages(self):
        """Check if Malayalam language pack is installed"""
        try:
            languages = pytesseract.get_languages()
            logger.info(f"   Available languages: {languages}")
            
            if 'mal' in languages:
                logger.info("   ✅ Malayalam language pack found")
            else:
                logger.warning("   ⚠️ Malayalam language pack not found")
                logger.warning("   Run: sudo apt-get install tesseract-ocr-mal")
        except Exception as e:
            logger.error(f"   Error checking languages: {e}")
    
    def preprocess_image(self, image_bytes: bytes) -> Image.Image:
        """
        Preprocess image for better handwritten text recognition
        """
        try:
            # Open image
            image = Image.open(io.BytesIO(image_bytes))
            
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Increase contrast for handwritten text
            from PIL import ImageEnhance
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(1.5)
            
            # Increase sharpness
            enhancer = ImageEnhance.Sharpness(image)
            image = enhancer.enhance(2.0)
            
            return image
            
        except Exception as e:
            logger.error(f"Image preprocessing failed: {e}")
            return Image.open(io.BytesIO(image_bytes))
    
    def analyze_document(self, file_bytes: bytes) -> Dict[str, Any]:
        """
        Extract text from handwritten Malayalam invoices
        
        Args:
            file_bytes: Raw image bytes
        
        Returns:
            Dictionary with extracted fields (compatible format with processor.py)
        """
        if not self.is_available:
            return {
                "success": False,
                "error": "Tesseract not available",
                "important_fields": {}
            }
        
        try:
            logger.info("✍️ Processing handwritten invoice with Tesseract...")
            
            # Step 1: Preprocess image
            image = self.preprocess_image(file_bytes)
            
            # Step 2: Run OCR with Malayalam + English
            # Using multiple PSM modes for better handwriting recognition
            ocr_data = pytesseract.image_to_data(
                image,
                lang='mal+eng',  # Malayalam + English
                output_type=pytesseract.Output.DICT,
                config='--oem 3 --psm 6'  # OEM: Default, PSM: Uniform block
            )
            
            # Step 3: Get full text
            full_text = pytesseract.image_to_string(
                image,
                lang='mal+eng',
                config='--oem 3 --psm 6'
            )
            
            # Step 4: Extract fields using patterns
            extracted = self._extract_fields(full_text, ocr_data)

            # Step 5: Compute bounding boxes for extracted fields using ocr_data
            try:
                boxes = self._compute_field_bounding_boxes(extracted, ocr_data)
            except Exception as e:
                logger.warning(f"Failed to compute bounding boxes from Tesseract output: {e}")
                boxes = {}
            
            logger.info(f"✅ Tesseract extraction complete")
            logger.info(f"   Found: Vendor='{extracted['vendor_name']}', Total='{extracted['total_amount']}'")
            
            return {
                "success": True,
                "source": "tesseract_malayalam",
                "important_fields": extracted,
                "raw_text": full_text[:500] + "..." if len(full_text) > 500 else full_text,
                "field_bounding_boxes": boxes
            }
            
        except Exception as e:
            logger.error(f"❌ Tesseract analysis failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "important_fields": {}
            }
    
    def _extract_fields(self, text: str, ocr_data: Dict) -> Dict[str, Any]:
        """
        Extract important fields from OCR text
        Using patterns similar to processor.py but adapted for handwritten text
        """
        fields = {
            "Vendor Name": {"value": "Not Found", "confidence": 0},
            "Total Amount": {"value": "Not Found", "confidence": 0},
            "Invoice Date": {"value": "Not Found", "confidence": 0},
            "Vendor GST Number": {"value": "Not Found", "confidence": 0},
            "Bill Number": {"value": "Not Found", "confidence": 0},
        }
        
        text_lower = text.lower()
        
        # =========================================
        # Extract Total Amount
        # =========================================
        # Look for amount patterns
        amount_patterns = [
            r'(?:total|amount|grand total|net)[:\s]*([0-9,]+\.?[0-9]*)',
            r'([0-9,]+\.?[0-9]*)\s*(?:only|rupees|rs)',
            r'(?:rs\.?|inr|₹)\s*([0-9,]+\.?[0-9]*)'
        ]
        
        for pattern in amount_patterns:
            match = re.search(pattern, text_lower, re.IGNORECASE)
            if match:
                amount = match.group(1).replace(',', '')
                fields["Total Amount"] = {
                    "value": amount,
                    "confidence": 75.0  # Lower confidence for handwritten
                }
                break
        
        # =========================================
        # Extract Date
        # =========================================
        date_patterns = [
            r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
            r'(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})'
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                fields["Invoice Date"] = {
                    "value": match.group(1),
                    "confidence": 80.0
                }
                break
        
        # =========================================
        # Extract GST (if present)
        # =========================================
        gst_pattern = r'\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d[Z][0-9A-Z]'
        match = re.search(gst_pattern, text.upper())
        if match:
            fields["Vendor GST Number"] = {
                "value": match.group(0),
                "confidence": 85.0
            }
        
        # =========================================
        # Extract Vendor Name (first non-empty line)
        # =========================================
        lines = [line for line in text.split('\n') if line.strip()]
        if lines:
            # First line is often vendor name
            fields["Vendor Name"] = {
                "value": lines[0].strip(),
                "confidence": 70.0
            }
        
        # =========================================
        # Extract Bill Number
        # =========================================
        bill_patterns = [
            r'(?:bill no|invoice no|bill#|invoice#)[:\s]*([A-Z0-9\-]+)',
            r'([A-Z0-9]{10,20})'  # Alphanumeric code of length 10-20
        ]
        
        for pattern in bill_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                fields["Bill Number"] = {
                    "value": match.group(1) if len(match.groups()) > 0 else match.group(0),
                    "confidence": 70.0
                }
                break
        
        return fields

    def _compute_field_bounding_boxes(self, extracted_fields: Dict[str, Any], ocr_data: Dict) -> Dict[str, Dict]:
        """
        Compute bounding boxes for each extracted field using pytesseract image_to_data output.

        Returns mapping display field -> {Left, Top, Width, Height, confidence, text}
        """
        boxes = {}

        # Group words by line index
        n_boxes = len(ocr_data.get('text', []))
        lines = {}
        for i in range(n_boxes):
            line_num = ocr_data.get('line_num', [None]*n_boxes)[i]
            if line_num is None:
                continue
            lines.setdefault(line_num, []).append(i)

        # Helper to build bbox from indices
        def bbox_from_indices(indices):
            lefts = [ocr_data['left'][i] for i in indices]
            tops = [ocr_data['top'][i] for i in indices]
            rights = [ocr_data['left'][i] + ocr_data['width'][i] for i in indices]
            bottoms = [ocr_data['top'][i] + ocr_data['height'][i] for i in indices]
            left = min(lefts)
            top = min(tops)
            right = max(rights)
            bottom = max(bottoms)
            width = right - left
            height = bottom - top
            confs = [float(ocr_data['conf'][i]) if str(ocr_data['conf'][i]).strip() not in ['-1',''] else 0 for i in indices]
            avg_conf = sum(confs)/len(confs) if confs else 0
            # Tesseract gives pixel coordinates; convert to normalized by image size not available here
            return {
                'Left': left,
                'Top': top,
                'Width': width,
                'Height': height,
                'confidence': avg_conf,
                'text': ' '.join([ocr_data['text'][i] for i in indices]).strip()
            }

        # For each extracted field, try to find a matching line
        for display, info in extracted_fields.items():
            value = info.get('value') if isinstance(info, dict) else info
            if not value or value == 'Not Found':
                # attempt keyword search in lines
                found = False
                for ln, idxs in lines.items():
                    line_text = ' '.join([ocr_data['text'][i] for i in idxs]).strip()
                    if not line_text:
                        continue
                    if display.split()[0].upper() in line_text.upper() or any(k.upper() in line_text.upper() for k in [display, 'BILL', 'INVOICE', 'TOTAL', 'GST', 'PHONE', 'DATE']):
                        boxes[display] = bbox_from_indices(idxs)
                        found = True
                        break
                if not found:
                    boxes[display] = None
                continue

            # Try to locate the exact value within lines
            matched = False
            for ln, idxs in lines.items():
                line_text = ' '.join([ocr_data['text'][i] for i in idxs]).strip()
                if not line_text:
                    continue
                if str(value).strip().lower() in line_text.lower():
                    boxes[display] = bbox_from_indices(idxs)
                    matched = True
                    break

            if not matched:
                # try matching by words
                for i in range(n_boxes):
                    word = (ocr_data['text'][i] or '').strip()
                    if not word:
                        continue
                    if str(value).strip().lower() == word.lower() or str(value).strip().lower() in word.lower():
                        # find all words in same line
                        ln = ocr_data.get('line_num', [None]*n_boxes)[i]
                        if ln and ln in lines:
                            boxes[display] = bbox_from_indices(lines[ln])
                        else:
                            boxes[display] = bbox_from_indices([i])
                        matched = True
                        break

            if not matched:
                boxes[display] = None

        return boxes