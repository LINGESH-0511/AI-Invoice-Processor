import { NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  FileText,
  List, // Added for Invoice Records
  ChevronRight,
  Settings,
  HelpCircle,
  LogOut,
  ChevronLeft,
} from "lucide-react";
import "./Sidebar.css";

function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showTooltip, setShowTooltip] = useState(null);

  /* =====================================================
     HANDLE COLLAPSE TOGGLE
  ===================================================== */
  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
    // Save preference to localStorage
    localStorage.setItem("sidebarCollapsed", (!isCollapsed).toString());
  };

  /* =====================================================
     LOAD COLLAPSED STATE FROM STORAGE
  ===================================================== */
  useEffect(() => {
    const savedState = localStorage.getItem("sidebarCollapsed");
    if (savedState !== null) {
      setIsCollapsed(savedState === "true");
    }
  }, []);

  /* =====================================================
     HANDLE MOUSE ENTER/LEAVE FOR TOOLTIPS
  ===================================================== */
  const handleMouseEnter = (item) => {
    if (isCollapsed) {
      setShowTooltip(item);
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(null);
  };

  /* =====================================================
     NAVIGATION ITEMS
  ===================================================== */
  const navItems = [
    {
      to: "/",
      end: true,
      icon: LayoutDashboard,
      label: "Dashboard",
    },
    {
      to: "/upload",
      icon: FileText,
      label: "Upload Invoice",
    },
    {
      to: "/invoice-records", // New Invoice Records page
      icon: List,
      label: "Invoice Records",
    },
  ];

  /* =====================================================
     RENDER TOOLTIP
  ===================================================== */
  const renderTooltip = (item) => {
    if (!showTooltip || showTooltip !== item) return null;
    
    return (
      <div 
        className="sidebar-tooltip"
        style={{
          position: 'absolute',
          left: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          marginLeft: '12px',
          background: '#0f172a',
          color: 'white',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        {item.label}
        <div 
          style={{
            position: 'absolute',
            right: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            borderRight: '6px solid #0f172a',
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
          }}
        />
      </div>
    );
  };

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      
      {/* ================= COLLAPSE BUTTON ================= */}
      <button 
        className="sidebar-collapse"
        onClick={toggleSidebar}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* ================= BRAND ================= */}
      <div className="sidebar-brand">
        <div className="brand-icon">AI</div>
        {!isCollapsed && (
          <div className="brand-text">
            <h2>AI Invoice</h2>
            <p>SaaS Dashboard</p>
          </div>
        )}
      </div>

      {/* ================= NAVIGATION ================= */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.to}
              style={{ position: 'relative' }}
              onMouseEnter={() => handleMouseEnter(item)}
              onMouseLeave={handleMouseLeave}
            >
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? "nav-link active" : "nav-link"
                }
              >
                <Icon size={18} />
                {!isCollapsed && <span>{item.label}</span>}
                {!isCollapsed && (
                  <ChevronRight size={14} className="nav-arrow" />
                )}
              </NavLink>
              {renderTooltip(item)}
            </div>
          );
        })}
      </nav>

      {/* ================= BOTTOM SECTION ================= */}
      {!isCollapsed && (
        <div className="sidebar-footer">
          <div className="sidebar-divider" />
          
          {/* Settings Link */}
          <NavLink
            to="/settings"
            className="nav-link"
            style={{ marginBottom: '4px' }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </NavLink>

          {/* Help Link */}
          <NavLink
            to="/help"
            className="nav-link"
            style={{ marginBottom: '4px' }}
          >
            <HelpCircle size={18} />
            <span>Help & Support</span>
          </NavLink>

          {/* User Info */}
          <div className="user-info">
            <div className="user-avatar">L</div>
            <div className="user-details">
              <div className="user-name">Lingesh</div>
              <div className="user-role">
                <span className="user-status"></span>
                Administrator
              </div>
            </div>
          </div>

          {/* Logout Button */}
          <button className="nav-link logout-button">
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      )}

      {/* Collapsed Footer - shows only icons */}
      {isCollapsed && (
        <div className="sidebar-footer collapsed">
          <div className="sidebar-divider" />
          
          <div 
            className="nav-link"
            style={{ position: 'relative' }}
            onMouseEnter={() => setShowTooltip({ label: 'Settings' })}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <Settings size={18} />
            {showTooltip?.label === 'Settings' && (
              <div className="sidebar-tooltip">Settings</div>
            )}
          </div>

          <div 
            className="nav-link"
            style={{ position: 'relative' }}
            onMouseEnter={() => setShowTooltip({ label: 'Help' })}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <HelpCircle size={18} />
            {showTooltip?.label === 'Help' && (
              <div className="sidebar-tooltip">Help & Support</div>
            )}
          </div>

          <div className="user-avatar" style={{ marginTop: '16px' }}>
            L
          </div>

          <div 
            className="nav-link"
            style={{ position: 'relative' }}
            onMouseEnter={() => setShowTooltip({ label: 'Logout' })}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <LogOut size={18} />
            {showTooltip?.label === 'Logout' && (
              <div className="sidebar-tooltip">Logout</div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;