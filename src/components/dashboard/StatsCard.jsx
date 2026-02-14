import React from "react";
import { motion } from "framer-motion";

export default function StatsCard({ title, value, icon, color, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 border border-gray-100 dark:border-gray-700"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500 dark:text-gray-300">
            {title}
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
            {value}
          </div>
        </div>
        <div
          className={`h-12 w-12 rounded-xl text-white flex items-center justify-center ${color}`}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}
