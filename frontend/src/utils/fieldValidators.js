// India-specific field validators and formatters

// GST Validation & Cleaning
export const cleanGST = (text) => {
  if (!text) return '';
  
  // Remove W.E.F. and date suffixes
  let cleaned = text.replace(/W\.?\s*E\.?\s*F\.?\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/WEF\s*[\d\.\/\-]+/gi, '');
  cleaned = cleaned.replace(/effective\s*from\s*[\d\.\/\-]+/gi, '');
  
  // Extract 15-character GST pattern
  const gstMatch = cleaned.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}/);
  if (gstMatch) {
    return gstMatch[0];
  }
  
  // Fallback: any 15-character alphanumeric
  const anyMatch = cleaned.match(/[A-Z0-9]{15}/);
  return anyMatch ? anyMatch[0] : cleaned.trim().substring(0, 15);
};

// Phone Number Extraction - Prioritizes Tel No over Helpline
export const extractVendorPhone = (textBlocks) => {
  let telNumber = '';
  let helplineNumber = '';
  
  for (const block of textBlocks) {
    const text = block.Text || '';
    
    // Check for Telephone/Tel No
    if (/[Tt]el(?:ephone)?\.?\s*[Nn]o\.?:?\s*\d+/i.test(text)) {
      const numbers = text.match(/[0-9\-\(\)\s+]{8,15}/g);
      if (numbers) {
        telNumber = numbers[0].trim();
      }
    }
    
    // Check for Helpline/Toll Free - we DON'T want this
    if (/[Hh]elp(?:line)?|[Tt]oll\s*[Ff]ree|[Cc]ustomer\s*[Cc]are/i.test(text)) {
      const numbers = text.match(/[0-9\-\(\)\s+]{8,15}/g);
      if (numbers) {
        helplineNumber = numbers[0].trim();
      }
    }
  }
  
  // Return Tel No, not Helpline
  return telNumber || '';
};

// Address Formatter - Adds proper line breaks
export const formatAddress = (address) => {
  if (!address) return '';
  
  let formatted = address;
  
  // Add line breaks after common patterns
  formatted = formatted.replace(/(PLOT\s*NO\.?\s*\d+)/gi, '$1\n');
  formatted = formatted.replace(/([A-Z]{2,}\s+\d{6})/, '\n$1'); // PIN code
  formatted = formatted.replace(/(\d{6})/, '\n$1'); // PIN code alone
  formatted = formatted.replace(/(GHATKOPAR|INDIRAPURAM|GHAZIABAD|MUMBAI|DELHI|BANGALORE)/gi, '\n$1');
  
  return formatted;
};

// Confidence Score Color Mapping
export const getConfidenceColor = (score) => {
  if (score >= 90) return '#4caf50'; // Green - High
  if (score >= 70) return '#ff9800'; // Orange - Medium
  return '#f44336'; // Red - Low
};