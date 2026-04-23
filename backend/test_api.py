# test_api.py
import requests

base_url = "http://127.0.0.1:8000"

# Test root
response = requests.get(base_url)
print(f"Root: {response.json()}")

# Test OCR health
response = requests.get(f"{base_url}/ocr-health")
print(f"OCR Health: {response.json()}")

# Test invoices
response = requests.get(f"{base_url}/invoices")
print(f"Invoices: {response.json()}")