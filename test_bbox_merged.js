const utils = require('./frontend/src/utils/boundingBoxUtils').default;

const mockResponse = {
  field_bounding_boxes: {
    "Vendor Phone Number": [
        { text: "0120-4287617", Left: 0.1, Top: 0.1, Width: 0.1, Height: 0.02 },
        { text: "1800 200 2255", Left: 0.1, Top: 0.2, Width: 0.1, Height: 0.02 }
    ],
    "Vendor GST Number": { text: "GST NO: 09AADCB1093N1ZE", Left: 0.1, Top: 0.3, Width: 0.2, Height: 0.05 }
  },
  ExpenseDocuments: [
    {
      SummaryFields: [
        {
          Type: { Text: "GST_NUMBER" },
          ValueDetection: {
            Text: "GST NO: 09AADCB1093N1ZE",
            Confidence: 99,
            Geometry: { BoundingBox: { Left: 0.1, Top: 0.3, Width: 0.2, Height: 0.05 } }
          }
        }
      ]
    }
  ],
  Blocks: []
};

console.log("Testing Phone Filtering from Backend Boxes...");
const result = utils.getAllFieldBoundingBoxes(mockResponse);
const phones = result["Vendor Phone Number"];
console.log("Phones found:", phones ? phones.length : 0);
if (phones && phones.length === 1 && phones[0].text === "0120-4287617") {
    console.log("PASSED: Helpline filtered from backend boxes.");
} else {
    console.log("FAILED: Phone filtering failed.");
}

console.log("\nTesting GST Validation/Fallback from Backend Boxes...");
const gst = result["Vendor GST Number"];
console.log("GST text:", gst ? gst.text : "Not found");
// Should have fallen back to getFieldBoundingBox which cleans it
if (gst && gst.text === "09AADCB1093N1ZE") {
    console.log("PASSED: GST cleaned/found via fallback.");
} else {
    console.log("FAILED: GST validation/fallback failed.");
}
