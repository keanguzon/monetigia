"use client";

import React from "react";

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
}

export default function Tooltip({ content, children }: TooltipProps) {
  return <div className="relative inline-block" data-tooltip={typeof content === "string" ? content : undefined}>
    <div className="inline-flex items-center">{children}</div>
  </div>;
}
