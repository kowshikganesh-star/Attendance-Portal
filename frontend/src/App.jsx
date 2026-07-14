// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }          from './context/AuthContext';
import ProtectedRoute            from './components/ProtectedRoute';
import Login                     from './pages/Login';
import AdminDashboard            from './pages/AdminDashboard';
import EmployeeDashboard         from './pages/EmployeeDashboard';
import AttendanceHistory         from './pages/AttendanceHistory';
import AllAttendanceHistory      from './pages/AllAttendanceHistory';
import MyReport                  from './pages/MyReport';
import AllReports                from './pages/AllReports';
import UserManagement            from './pages/UserManagement';
import MyLeaves                  from './pages/MyLeaves';
import AdminLeaves               from './pages/AdminLeaves';
import LeaveBalances from './pages/LeaveBalances';

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Admin routes */}
          <Route path="/admin/dashboard" element={
            <ProtectedRoute allowedRoles={['ADMIN']}><AdminDashboard /></ProtectedRoute>
          }/>
          <Route path="/admin/history" element={
            <ProtectedRoute allowedRoles={['ADMIN']}><AllAttendanceHistory /></ProtectedRoute>
          }/>
          <Route path="/admin/reports" element={
            <ProtectedRoute allowedRoles={['ADMIN']}><AllReports /></ProtectedRoute>
          }/>
          <Route path="/admin/leaves" element={
            <ProtectedRoute allowedRoles={['ADMIN']}><AdminLeaves /></ProtectedRoute>
          }/>
          <Route path="/admin/users" element={
            <ProtectedRoute allowedRoles={['ADMIN']}><UserManagement /></ProtectedRoute>
          }/>
          <Route path="/admin/leave-balances" element={
          <ProtectedRoute allowedRoles={['ADMIN']}><LeaveBalances /> </ProtectedRoute>
          }/>
          {/* Employee routes */}
          <Route path="/employee/dashboard" element={
            <ProtectedRoute allowedRoles={['EMPLOYEE']}><EmployeeDashboard /></ProtectedRoute>
          }/>
          <Route path="/employee/history" element={
            <ProtectedRoute allowedRoles={['EMPLOYEE']}><AttendanceHistory /></ProtectedRoute>
          }/>
          <Route path="/employee/report" element={
            <ProtectedRoute allowedRoles={['EMPLOYEE']}><MyReport /></ProtectedRoute>
          }/>
          <Route path="/employee/leaves" element={
            <ProtectedRoute allowedRoles={['EMPLOYEE']}><MyLeaves /></ProtectedRoute>
          }/>
          

          {/* Default */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;