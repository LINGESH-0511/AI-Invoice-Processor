/**
 * Date Utilities for Invoice System
 * Handles multiple date formats for searching and display
 */

/**
 * Normalize date for consistent searching
 * Converts various formats to DD/MM/YYYY format
 */
export const normalizeDate = (dateStr) => {
  if (!dateStr || dateStr === "Not Found" || dateStr === "—") return "";
  
  const cleaned = String(dateStr).trim();
  
  // Handle DD/MM/YY or D/M/YY format (e.g., 01/07/17 or 1/7/17)
  const ddmmyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const ddmmyyMatch = cleaned.match(ddmmyyPattern);
  
  if (ddmmyyMatch) {
    const day = ddmmyyMatch[1].padStart(2, '0');
    const month = ddmmyyMatch[2].padStart(2, '0');
    let year = ddmmyyMatch[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${day}/${month}/${year}`;
  }
  
  // Handle DD-MM-YY or D-M-YY format (e.g., 01-07-17 or 1-7-17)
  const ddmmyyDashPattern = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;
  const ddmmyyDashMatch = cleaned.match(ddmmyyDashPattern);
  
  if (ddmmyyDashMatch) {
    const day = ddmmyyDashMatch[1].padStart(2, '0');
    const month = ddmmyyDashMatch[2].padStart(2, '0');
    let year = ddmmyyDashMatch[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${day}/${month}/${year}`;
  }
  
  // Handle YYYY-MM-DD format (ISO)
  const yyyymmddPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const yyyymmddMatch = cleaned.match(yyyymmddPattern);
  
  if (yyyymmddMatch) {
    const [_, year, month, day] = yyyymmddMatch;
    return `${day}/${month}/${year}`;
  }
  
  // Handle DD/MM/YYYY already
  const ddmmyyyyPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (ddmmyyyyPattern.test(cleaned)) {
    return cleaned;
  }
  
  return cleaned;
};

/**
 * Check if a date matches a search query
 * Handles partial matches (e.g., "01/07" matches "01/07/17")
 */
export const dateMatchesSearch = (dateStr, searchQuery) => {
  if (!dateStr || !searchQuery) return false;
  
  const normalizedDate = normalizeDate(dateStr);
  const normalizedQuery = searchQuery.trim();
  
  // Direct match
  if (normalizedDate.includes(normalizedQuery)) return true;
  
  // Try matching without year (e.g., "01/07" matches "01/07/17")
  const dateParts = normalizedDate.split('/');
  if (dateParts.length === 3) {
    const dayMonth = `${dateParts[0]}/${dateParts[1]}`;
    if (dayMonth === normalizedQuery) return true;
    
    // Try matching just day or month
    if (dateParts[0] === normalizedQuery) return true;
    if (dateParts[1] === normalizedQuery) return true;
    
    // Try matching day/month without leading zeros (e.g., "1/7")
    const dayNoZero = parseInt(dateParts[0], 10).toString();
    const monthNoZero = parseInt(dateParts[1], 10).toString();
    if (`${dayNoZero}/${monthNoZero}` === normalizedQuery) return true;
    if (`${dayNoZero}/${dateParts[1]}` === normalizedQuery) return true;
    if (`${dateParts[0]}/${monthNoZero}` === normalizedQuery) return true;
  }
  
  // Try matching year only
  if (dateParts.length === 3 && dateParts[2].includes(normalizedQuery)) return true;
  
  return false;
};

/**
 * Format date for display in DD/MM/YY format
 */
export const formatDisplayDate = (dateStr) => {
  if (!dateStr || dateStr === "Not Found" || dateStr === "—") return "—";
  
  const normalized = normalizeDate(dateStr);
  if (normalized === dateStr && !normalized.includes('/')) return dateStr;
  
  // Return in DD/MM/YY format for display
  const parts = normalized.split('/');
  if (parts.length === 3) {
    const shortYear = parts[2].slice(-2);
    return `${parts[0]}/${parts[1]}/${shortYear}`;
  }
  
  return normalized;
};

/**
 * Parse date string to Date object
 */
export const parseDate = (dateStr) => {
  const normalized = normalizeDate(dateStr);
  const parts = normalized.split('/');
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  }
  return null;
};

/**
 * Compare two dates for sorting
 */
export const compareDates = (dateA, dateB) => {
  const dateAObj = parseDate(dateA);
  const dateBObj = parseDate(dateB);
  
  if (!dateAObj && !dateBObj) return 0;
  if (!dateAObj) return 1;
  if (!dateBObj) return -1;
  
  return dateAObj - dateBObj;
};

/**
 * Get date range for filtering
 */
export const getDateRange = (startDate, endDate) => {
  return {
    start: startDate ? normalizeDate(startDate) : null,
    end: endDate ? normalizeDate(endDate) : null
  };
};

/**
 * Check if date is within range
 */
export const isDateInRange = (dateStr, startDate, endDate) => {
  if (!startDate && !endDate) return true;
  
  const date = parseDate(dateStr);
  if (!date) return false;
  
  if (startDate) {
    const start = parseDate(startDate);
    if (start && date < start) return false;
  }
  
  if (endDate) {
    const end = parseDate(endDate);
    if (end && date > end) return false;
  }
  
  return true;
};