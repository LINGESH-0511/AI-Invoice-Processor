// App.jsx
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
} from "react-router-dom";

import { FileText, LayoutDashboard, ChevronRight, List } from "lucide-react"; // Added List icon

import Upload from "./pages/Upload";
import Dashboard from "./pages/Dashboard";
import InvoiceRecords from "./pages/InvoiceRecords"; // Import the new Invoice Records page

import "./App.css";

export default function App() {
  return (
    <Router>
      <div className="app-container">

        {/* ================= SIDEBAR ================= */}
        <aside className="sidebar">

          {/* BRAND */}
          <div className="sidebar-header">
            <div className="brand">
              <div className="brand-icon">AI</div>

              <div>
                <h2 className="brand-title">Invoice AI</h2>
                <p className="brand-sub">Enterprise Platform</p>
              </div>
            </div>
          </div>

          {/* ================= NAVIGATION ================= */}
          <nav className="nav">

            {/* DASHBOARD */}
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              {({ isActive }) => (
                <>
                  <LayoutDashboard size={18} />
                  <span>Dashboard</span>
                  {isActive && <ChevronRight size={16} className="nav-arrow" />}
                </>
              )}
            </NavLink>

            {/* UPLOAD */}
            <NavLink
              to="/upload"
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              {({ isActive }) => (
                <>
                  <FileText size={18} />
                  <span>Upload Invoice</span>
                  {isActive && <ChevronRight size={16} className="nav-arrow" />}
                </>
              )}
            </NavLink>

            {/* INVOICE RECORDS - NEW PAGE */}
            <NavLink
              to="/invoice-records"
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              {({ isActive }) => (
                <>
                  <List size={18} />
                  <span>Invoice Records</span>
                  {isActive && <ChevronRight size={16} className="nav-arrow" />}
                </>
              )}
            </NavLink>

          </nav>

          {/* ================= SIDEBAR FOOTER ================= */}
          <div className="sidebar-footer">
            <div className="user-info">
              <div className="user-avatar">L</div>
              <div>
                <p className="user-name">Lingesh</p>
                <p className="user-role">Administrator</p>
              </div>
            </div>
          </div>

        </aside>

        {/* ================= MAIN ================= */}
        <div className="main-wrapper">

          {/* TOPBAR */}
          <header className="topbar">
            <div className="topbar-left">
              <h3>AI Invoice Processing System</h3>
            </div>

            <div className="topbar-right">
              <span className="status-indicator"></span>
              <span className="status-text">System Online</span>
            </div>
          </header>

          {/* PAGE CONTENT */}
          <main className="page-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/invoice-records" element={<InvoiceRecords />} /> {/* New route */}
              
              {/* SAFE FALLBACK */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

        </div>

      </div>
    </Router>
  );
}