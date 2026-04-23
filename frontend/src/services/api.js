/*
============================================================
Axios API Service Layer
ENTERPRISE SAAS VERSION (STABLE)
============================================================
*/

import axios from "axios";

/* =========================================================
   BASE URL
========================================================= */

const BASE_URL = (
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

/* =========================================================
   AXIOS INSTANCE
========================================================= */

const API = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, // 60s safe timeout
  withCredentials: false, // Set to true if you need cookies/auth
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Expires': '0',
  },
});

/* =========================================================
   REQUEST INTERCEPTOR
========================================================= */

API.interceptors.request.use(
  (config) => {
    // Ensure headers object exists
    config.headers = config.headers || {};

    // Add timestamp to prevent caching for GET requests
    if (config.method?.toLowerCase() === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now(), // Timestamp to prevent caching
      };
    }

    // Set JSON header ONLY if not FormData
    if (!(config.data instanceof FormData)) {
      config.headers["Content-Type"] = 
        config.headers["Content-Type"] || "application/json";
    }

    // Add Accept header for better response handling
    config.headers["Accept"] = "application/json";

    // Add auth token if available (for future use)
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }

    // DEV LOGGING
    if (import.meta.env.DEV) {
      console.log(
        "🚀 API Request:",
        config.method?.toUpperCase(),
        `${config.baseURL}${config.url}`,
        config.data instanceof FormData ? "(FormData)" : "",
        config.params ? `Params: ${JSON.stringify(config.params)}` : ""
      );
    }

    return config;
  },
  (error) => {
    console.error("🚨 Request Interceptor Error:", error);
    return Promise.reject(error);
  }
);

/* =========================================================
   RESPONSE INTERCEPTOR
========================================================= */

API.interceptors.response.use(
  (response) => {
    // DEV LOGGING
    if (import.meta.env.DEV) {
      console.log(
        "✅ API Response:",
        response.status,
        `${response.config.baseURL}${response.config.url}`,
        response.data?.status ? `(${response.data.status})` : "",
        `Size: ${JSON.stringify(response.data).length} bytes`
      );
    }
    return response;
  },
  (error) => {
    let friendlyMessage = "Server Error. Please try again.";
    let statusCode = null;
    let retryCount = 0;

    // Check if we should retry the request
    const config = error.config;
    if (config) {
      retryCount = config.retryCount || 0;
    }

    if (error.response) {
      // The request was made and the server responded with a status code
      statusCode = error.response.status;
      
      // Extract error message from various possible formats
      friendlyMessage = 
        error.response.data?.detail ||
        error.response.data?.message ||
        error.response.data?.error ||
        error.response.data?.msg ||
        error.response.statusText ||
        `Server Error (${statusCode})`;

      // Handle specific status codes with detailed messages
      if (statusCode === 400) {
        friendlyMessage = "Bad request. Please check your input data.";
        if (error.response.data?.detail) {
          friendlyMessage = error.response.data.detail;
        }
      } else if (statusCode === 401) {
        friendlyMessage = "Unauthorized. Please log in again.";
        // Clear invalid token
        localStorage.removeItem('auth_token');
      } else if (statusCode === 403) {
        friendlyMessage = "You don't have permission to access this resource.";
      } else if (statusCode === 404) {
        friendlyMessage = "Resource not found. Please check the URL.";
      } else if (statusCode === 409) {
        friendlyMessage = "Conflict with existing data.";
      } else if (statusCode === 422) {
        friendlyMessage = "Validation error. Please check your data.";
        if (error.response.data?.detail) {
          // Format validation errors nicely
          const details = error.response.data.detail;
          if (Array.isArray(details)) {
            friendlyMessage = details.map(d => d.msg || d.message).join(', ');
          } else {
            friendlyMessage = details;
          }
        }
      } else if (statusCode === 429) {
        friendlyMessage = "Too many requests. Please wait a moment and try again.";
      } else if (statusCode === 500) {
        friendlyMessage = "Internal server error. Please try again later.";
      } else if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
        friendlyMessage = "Server is temporarily unavailable. Please try again later.";
      }

      if (import.meta.env.DEV) {
        console.error("❌ API Error Response:", {
          status: statusCode,
          statusText: error.response.statusText,
          data: error.response.data,
          message: friendlyMessage,
          url: error.config?.url,
          method: error.config?.method,
        });
      }

    } else if (error.code === "ECONNABORTED") {
      // Timeout error
      friendlyMessage = "Request timeout. Please check your connection and try again.";
      if (import.meta.env.DEV) {
        console.error("⏱ Request Timeout:", error.message, `URL: ${error.config?.url}`);
      }

    } else if (error.code === "ERR_NETWORK") {
      // Network error
      friendlyMessage = "Network error. Please check your internet connection and make sure the backend server is running.";
      if (import.meta.env.DEV) {
        console.error("🌐 Network Error:", error.message, `URL: ${error.config?.url}`);
      }

    } else if (error.request) {
      // The request was made but no response was received
      friendlyMessage = "No response from server. Please check if the backend is running.";
      if (import.meta.env.DEV) {
        console.error("📡 No Response Received:", {
          url: error.config?.url,
          method: error.config?.method,
          data: error.config?.data,
        });
      }

    } else {
      // Something happened in setting up the request
      friendlyMessage = error.message || "Request setup failed.";
      if (import.meta.env.DEV) {
        console.error("🔥 Request Setup Error:", error.message, error);
      }
    }

    // Create a standardized error object
    const enhancedError = new Error(friendlyMessage);
    enhancedError.originalError = error;
    enhancedError.friendlyMessage = friendlyMessage;
    enhancedError.status = statusCode;
    enhancedError.timestamp = new Date().toISOString();
    enhancedError.url = error.config?.url;
    enhancedError.method = error.config?.method?.toUpperCase();
    enhancedError.retryCount = retryCount;

    // Add method to check error type
    enhancedError.isNotFound = () => statusCode === 404;
    enhancedError.isUnauthorized = () => statusCode === 401;
    enhancedError.isForbidden = () => statusCode === 403;
    enhancedError.isValidationError = () => statusCode === 422;
    enhancedError.isServerError = () => statusCode >= 500;
    enhancedError.isNetworkError = () => error.code === "ERR_NETWORK" || (!statusCode && error.request);
    enhancedError.isTimeout = () => error.code === "ECONNABORTED";
    enhancedError.isRateLimited = () => statusCode === 429;
    enhancedError.isConflict = () => statusCode === 409;

    // Add method to check if error is retryable
    enhancedError.isRetryable = () => {
      return enhancedError.isNetworkError() || 
             enhancedError.isTimeout() || 
             statusCode === 429 || 
             (statusCode >= 500 && statusCode < 600);
    };

    // Add retry method
    enhancedError.retry = async () => {
      if (!enhancedError.isRetryable()) {
        throw new Error("This error is not retryable");
      }
      
      const config = error.config;
      if (!config) {
        throw new Error("No original request config available");
      }

      config.retryCount = (config.retryCount || 0) + 1;
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, config.retryCount), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return API(config);
    };

    return Promise.reject(enhancedError);
  }
);

