import json, sys
from ocr_orchestrator.orchestrator import analyze_with_both_ocr

IMAGE_PATH = r"c:\Users\linge\OneDrive\Desktop\BillAnalysisProject\test.jpeg"

try:
    with open(IMAGE_PATH, "rb") as f:
        data = f.read()
except Exception as e:
    print(f"ERROR_OPEN:{e}")
    sys.exit(1)

try:
    result = analyze_with_both_ocr(data)
    with open('backend/smoke_result.json','w',encoding='utf-8') as out:
        json.dump(result, out, ensure_ascii=False, indent=2)
    print("SMOKE_DONE")
except Exception as e:
    print(f"ERROR_RUN:{e}")
    raise
