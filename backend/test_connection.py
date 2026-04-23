# textract_service.py

import boto3
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


# -------- CREATE TEXTRACT CLIENT --------
def get_textract_client():
    """
    Create and return AWS Textract client safely.
    """

    try:
        client = boto3.client(
            "textract",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION")
        )
        return client

    except Exception as e:
        raise Exception(f"Failed to create AWS Textract client: {str(e)}")


# -------- ANALYZE EXPENSE DOCUMENT --------
def analyze_expense_document(file_bytes):
    """
    Analyze invoice or bill using AWS Textract AnalyzeExpense API.
    """

    try:
        client = get_textract_client()

        response = client.analyze_expense(
            Document={
                "Bytes": file_bytes
            }
        )

        return response

    except Exception as e:
        raise Exception(f"Textract analysis failed: {str(e)}")
