import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatBubbleProps {
  text: string;
  isUser: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ text, isUser }) => {
  return (
    <div className={cn("flex w-full mt-2 space-x-3 max-w-2xl", isUser ? "ml-auto justify-end" : "")}>
      <div
        className={cn(
          "p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed max-w-[80%] whitespace-pre-wrap",
          isUser
            ? "bg-primary text-white rounded-br-sm"
            : "bg-white text-gray-800 rounded-bl-sm border border-gray-100"
        )}
      >
        {text}
      </div>
    </div>
  );
};
