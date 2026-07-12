"use client";

import { Streamdown, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";

// Streamdown handles streaming-safe markdown parsing; typography comes from
// shadcn/typeset instead of streamdown's own stylesheet, so its interactive
// chrome (copy buttons, line numbers) is disabled rather than left unstyled.
export function Response({ className, ...props }: StreamdownProps) {
  return (
    <Streamdown
      className={cn("typeset typeset-chat", className)}
      controls={{ table: false, code: false, mermaid: false }}
      lineNumbers={false}
      {...props}
    />
  );
}
