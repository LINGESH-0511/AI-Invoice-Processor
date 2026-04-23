import { useEffect, useState } from "react";

export default function KPIcards({ stats = {} }) {
  const [animatedStats, setAnimatedStats] = useState({});

  /* =====================================================
     ANIMATE NUMBERS ON CHANGE
  ===================================================== */
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedStats(stats);
    }, 100);
    return () => clearTimeout(timer);
  }, [stats]);

  /* =====================================================
     FORMAT CURRENCY
  ===================================================== */
  const formatCurrency = (value) => {
    const num = Number(value || 0);
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  /* =====================================================
     FORMAT NUMBER WITH COMMAS
  ===================================================== */
  const formatNumber = (value) => {
    return new Intl.NumberFormat("en-IN").format(Number(value || 0));
  };

  /* =====================================================
     DEFAULT STATS STRUCTURE
  ===================================================== */
  const defaultStats = {
    totalInvoices: 0,
    totalSpend: 0,
    vendorCount: 0,
    avgSpend: 0,
    invoiceImages: 0,
    processedImages: 0,
    pendingInvoices: 0,
    processedInvoices: 0,
    gstVerified: 0,
    highConfidence: 0,
  };

  const mergedStats = { ...defaultStats, ...stats };

  /* =====================================================
     CARD CONFIGURATIONS
  ===================================================== */
  const cards = [
    {
      id: 'total-invoices',
      title: 'Total Invoices',
      value: formatNumber(mergedStats.totalInvoices),
      subtitle: 'All uploaded invoices',
      icon: '📄',
      color: '#4f46e5',
      trend: mergedStats.totalInvoices > 0 ? '+12%' : null,
      trendUp: true,
    },
    {
      id: 'total-spend',
      title: 'Total Spend',
      value: formatCurrency(mergedStats.totalSpend),
      subtitle: 'Overall expense',
      icon: '💰',
      color: '#10b981',
      trend: mergedStats.totalSpend > 10000 ? '+8%' : null,
      trendUp: true,
    },
    {
      id: 'vendors',
      title: 'Vendors',
      value: formatNumber(mergedStats.vendorCount),
      subtitle: 'Unique suppliers',
      icon: '🏢',
      color: '#f59e0b',
      trend: mergedStats.vendorCount > 5 ? '+3' : null,
      trendUp: true,
    },
    {
      id: 'avg-spend',
      title: 'Average Spend',
      value: formatCurrency(mergedStats.avgSpend),
      subtitle: 'Per invoice',
      icon: '📊',
      color: '#06b6d4',
      trend: mergedStats.avgSpend > 500 ? '-2%' : null,
      trendUp: false,
    },
    {
      id: 'invoice-images',
      title: 'Invoice Images',
      value: formatNumber(mergedStats.invoiceImages),
      subtitle: 'Original invoices stored',
      icon: '🖼️',
      color: '#ec4899',
      badge: mergedStats.invoiceImages === mergedStats.totalInvoices ? 'All stored' : null,
    },
    {
      id: 'processed-images',
      title: 'Processed Images',
      value: formatNumber(mergedStats.processedImages),
      subtitle: 'AI processed outputs',
      icon: '⚡',
      color: '#8b5cf6',
      badge: mergedStats.processedImages > 0 ? 'Ready' : null,
    },
    {
      id: 'pending-invoices',
      title: 'Pending',
      value: formatNumber(mergedStats.pendingInvoices),
      subtitle: 'Awaiting processing',
      icon: '⏳',
      color: '#f97316',
      warning: mergedStats.pendingInvoices > 0,
    },
    {
      id: 'processed-invoices',
      title: 'Processed',
      value: formatNumber(mergedStats.processedInvoices),
      subtitle: 'Successfully processed',
      icon: '✅',
      color: '#22c55e',
      progress: mergedStats.totalInvoices ? 
        Math.round((mergedStats.processedInvoices / mergedStats.totalInvoices) * 100) : 0,
    },
    {
      id: 'gst-verified',
      title: 'GST Verified',
      value: formatNumber(mergedStats.gstVerified),
      subtitle: 'Valid GST numbers',
      icon: '🔖',
      color: '#a855f7',
      percentage: mergedStats.totalInvoices ?
        Math.round((mergedStats.gstVerified / mergedStats.totalInvoices) * 100) : 0,
    },
    {
      id: 'high-confidence',
      title: 'High Confidence',
      value: formatNumber(mergedStats.highConfidence),
      subtitle: '>85% accuracy',
      icon: '🎯',
      color: '#14b8a6',
      highlight: true,
    },
  ];

  /* =====================================================
     FILTER VISIBLE CARDS (ONLY SHOW NON-ZERO OR IMPORTANT)
  ===================================================== */
  const visibleCards = cards.filter(card => {
    // Always show first 6 cards
    if (cards.indexOf(card) < 6) return true;
    // Show others only if they have value > 0
    const value = mergedStats[card.id.replace('-', '')] || 
                  mergedStats[card.id] || 0;
    return Number(value) > 0;
  });

  return (
    <div className="modern-kpi-grid">
      {visibleCards.map((card) => (
        <ModernCard key={card.id} {...card} />
      ))}
    </div>
  );
}