/* =========================================================
   HELPER METHODS FOR COMMON API CALLS
========================================================= */

// GET with query params and cache prevention
API.getWithParams = (url, params = {}, options = {}) => {
  return API.get(url, { 
    params: {
      ...params,
      _t: Date.now(), // Prevent caching
    },
    ...options 
  });
};

// POST with FormData and progress tracking
API.postFormData = (url, formData, onProgress = null) => {
  return API.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress ? (progressEvent) => {
      const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      onProgress(percentCompleted);
    } : undefined,
  });
};

// POST with JSON
API.postJSON = (url, data = {}, options = {}) => {
  return API.post(url, data, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
};

// PUT with JSON
API.putJSON = (url, data = {}, options = {}) => {
  return API.put(url, data, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
};

// PATCH with JSON
API.patchJSON = (url, data = {}, options = {}) => {
  return API.patch(url, data, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
};

// DELETE
API.deleteRequest = (url, options = {}) => {
  return API.delete(url, options);
};

// Batch requests
API.batch = async (requests) => {
  return Promise.all(requests.map(req => {
    const { method, url, data, params } = req;
    return API({
      method,
      url,
      data,
      params,
    });
  }));
};

/* =========================================================
   HEALTH CHECK WITH DETAILED STATUS
========================================================= */

API.healthCheck = async (detailed = false) => {
  try {
    const startTime = Date.now();
    const response = await API.get("/health", { timeout: 5000 });
    const responseTime = Date.now() - startTime;
    
    const result = { 
      isAlive: true, 
      status: response.status,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    };

    if (detailed && response.data) {
      result.details = response.data;
    }

    return result;
  } catch (error) {
    return { 
      isAlive: false, 
      error: error.friendlyMessage || error.message,
      timestamp: new Date().toISOString(),
      responseTime: null,
    };
  }
};

/* =========================================================
   RETRY MECHANISM FOR FAILED REQUESTS
========================================================= */

API.withRetry = async (requestFn, maxRetries = 3, initialDelay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !error.isRetryable?.()) {
        break;
      }
      
      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.log(`Retry attempt ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

/* =========================================================
   CACHE CONTROL
========================================================= */

// Clear all pending requests (useful for logout)
API.clearPendingRequests = () => {
  // You can implement this if needed
  console.log("Clearing pending requests...");
};

/* =========================================================
   EXPORT
========================================================= */

export default API;