import json
import sys
from ocr_orchestrator.orchestrator import analyze_with_both_ocr

IMAGE_PATH = r"c:\Users\linge\OneDrive\Desktop\BillAnalysisProject\test.jpeg"

try:
    with open(IMAGE_PATH, "rb") as f:
        data = f.read()
except Exception as e:
    print(json.dumps({"error": f"Failed to open image: {e}"}))
    sys.exit(1)

try:
    result = analyze_with_both_ocr(data)
    print(json.dumps(result, indent=2, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": f"Orchestrator run failed: {e}"}))
    raise