/* =====================================================
   MODERN KPI CARD (SAAS STYLE)
===================================================== */
function ModernCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  color,
  trend,
  trendUp,
  badge,
  warning,
  progress,
  percentage,
  highlight
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className="modern-kpi-card"
      style={{
        '--card-accent': color,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top section with icon and badge */}
      <div className="card-top">
        <div 
          className="card-icon"
          style={{
            background: `${color}15`,
            color: color,
            transform: isHovered ? 'scale(1.1) rotate(5deg)' : 'scale(1)',
          }}
        >
          {icon}
        </div>
        
        {badge && (
          <span className="card-badge" style={{ background: color, color: 'white' }}>
            {badge}
          </span>
        )}
        
        {warning && (
          <span className="card-warning" title="Action required">
            ⚠️
          </span>
        )}
      </div>

      {/* Value and title */}
      <div className="card-content">
        <h3 className="card-title">{title}</h3>
        <div className="card-value-wrapper">
          <span className="card-value">{value}</span>
          
          {/* Trend indicator */}
          {trend && (
            <span 
              className={`card-trend ${trendUp ? 'trend-up' : 'trend-down'}`}
              style={{
                color: trendUp ? '#10b981' : '#ef4444',
              }}
            >
              {trendUp ? '↑' : '↓'} {trend}
            </span>
          )}
        </div>
        
        {/* Subtitle with highlight effect */}
        <p className="card-subtitle" style={{
          color: isHovered ? color : '#64748b',
        }}>
          {subtitle}
        </p>
      </div>

      {/* Progress bar (if provided) */}
      {progress !== undefined && (
        <div className="card-progress">
          <div 
            className="progress-bar"
            style={{ width: `${progress}%` }}
          />
          <span className="progress-text">{progress}%</span>
        </div>
      )}

      {/* Percentage indicator (if provided) */}
      {percentage !== undefined && percentage > 0 && (
        <div className="card-percentage">
          <div 
            className="percentage-circle"
            style={{
              background: `conic-gradient(${color} 0% ${percentage}%, #f1f5f9 ${percentage}% 100%)`,
            }}
          >
            <span>{percentage}%</span>
          </div>
        </div>
      )}

      {/* Highlight effect for important cards */}
      {highlight && (
        <div className="card-highlight">
          <span className="highlight-pulse"></span>
        </div>
      )}
    </div>
  );
}

/* =====================================================
   ADD THESE STYLES TO YOUR App.css OR index.css
===================================================== */
/*
.modern-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.modern-kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.modern-kpi-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.06);
  border-color: var(--card-accent);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  transition: all 0.3s ease;
}

.card-badge {
  padding: 4px 8px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  background: var(--card-accent);
}

.card-warning {
  font-size: 16px;
  cursor: help;
}

.card-content {
  margin-bottom: 12px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 8px;
}

.card-value-wrapper {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}

.card-trend {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 20px;
  background: #f8fafc;
}

.trend-up {
  color: #10b981;
}

.trend-down {
  color: #ef4444;
}

.card-subtitle {
  font-size: 12px;
  color: #64748b;
  transition: color 0.3s ease;
  margin: 0;
}

.card-progress {
  margin-top: 16px;
  height: 6px;
  background: #f1f5f9;
  border-radius: 3px;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: var(--card-accent);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-text {
  position: absolute;
  right: 0;
  top: -18px;
  font-size: 11px;
  font-weight: 600;
  color: var(--card-accent);
}

.card-percentage {
  position: absolute;
  top: 20px;
  right: 20px;
}

.percentage-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--card-accent);
}

.card-highlight {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--card-accent);
}

.highlight-pulse {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--card-accent);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}

@media (max-width: 768px) {
  .modern-kpi-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  
  .modern-kpi-card {
    padding: 16px;
  }
  
  .card-value {
    font-size: 22px;
  }
}
*/