import React from "react";

export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300">
      <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
      <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
      <span>AI is typing…</span>
    </div>
  );
}
