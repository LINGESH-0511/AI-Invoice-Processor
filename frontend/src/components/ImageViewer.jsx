// src/components/ImageViewer.jsx - SIMPLIFIED VERSION (No controls)
import React, { useState, useRef, useEffect } from 'react';
import './ImageViewer.css';

const InvoiceViewer = ({ imageUrl, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  
  const containerRef = useRef(null);

  // Prevent default browser zoom on Ctrl+wheel
  useEffect(() => {
    const preventDefaultZoom = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    
    window.addEventListener('wheel', preventDefaultZoom, { passive: false });
    
    return () => {
      window.removeEventListener('wheel', preventDefaultZoom);
    };
  }, []);

  // Handle click outside to close
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="invoice-viewer-overlay" 
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
        cursor: 'pointer',
      }}
    >
      <div 
        ref={containerRef}
        style={{
          position: 'relative',
          maxWidth: '95vw',
          maxHeight: '95vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {isLoading && (
          <div style={{
            position: 'absolute',
            color: '#4f46e5',
            fontSize: '24px',
            animation: 'spin 1s linear infinite',
          }}>
            ⟳
          </div>
        )}
        
        {error ? (
          <div style={{
            color: '#ef4444',
            fontSize: '16px',
            textAlign: 'center',
            padding: '20px',
          }}>
            ⚠ Failed to load image
          </div>
        ) : (
          <img
            src={imageUrl}
            alt="Invoice Preview"
            style={{
              maxWidth: '100%',
              maxHeight: '95vh',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              display: isLoading ? 'none' : 'block',
            }}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setError(true);
              setIsLoading(false);
            }}
          />
        )}
        
        {/* Close button in corner (optional - keep for usability) */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.5)',
            border: 'none',
            color: 'white',
            fontSize: '20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(79, 70, 229, 0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'}
        >
          ✕
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default InvoiceViewer;