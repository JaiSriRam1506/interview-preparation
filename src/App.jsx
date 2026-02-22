// src/App.jsx
import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { ErrorBoundary } from "react-error-boundary";

import { AuthProvider } from "./contexts/AuthContext";
import { SocketProvider } from "./contexts/SocketContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ScreenShareProvider } from "./contexts/ScreenShareContext";

import ProtectedRoute from "./components/common/ProtectedRoute";
import LoadingSpinner from "./components/common/LoadingSpinner";
import ErrorFallback from "./components/common/ErrorFallback";
import Layout from "./components/layout/Layout";

// Lazy load pages for code splitting
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Sessions = lazy(() => import("./pages/sessions/Sessions"));
const CreateSession = lazy(() => import("./pages/sessions/CreateSession"));
const InterviewSession = lazy(
  () => import("./pages/sessions/InterviewSession")
);
const SessionDetails = lazy(() => import("./pages/sessions/SessionDetails"));
const Settings = lazy(() => import("./pages/settings/Settings"));
const Profile = lazy(() => import("./pages/settings/Profile"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const ScreenShareDashboard = lazy(
  () => import("./pages/screenShare/ScreenShareDashboard")
);
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SocketProvider>
            <ThemeProvider>
              <ScreenShareProvider>
                <Router
                  future={{
                    v7_startTransition: true,
                    v7_relativeSplatPath: true,
                  }}
                >
                  <Suspense fallback={<LoadingSpinner fullScreen />}>
                    <Routes>
                      {/* Public routes */}
                      <Route path="/" element={<Home />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/register" element={<Register />} />

                      {/* Protected routes with layout */}
                      <Route
                        element={
                          <ProtectedRoute>
                            <Layout />
                          </ProtectedRoute>
                        }
                      >
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/sessions" element={<Sessions />} />
                        <Route
                          path="/sessions/create"
                          element={<CreateSession />}
                        />
                        <Route
                          path="/sessions/:id"
                          element={<SessionDetails />}
                        />
                        <Route
                          path="/sessions/:id/interview"
                          element={<InterviewSession />}
                        />
                        <Route
                          path="/screen-share"
                          element={<ScreenShareDashboard />}
                        />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/profile" element={<Profile />} />
                        <Route
                          path="/billing"
                          element={<Navigate to="/dashboard" replace />}
                        />

                        {/* Admin routes */}
                        <Route
                          path="/admin"
                          element={
                            <ProtectedRoute adminOnly>
                              <AdminDashboard />
                            </ProtectedRoute>
                          }
                        />
                      </Route>

                      {/* 404 */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </Router>

                <Toaster
                  position="top-right"
                  toastOptions={{
                    duration: 4000,
                    style: {
                      background: "#363636",
                      color: "#fff",
                    },
                    success: {
                      duration: 3000,
                      iconTheme: {
                        primary: "#10b981",
                        secondary: "#fff",
                      },
                    },
                    error: {
                      duration: 4000,
                      iconTheme: {
                        primary: "#ef4444",
                        secondary: "#fff",
                      },
                    },
                  }}
                />
              </ScreenShareProvider>
            </ThemeProvider>
          </SocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
