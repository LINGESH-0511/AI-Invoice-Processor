// In your InvoicePreview component
import ImageViewer from './components/ImageViewer';

function InvoicePreview({ invoice }) {
  const handleDownload = () => {
    // Your download logic
    console.log('Downloading image...');
  };

  const handleReset = () => {
    // Your reset logic
    console.log('Resetting view...');
  };

  return (
    <div className="invoice-preview-section">
      <h3>Invoice Preview</h3>
      <div className="preview-container">
        <ImageViewer 
          src={invoice.invoice_image}
          filename={`Invoice_${invoice.bill_number || 'image'}.jpg`}
          onDownload={handleDownload}
          onReset={handleReset}
        />
      </div>
      <div className="action-buttons">
        <button className="btn-reset" onClick={handleReset}>Reset</button>
        <button className="btn-download" onClick={handleDownload}>Download</button>
      </div>
    </div>
  );
}