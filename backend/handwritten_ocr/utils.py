# handwritten_ocr/utils.py
"""
Utility functions for handwritten OCR
"""

import logging
import re
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class HandwritingUtils:
    """Helper functions for handwritten text processing"""
    
    @staticmethod
    def detect_malayalam(text: str) -> bool:
        """
        Detect if text contains Malayalam characters
        Malayalam Unicode range: 0D00-0D7F
        """
        for char in text:
            if '\u0D00' <= char <= '\u0D7F':
                return True
        return False
    
    @staticmethod
    def clean_handwritten_text(text: str) -> str:
        """
        Clean common handwriting OCR artifacts
        """
        # Remove extra spaces
        text = re.sub(r'\s+', ' ', text)
        
        # Fix common OCR mistakes
        replacements = {
            '0': 'O',  # Zero vs O (context-dependent)
            '1': 'I',  # One vs I
            '5': 'S',  # Five vs S
        }
        
        # Note: This is simplified - real implementation would be more sophisticated
        return text.strip()
    
    @staticmethod
    def calculate_confidence(ocr_data: Dict) -> float:
        """
        Calculate average confidence from Tesseract output
        """
        confidences = [conf for conf in ocr_data.get('conf', []) if conf > 0]
        if not confidences:
            return 0.0
        return sum(confidences) / len(confidences)