import streamlit as st
import pandas as pd
import io

from textract_service import analyze_expense_document
from processor import extract_expense_data  # Using simplified processor
from database import create_table, insert_invoice

# =========================================================
# PAGE CONFIG
# =========================================================

st.set_page_config(
    page_title="AI Bill Analysis System",
    layout="wide"
)

# =========================================================
# DB INIT
# =========================================================

if "db_initialized" not in st.session_state:
    create_table()
    st.session_state.db_initialized = True

if "saved_once" not in st.session_state:
    st.session_state.saved_once = False

# =========================================================
# TITLE
# =========================================================

st.title("📊 AI Bill Analysis System")
st.markdown(
    "Upload a bill or invoice to extract **important financial details** using AWS Textract."
)

# =========================================================
# FIELD ORDER
# =========================================================

FIELD_ORDER = [
    "Vendor Name",
    "GST Number",
    "Address",
    "Date",
    "Total",
    "Phone Number",
    "Bill Number"
]

# =========================================================
# CONFIDENCE CHECK (SIMPLIFIED)
# =========================================================

def calculate_average_confidence(display_data):
    """
    Simple average of Textract's native confidence scores
    No modifications, no thresholds
    """
    confidences = []

    for field in display_data.values():
        conf = field.get("confidence", 0)
        if conf > 0:
            confidences.append(conf)

    if not confidences:
        return 0

    return round(sum(confidences) / len(confidences), 2)

# =========================================================
# FILE UPLOAD
# =========================================================

uploaded_file = st.file_uploader(
    "Upload Bill (Image or PDF)",
    type=["png", "jpg", "jpeg", "pdf"]
)

# =========================================================
# MAIN PROCESS (SIMPLIFIED) - REMOVED AUTO-SAVE
# =========================================================

if uploaded_file is not None:
    try:

        # Reset save flag for new file
        st.session_state.saved_once = False

        file_bytes = uploaded_file.read()
        
        # -------- TEXTRACT (DIRECT, NO PREPROCESSING) --------
        with st.spinner("Analyzing document using AWS Textract..."):
            # Send original bytes directly to Textract
            # No preprocessing, no enhancement - trust Textract 100%
            response = analyze_expense_document(file_bytes)
            
            # Use simplified processor that only trusts Textract's SummaryFields
            structured_data = extract_expense_data(response)

        st.subheader("🧾 Important Invoice Details")

        if structured_data.get("important_fields"):

            display_data = structured_data["important_fields"]
            
            # Count fields found
            fields_found = sum(1 for field in display_data.values() 
                              if field.get("value") != "Not Found")

            avg_confidence = calculate_average_confidence(display_data)

            # Display summary info
            col1, col2 = st.columns(2)
            with col1:
                st.info(f"📊 Fields Found: **{fields_found}/7**")
            with col2:
                st.info(f"🎯 Avg Confidence: **{avg_confidence}%**")

            # -------- REMOVED AUTO-SAVE DATABASE --------
            # The line below has been REMOVED - no more auto-save!
            # if not st.session_state.saved_once:
            #     insert_invoice(display_data)
            #     st.session_state.saved_once = True
            #     st.success("✅ Data saved to database")

            excel_rows = []

            for field_name in FIELD_ORDER:

                field_info = display_data.get(
                    field_name,
                    {"value": "Not Found", "confidence": 0}
                )

                value = field_info.get("value", "Not Found")
                confidence = field_info.get("confidence", 0)

                # Color code based on confidence
                if confidence >= 90:
                    color = "🟢"
                elif confidence >= 70:
                    color = "🟡"
                elif confidence >= 50:
                    color = "🟠"
                else:
                    color = "🔴"

                st.markdown(
                    f"**{field_name}**: {value}  \n"
                    f"{color} Confidence: **{confidence}%**"
                )
                st.divider()

                excel_rows.append({
                    "Field Name": field_name,
                    "Value": value,
                    "Confidence (%)": confidence
                })

            # -------- EXCEL DOWNLOAD --------
            df = pd.DataFrame(excel_rows)

            output = io.BytesIO()
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                df.to_excel(writer, index=False, sheet_name="Invoice Data")

            output.seek(0)

            st.download_button(
                label="📥 Download Excel Report",
                data=output,
                file_name="invoice_analysis.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            
            # Show processing info
            with st.expander("ℹ️ Processing Info"):
                st.write("**Mode:** Pure Textract (No preprocessing)")
                st.write("**Trust Level:** 100% - Using Textract's ML output directly")
                st.write("**Fields Source:** Textract AnalyzeExpense SummaryFields only")
                st.write("**No fallbacks, no regex, no custom validation**")
                st.write("**⚠️ Note:** Data is NOT automatically saved to database. Save via frontend Confirm button.")

        else:
            st.warning("No important fields detected by Textract.")
            st.info("Try uploading a clearer image or different invoice format.")

        st.success("Analysis completed successfully ✅")

    except Exception as e:
        st.error("Error occurred during processing:")
        st.error(str(e))
        st.info("Make sure AWS credentials are configured correctly in your environment.")

# =========================================================
# ADD A SECTION TO SHOW MANUAL SAVE INSTRUCTION
# =========================================================

st.sidebar.markdown("---")
st.sidebar.markdown("## 📋 Instructions")
st.sidebar.markdown("""
1. Upload an invoice image or PDF
2. Review extracted data
3. **Data is NOT auto-saved**
4. Go to Frontend Upload page
5. Click **Confirm & Save** to store in database
""")