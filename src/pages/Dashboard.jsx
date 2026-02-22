// src/pages/Dashboard.jsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  TrendingUp,
  Users,
  Zap,
  Plus,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import SessionCard from "../components/sessions/SessionCard";
import QuickActions from "../components/dashboard/QuickActions";
import StatsCard from "../components/dashboard/StatsCard";
import Skeleton from "../components/common/Skeleton";

const MotionDiv = motion.div;

const Dashboard = () => {
  const { user } = useAuth();
  const userKey = user?._id || user?.id || user?.email || "anon";
  const [timeRange, setTimeRange] = useState("week");

  // Fetch dashboard data
  const {
    data: dashboardData,
    isLoading,
    dataUpdatedAt,
    refetch: refetchDashboard,
    isFetching: isFetchingDashboard,
  } = useQuery({
    queryKey: ["dashboard", userKey],
    queryFn: async () => (await api.get("/dashboard")).data,
    enabled: !!userKey,
  });

  // Fetch recent sessions
  const {
    data: recentSessions,
    refetch: refetchRecentSessions,
    isFetching: isFetchingRecent,
  } = useQuery({
    queryKey: ["recentSessions", userKey],
    queryFn: async () =>
      (await api.get("/sessions?limit=5&sort=-createdAt")).data,
    enabled: !!userKey,
  });

  const tokensUsed = Number(dashboardData?.tokensUsed || 0);
  const totalTimeSeconds = Number(dashboardData?.totalTime || 0);

  // Stats data
  const stats = [
    {
      title: "Total Sessions",
      value: dashboardData?.totalSessions || 0,
      change: "+12%",
      icon: <Calendar className="h-6 w-6" />,
      color: "bg-blue-500",
    },
    {
      title: "Tokens Used",
      value: `${(tokensUsed / 1000).toFixed(1)}K`,
      change: "-3%",
      icon: <Zap className="h-6 w-6" />,
      color: "bg-yellow-500",
    },
    {
      title: "Time Practiced",
      value: `${Math.floor(totalTimeSeconds / 3600)}h`,
      change: "+18%",
      icon: <Clock className="h-6 w-6" />,
      color: "bg-purple-500",
    },
  ];

  // Chart data
  const performanceData = [
    { day: "Mon", score: 7.2, questions: 12 },
    { day: "Tue", score: 8.1, questions: 15 },
    { day: "Wed", score: 6.8, questions: 10 },
    { day: "Thu", score: 8.5, questions: 18 },
    { day: "Fri", score: 7.9, questions: 14 },
    { day: "Sat", score: 8.8, questions: 20 },
    { day: "Sun", score: 9.2, questions: 22 },
  ];

  const skillData = [
    { name: "React", value: 85, color: "#61DAFB" },
    { name: "Node.js", value: 78, color: "#339933" },
    { name: "MongoDB", value: 72, color: "#47A248" },
    { name: "System Design", value: 65, color: "#FF6B6B" },
    { name: "Algorithms", value: 80, color: "#4ECDC4" },
  ];

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <MotionDiv
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
                Welcome back, {user?.name} 👋
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-2">
                {format(new Date(), "EEEE, MMMM d, yyyy")}
              </p>
              {dataUpdatedAt ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}
                </p>
              ) : null}
            </div>
            <div className="mt-4 md:mt-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    refetchDashboard();
                    refetchRecentSessions();
                  }}
                  className="inline-flex items-center px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  disabled={isFetchingDashboard || isFetchingRecent}
                >
                  {isFetchingDashboard || isFetchingRecent
                    ? "Refreshing…"
                    : "Refresh"}
                </button>

                <Link
                  to="/sessions/create"
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  New Interview Session
                </Link>
              </div>
            </div>
          </div>
        </MotionDiv>

        {/* Stats Grid */}
        <MotionDiv
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8"
        >
          {stats.map((stat, index) => (
            <StatsCard key={index} {...stat} delay={index * 0.1} />
          ))}
        </MotionDiv>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Performance Charts */}
          <div className="lg:col-span-2 space-y-6">
            {/* Performance Chart */}
            <MotionDiv
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Performance Trends
                  </h2>
                  <p className="text-gray-600 dark:text-gray-300">
                    Your progress over the last 7 days
                  </p>
                </div>
                <div className="flex space-x-2">
                  {["week", "month", "year"].map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        timeRange === range
                          ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                    >
                      {range.charAt(0).toUpperCase() + range.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="day" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F2937",
                        border: "none",
                        borderRadius: "8px",
                        color: "white",
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Average Score"
                    />
                    <Line
                      type="monotone"
                      dataKey="questions"
                      stroke="#10B981"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Questions Answered"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </MotionDiv>

            {/* Skills Radar */}
            <MotionDiv
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
            >
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
                Skill Assessment
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={skillData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name}: ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {skillData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`${value}%`, "Proficiency"]}
                      contentStyle={{
                        backgroundColor: "#1F2937",
                        border: "none",
                        borderRadius: "8px",
                        color: "white",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </MotionDiv>
          </div>

          {/* Right Column - Quick Actions & Recent Sessions */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <QuickActions />

            {/* Recent Sessions */}
            <MotionDiv
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Recent Sessions
                </h2>
                <Link
                  to="/sessions"
                  className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-sm font-medium flex items-center"
                >
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Link>
              </div>

              <div className="space-y-4">
                {recentSessions?.data?.map((session) => (
                  <SessionCard key={session._id} session={session} compact />
                ))}

                {(!recentSessions?.data ||
                  recentSessions.data.length === 0) && (
                  <div className="text-center py-8">
                    <Calendar className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      No sessions yet. Start your first interview!
                    </p>
                  </div>
                )}
              </div>
            </MotionDiv>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1">
              <Skeleton className="h-9 w-72" rounded="rounded-lg" />
              <Skeleton className="mt-3 h-4 w-52" rounded="rounded-lg" />
              <Skeleton className="mt-2 h-3 w-36" rounded="rounded-lg" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-12 w-24" rounded="rounded-lg" />
              <Skeleton className="h-12 w-56" rounded="rounded-lg" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200/70 dark:border-gray-700/60"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Skeleton className="h-3 w-24" rounded="rounded-lg" />
                  <Skeleton className="mt-3 h-7 w-16" rounded="rounded-lg" />
                  <Skeleton className="mt-3 h-3 w-14" rounded="rounded-lg" />
                </div>
                <Skeleton className="h-12 w-12" rounded="rounded-xl" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <Skeleton className="h-5 w-44" rounded="rounded-lg" />
                  <Skeleton className="mt-2 h-4 w-56" rounded="rounded-lg" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-16" rounded="rounded-full" />
                  <Skeleton className="h-7 w-16" rounded="rounded-full" />
                  <Skeleton className="h-7 w-16" rounded="rounded-full" />
                </div>
              </div>
              <Skeleton className="h-80 w-full" rounded="rounded-xl" />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
              <Skeleton className="h-5 w-40" rounded="rounded-lg" />
              <Skeleton className="mt-6 h-80 w-full" rounded="rounded-xl" />
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
              <Skeleton className="h-5 w-28" rounded="rounded-lg" />
              <Skeleton className="mt-4 h-11 w-full" rounded="rounded-xl" />
              <Skeleton className="mt-3 h-11 w-full" rounded="rounded-xl" />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <Skeleton className="h-5 w-36" rounded="rounded-lg" />
                <Skeleton className="h-4 w-16" rounded="rounded-lg" />
              </div>
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 p-4"
                  >
                    <Skeleton className="h-4 w-40" rounded="rounded-lg" />
                    <Skeleton className="mt-2 h-3 w-24" rounded="rounded-lg" />
                    <Skeleton className="mt-4 h-9 w-28" rounded="rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
