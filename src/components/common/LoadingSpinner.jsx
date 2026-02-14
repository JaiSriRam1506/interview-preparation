import React from "react";
import { ClipLoader } from "react-spinners";

const LoadingSpinner = ({ fullScreen = false }) => {
  const content = (
    <div className="flex items-center justify-center">
      <ClipLoader size={28} color="#2563eb" />
    </div>
  );

  if (!fullScreen) return content;
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
      {content}
    </div>
  );
};

export default LoadingSpinner;
